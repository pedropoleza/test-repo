/**
 * Cliente único da API do GoHighLevel (§65).
 *
 * Todo acesso ao GHL passa por aqui: fila, backoff, tratamento de 429,
 * timeout, paginação e log sem segredos. Nenhum fetch para o GHL espalhado
 * pelo resto do código.
 *
 * TOKEN
 * `GHL_LOCATION_TOKEN` — Private Integration Token da sub-account. É o
 * caminho desta fase: um token, uma conta. Quando houver mais de uma
 * location, o lugar de guardar isto é uma tabela de integrações por
 * tenant (§46), e só esta função muda.
 *
 * O token fica só no servidor, nunca vai para o frontend nem para log.
 */
import { log } from "./log.js";

const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";
const TIMEOUT_MS = 20000;
const MAX_RETRIES = 3;

export class GhlError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Token de acesso ao CRM.
 *
 * `SPARK_CRM_TOKEN` é o nome canônico — nada na interface cita o
 * fornecedor. Os nomes antigos seguem aceitos para não quebrar ambientes
 * já configurados.
 */
export function ghlToken() {
  return process.env.SPARK_CRM_TOKEN
    || process.env.GHL_LOCATION_TOKEN
    || process.env.GHL_AGENCY_PIT
    || null;
}

export function ghlLocationId() {
  return process.env.SPARK_CRM_ACCOUNT_ID
    || process.env.GHL_LOCATION_ID
    || process.env.WORKSPACE_FIXED_TENANT_ID
    || null;
}

export function isConfigured() {
  return !!ghlToken() && !!ghlLocationId();
}

/**
 * Fila com concorrência limitada.
 *
 * Era estritamente serial, o que anulava todo `Promise.all` do código: as
 * quatro consultas que montam a tabela de contatos iam uma atrás da
 * outra e o tempo delas somava. O limite do CRM é por SEGUNDO, não por
 * conexão — três de cada vez fica bem abaixo dele e continua protegendo
 * contra a rajada que gera 429.
 */
const CONCORRENCIA = 3;
let emVoo = 0;
const espera = [];

function enqueue(task) {
  return new Promise((resolve, reject) => {
    espera.push(() => task().then(resolve, reject));
    puxar();
  });
}

function puxar() {
  while (emVoo < CONCORRENCIA && espera.length) {
    const proxima = espera.shift();
    emVoo += 1;
    proxima().finally(() => { emVoo -= 1; puxar(); });
  }
}

/**
 * Memoização por instância para as listas que quase não mudam.
 *
 * Campos personalizados custam ~2s nesta conta (são 115) e são pedidos em
 * TODA abertura da tabela de contatos e de toda ficha. Como a função
 * serverless é efêmera, isto é alívio e não fonte de verdade — por isso o
 * TTL é de minutos e não há invalidação explícita.
 */
const MEMO_TTL_MS = 5 * 60 * 1000;
const memo = new Map();

/**
 * Zera a memoização. Existe para os testes, que trocam o CRM por um
 * duplo entre um caso e outro — sem isto um caso herdaria as pipelines
 * do anterior. Mesma válvula do `__setDbClient`.
 */
export function __clearGhlCache() {
  memo.clear();
}

