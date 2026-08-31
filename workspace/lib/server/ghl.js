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

export function ghlToken() {
  return process.env.GHL_LOCATION_TOKEN || process.env.GHL_AGENCY_PIT || null;
}

export function ghlLocationId() {
  return process.env.GHL_LOCATION_ID || process.env.WORKSPACE_FIXED_TENANT_ID || null;
}

export function isConfigured() {
  return !!ghlToken() && !!ghlLocationId();
}

/** Fila serial: o GHL limita por segundo, e rajadas viram 429. */
let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(() => {}, () => {});
  return run;
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

export async function listCustomFields(locationId = ghlLocationId()) {
  const data = await ghlFetch(`/locations/${locationId}/customFields`);
  return data?.customFields || [];
}

export async function listTags(locationId = ghlLocationId()) {
  const data = await ghlFetch(`/locations/${locationId}/tags`);
  return data?.tags || [];
}

export async function listPipelines(locationId = ghlLocationId()) {
  const data = await ghlFetch("/opportunities/pipelines", { query: { locationId } });
  return data?.pipelines || [];
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