function memoizar(chave, produzir, ttl = MEMO_TTL_MS) {
  const agora = Date.now();
  const guardado = memo.get(chave);
  if (guardado && agora - guardado.at < ttl) return guardado.valor;

  // Guarda a PROMESSA, não o resultado: duas chamadas simultâneas para a
  // mesma lista viravam duas idas ao CRM.
  const valor = produzir().catch((err) => { memo.delete(chave); throw err; });
  memo.set(chave, { at: agora, valor });
  return valor;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chamada crua. Devolve o JSON; erros viram GhlError com o código já
 * traduzido — em especial `missing_scope`, que é acionável.
 */
export async function ghlFetch(path, { method = "GET", query, body, version = VERSION } = {}) {
  const token = ghlToken();
  if (!token) throw new GhlError(503, "ghl_not_configured");

  const url = new URL(path.startsWith("http") ? path : API + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  return enqueue(async () => {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Version: version,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 429) {
          const wait = Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
          log.warn("ghl.rate_limited", { path, attempt, waitMs: wait });
          await sleep(Math.min(wait, 8000));
          continue;
        }

        const text = await res.text();
        const payload = text ? safeJson(text) : null;

        if (res.status === 401) {
          const message = String(payload?.message || "");
          // O GHL usa 401 tanto para token inválido quanto para escopo
          // faltando. Distinguir muda completamente o que dizer ao usuário.
          const missingScope = /scope/i.test(message);
          throw new GhlError(401, missingScope ? "missing_scope" : "invalid_token", message);
        }
        if (!res.ok) {
          throw new GhlError(res.status, "ghl_error", String(payload?.message || res.statusText));
        }
        return payload;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof GhlError) throw err;      // erro de negócio: não repete
        lastError = err;
        if (attempt === MAX_RETRIES) break;
        await sleep(400 * 2 ** attempt);              // rede: backoff exponencial
      }
    }
    log.error("ghl.request_failed", { path, error: lastError?.message });
    throw new GhlError(502, "ghl_unreachable", lastError?.message);
  });
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 300) }; }
}

/* ------------------------------------------------------------------ */
/* Recursos                                                           */
/* ------------------------------------------------------------------ */

export async function getLocation(locationId = ghlLocationId()) {
  const data = await ghlFetch(`/locations/${locationId}`);
  return data?.location || null;
}

/** Os mais caros da conta: 115 campos, ~2s. Pedidos em toda abertura. */
export function listCustomFields(locationId = ghlLocationId()) {
  return memoizar(`customFields:${locationId}`, async () => {
    const data = await ghlFetch(`/locations/${locationId}/customFields`);
    return data?.customFields || [];
  });
}

export function listTags(locationId = ghlLocationId()) {
  return memoizar(`tags:${locationId}`, async () => {
    const data = await ghlFetch(`/locations/${locationId}/tags`);
    return data?.tags || [];
  });
}

/**
 * Usuários da conta — é o que traduz `assignedTo` (um id opaco) para o
 * nome de quem responde pela oportunidade.
 */
export function listUsers(locationId = ghlLocationId()) {
  return memoizar(`users:${locationId}`, async () => {
    const data = await ghlFetch("/users/", { query: { locationId } });
    return (data?.users || [])
      .filter((u) => u && u.id)
      .map((u) => ({
        id: u.id,
        name: u.name || [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || u.id,
        email: u.email || "",
      }));
  });
}

export function listPipelines(locationId = ghlLocationId()) {
  return memoizar(`pipelines:${locationId}`, async () => {
    const data = await ghlFetch("/opportunities/pipelines", { query: { locationId } });
    return data?.pipelines || [];
  });
}

/**
 * Contatos, seguindo a paginação até o teto. `limit` é o total desejado,
 * não o tamanho da página.
 */
export async function listContacts({ locationId = ghlLocationId(), limit = 200 } = {}) {
  const out = [];
  let startAfterId;
  let startAfter;

  while (out.length < limit) {
    const data = await ghlFetch("/contacts/", {
      query: {
        locationId,
        limit: Math.min(100, limit - out.length),
        ...(startAfterId ? { startAfterId } : {}),
        ...(startAfter ? { startAfter } : {}),
      },
    });
    const batch = data?.contacts || [];
    out.push(...batch);
    const meta = data?.meta || {};
    startAfterId = meta.startAfterId;
    startAfter = meta.startAfter;
    if (!batch.length || !startAfterId) break;
  }
  return out.slice(0, limit);
}

export async function listOpportunities({ locationId = ghlLocationId(), limit = 200 } = {}) {
  const out = [];
  let page = 1;
  while (out.length < limit) {
    const data = await ghlFetch("/opportunities/search", {
      query: { location_id: locationId, limit: Math.min(100, limit - out.length), page },
    });
    const batch = data?.opportunities || [];
    out.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return out.slice(0, limit);
}

/** Oportunidades de um contato específico. */
export async function listContactOpportunities(contactId, locationId = ghlLocationId()) {
  const data = await ghlFetch("/opportunities/search", {
    query: { location_id: locationId, contact_id: contactId, limit: 50 },
  });
  return data?.opportunities || [];
}

/**
 * Atualiza a oportunidade.
 *
 * Única escrita que o módulo faz no CRM hoje, junto com a do contato.
 * Mandamos só os campos que mudam: um PUT com o objeto inteiro
 * sobrescreveria o que outra pessoa alterou entre a leitura e a gravação.
 *
 * A allowlist é dupla de propósito. A de cima, em shared/crm.js, decide
 * quais COLUNAS a interface oferece; esta decide quais CAMPOS do CRM
 * podem ser tocados. Um bug de mapeamento na primeira não vira escrita
 * indevida por causa da segunda.
 */
const OPPORTUNITY_FIELDS_WRITABLE = new Set([
  "name", "status", "monetaryValue", "assignedTo", "pipelineId", "pipelineStageId",
]);

export async function updateOpportunity(opportunityId, patch = {}) {
  if (!opportunityId) throw new GhlError(400, "missing_opportunity");
  const body = {};
  for (const [key, value] of Object.entries(patch)) {
    if (OPPORTUNITY_FIELDS_WRITABLE.has(key) && value !== undefined) body[key] = value;
  }
  if (!Object.keys(body).length) throw new GhlError(400, "nothing_to_update");
  const data = await ghlFetch(`/opportunities/${opportunityId}`, { method: "PUT", body });
  return data?.opportunity || null;
}

/** Mover é atualizar estágio e pipeline juntos: um sem o outro fica órfão. */
export async function moveOpportunity(opportunityId, { pipelineId, stageId }) {
  if (!stageId) throw new GhlError(400, "missing_stage");
  return updateOpportunity(opportunityId, {
    pipelineStageId: stageId,
    ...(pipelineId ? { pipelineId } : {}),
  });
}

const CONTACT_FIELDS_WRITABLE = new Set([
  "firstName", "lastName", "name", "email", "phone", "tags",
  "companyName", "city", "state", "country", "dnd", "customFields",
]);

export async function updateContact(contactId, patch = {}) {
  if (!contactId) throw new GhlError(400, "missing_contact");
  const body = {};
  for (const [key, value] of Object.entries(patch)) {
    if (CONTACT_FIELDS_WRITABLE.has(key) && value !== undefined) body[key] = value;
  }
  if (!Object.keys(body).length) throw new GhlError(400, "nothing_to_update");
  const data = await ghlFetch(`/contacts/${contactId}`, { method: "PUT", body });
  return data?.contact || null;
}

export async function getContact(contactId) {
  const data = await ghlFetch(`/contacts/${contactId}`);
  return data?.contact || null;
}

export async function listContactNotes(contactId) {
  const data = await ghlFetch(`/contacts/${contactId}/notes`);
  return data?.notes || [];
}

export async function listContactTasks(contactId) {
  const data = await ghlFetch(`/contacts/${contactId}/tasks`);
  return data?.tasks || [];
}

/**
 * Diagnóstico de escopos: sonda cada recurso e diz o que o token alcança.
 * É o que transforma "401" numa instrução acionável.
 */
export async function checkScopes(locationId = ghlLocationId()) {
  const probes = [
    ["location",      () => getLocation(locationId)],
    ["contacts",      () => ghlFetch("/contacts/", { query: { locationId, limit: 1 } })],
    ["opportunities", () => ghlFetch("/opportunities/search", { query: { location_id: locationId, limit: 1 } })],
    ["customFields",  () => listCustomFields(locationId)],
    ["tags",          () => listTags(locationId)],
    ["pipelines",     () => listPipelines(locationId)],
  ];

  const result = {};
  for (const [name, run] of probes) {
    try {
      await run();
      result[name] = { ok: true };
    } catch (err) {
      result[name] = {
        ok: false,
        code: err.code || "error",
        status: err.status || 0,
        // detail vem da API, nunca do token
        detail: err.detail || null,
      };
    }
  }
  return result;
}
