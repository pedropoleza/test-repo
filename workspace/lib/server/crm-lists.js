/**
 * Listas de CRM salvas: "todo mundo que está nesta pipeline/estágio".
 *
 * A lista guarda a PERGUNTA, não a resposta. Quem responde é o CRM a
 * cada abertura — congelar os registros faria a aba virar um relatório
 * velho com cara de lista viva, que é o pior dos dois mundos.
 *
 * A lista de Apólices nasce pronta: a conta já tem a pipeline, e obrigar
 * a pessoa a recriar à mão uma aba que sempre vai existir é trabalho sem
 * decisão. `seed_key` garante que semear de novo não duplica.
 */
import { db } from "./db.js";
import { keyBetween, byPosition } from "../../src/shared/fracdex.js";
import { WorkspaceError } from "./context.js";
import { listPipelines, listCustomFields } from "./ghl.js";
import { customFieldsToColumns } from "../../src/shared/crm.js";
import { detectarGrupos, gruposDaPipeline, chavesDosGrupos } from "../../src/shared/field-groups.js";

const FIELDS = "id,workspace_id,name,icon_value,kind,filters,seed_key,group_name,"
  + "position,created_at,updated_at";

/**
 * Os grupos da navegação, pelo que o nome da pipeline diz.
 *
 * O nome do grupo é escolha de produto, não dado: nenhuma palavra liga
 * "Seguro de Vida" a "Apólices Ativas" a não ser o negócio em si. Fica
 * aqui, num só lugar, e a pessoa renomeia na tela quando quiser.
 *
 * Pipeline que não casa com nada fica solta, como sempre foi.
 */
const GRUPOS = [
  { nome: "Seguros",  match: /seguro|ap[oó]lice|policy|policies|prospect/i },
  { nome: "Serviços", match: /empresa|fiscal|consular|tradu|registro|vehicle|jur[ií]dic|legal|despachant/i },
];

/** Ícone da aba, pelo assunto da pipeline. Só enfeite — nada depende disto. */
const ICONES = [
  [/ap[oó]lic|policy|policies/i, "🛡"],
  [/seguro|prospect|lead/i, "🌱"],
  [/empresa|fiscal/i, "🏢"],
  [/consular|tradu/i, "🌐"],
  [/registro|vehicle|motor/i, "🚗"],
  [/jur[ií]dic|legal|caso/i, "⚖️"],
  [/recruit|carreira/i, "🎯"],
  [/agency|ag[eê]ncia/i, "🏛"],
];

function iconeDaPipeline(nome) {
  return (ICONES.find(([re]) => re.test(nome || "")) || [null, "📋"])[1];
}

function grupoDaPipeline(nome) {
  return GRUPOS.find((g) => g.match.test(nome || ""))?.nome || null;
}

/**
 * O nome da aba: a pipeline sem a numeração que a conta usa para ordenar.
 *
 * "2 · Apólices Ativas" vira "Apólices Ativas". O número é ordenação,
 * não nome — e a ordem já está em `position`, na sequência em que o CRM
 * devolve as pipelines.
 */
export function nomeDaAba(nomeDaPipeline) {
  return String(nomeDaPipeline || "")
    .replace(/^\s*\d+\s*[.·:\-—)]\s*/, "")
    .trim() || String(nomeDaPipeline || "").trim();
}

function fail(error, code = "db_error") {
  throw new WorkspaceError(500, code, { detail: error.message });
}

async function readAll(ctx) {
  const { data, error } = await db()
    .from("workspace_crm_lists")
    .select(FIELDS)
    .eq("workspace_id", ctx.workspaceId);
  if (error) fail(error);
  return (data || []).sort(byPosition);
}

/**
 * Lista as abas salvas, semeando as prontas na primeira vez.
 *
 * A semeadura é preguiçosa e depende do CRM, então nunca pode derrubar a
 * leitura: se o CRM não responder, devolvemos o que já existe. A próxima
 * abertura tenta de novo.
 */
/**
 * Lista as abas salvas, semeando uma por pipeline na primeira vez.
 *
 * A semeadura é preguiçosa e depende do CRM, então nunca pode derrubar a
 * leitura: se o CRM não responder, devolvemos o que já existe. A próxima
 * abertura tenta de novo.
 *
 * SÓ ACONTECE ENQUANTO O WORKSPACE ESTÁ VAZIO — nenhuma página escrita.
 * É setup de primeira execução, não reorganização retroativa: uma conta
 * que já montou a navegação dela não pode ganhar seis abas novas de
 * surpresa porque o app aprendeu a ler pipelines. Depois disso, abas
 * novas saem do "+ Nova lista", que é onde a decisão é de quem usa.
 */
export async function listCrmLists(ctx) {
  const rows = await readAll(ctx);
  if (!(await workspaceVazio(ctx))) return rows;

  let pipelines;
  let colunas = [];
  try {
    pipelines = await listPipelines();
    colunas = customFieldsToColumns(await listCustomFields().catch(() => []));
  } catch {
    return rows;
  }

  // Uma aba por pipeline, na ordem em que o CRM as devolve — que é a
  // ordem que a conta escolheu ao numerá-las.
  const { grupos } = detectarGrupos(colunas);
  const jaTem = new Set(rows.map((r) => r.filters?.pipelineId).filter(Boolean));

  const novas = [];
  let ultima = rows.length ? rows[rows.length - 1].position : null;
  for (const pipeline of pipelines) {
    if (jaTem.has(pipeline.id)) continue;
    const colunasDaPipeline = chavesDosGrupos(gruposDaPipeline(pipeline.name, grupos));
    ultima = keyBetween(ultima, null);
    novas.push({
      workspace_id: ctx.workspaceId,
      name: nomeDaAba(pipeline.name).slice(0, 120),
      icon_value: iconeDaPipeline(pipeline.name),
      kind: "opportunities",
      filters: {
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        // As colunas que essa pipeline pede. Numa conta sem convenção de
        // prefixo não há nenhuma, e a chave nem é gravada: `columns: []`
        // seria uma escolha registrada ("mostrar nada"), e o que
        // queremos dizer é "não há escolha aqui".
        ...(colunasDaPipeline.length ? { columns: colunasDaPipeline } : {}),
      },
      seed_key: `pipeline:${pipeline.id}`,
      group_name: grupoDaPipeline(pipeline.name),
      position: ultima,
      created_by: ctx.userKey,
    });
  }
  if (!novas.length) return rows;

  const { error } = await db().from("workspace_crm_lists").insert(novas);
  // Erro aqui é quase sempre a corrida entre duas abas caindo no unique
  // index do seed. Reler resolve e não há o que reportar.
  if (error) return readAll(ctx);
  return readAll(ctx);
}

/** Workspace sem nenhuma página escrita — ainda em branco. */
async function workspaceVazio(ctx) {
  const { data, error } = await db()
    .from("workspace_pages")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .limit(1);
  // Na dúvida, NÃO semeia: errar para menos deixa a navegação como está;
  // errar para mais enche a barra de quem já organizou a dela.
  if (error) return false;
  return (data || []).length === 0;
}

async function lerUma(ctx, id) {
  const { data } = await db()
    .from("workspace_crm_lists")
    .select(FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id)
    .maybeSingle();
  return data || null;
}

export async function createCrmList(ctx, input = {}) {
  const name = String(input.name || "").trim();
  if (!name) throw new WorkspaceError(400, "missing_name");

  const filters = sanitizeFilters(input.filters);
  if (!filters.pipelineId && !filters.stageId) {
    throw new WorkspaceError(400, "missing_filter");
  }

  const rows = await readAll(ctx);
  const ultima = rows.length ? rows[rows.length - 1].position : null;

  const { data, error } = await db()
    .from("workspace_crm_lists")
    .insert({
      workspace_id: ctx.workspaceId,
      name: name.slice(0, 120),
      icon_value: String(input.icon || "📋").slice(0, 8),
      kind: input.kind === "contacts" ? "contacts" : "opportunities",
      filters,
      group_name: String(input.group ?? "").trim().slice(0, 60) || null,
      position: keyBetween(ultima, null),
      created_by: ctx.userKey,
    })
    .select(FIELDS)
    .maybeSingle();
  if (error) fail(error, "list_create_failed");
  return data;
}

export async function updateCrmList(ctx, id, patch = {}) {
  if (!id) throw new WorkspaceError(400, "missing_id");
  const campos = {};
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new WorkspaceError(400, "missing_name");
    campos.name = name.slice(0, 120);
  }
  if (patch.icon !== undefined) campos.icon_value = String(patch.icon || "📋").slice(0, 8);
  // Grupo vazio é aba solta — é assim que se tira uma aba de uma seção.
  if (patch.group !== undefined) {
    const g = String(patch.group ?? "").trim();
    campos.group_name = g ? g.slice(0, 60) : null;
  }
  if (patch.columns !== undefined) {
    const atual = await lerUma(ctx, id);
    if (!atual) throw new WorkspaceError(404, "list_not_found");
    campos.filters = sanitizeFilters({ ...atual.filters, columns: patch.columns });
    // `columns: []` é uma escolha ("mostrar só os padrão"), e sanitize
    // descarta lista vazia — então repõe explicitamente.
    if (Array.isArray(patch.columns) && !patch.columns.length) delete campos.filters.columns;
  }
  if (!Object.keys(campos).length) throw new WorkspaceError(400, "nothing_to_update");

  const { data, error } = await db()
    .from("workspace_crm_lists")
    .update(campos)
    .eq("workspace_id", ctx.workspaceId)          // tenant vem do token, nunca do corpo
    .eq("id", id)
    .select(FIELDS)
    .maybeSingle();
  if (error) fail(error, "list_update_failed");
  if (!data) throw new WorkspaceError(404, "list_not_found");
  return data;
}

export async function deleteCrmList(ctx, id) {
  if (!id) throw new WorkspaceError(400, "missing_id");
  const { error } = await db()
    .from("workspace_crm_lists")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id);
  if (error) fail(error, "list_delete_failed");
  return true;
}

/**
 * Só os campos que conhecemos entram em `filters`.
 *
 * O jsonb é livre por design, mas gravar o objeto que veio do cliente
 * deixaria a coluna virar depósito: qualquer chave inventada ficaria lá
 * para sempre, e a leitura teria que adivinhar o que é filtro de verdade.
 */
function sanitizeFilters(raw = {}) {
  const out = {};
  for (const chave of ["pipelineId", "pipelineName", "stageId", "stageName"]) {
    const valor = raw?.[chave];
    if (typeof valor === "string" && valor.trim()) out[chave] = valor.trim().slice(0, 200);
  }
  // As colunas que a aba mostra por padrão. Entram limitadas: são chaves
  // de campo, e uma lista sem teto vinda do cliente viraria uma linha
  // enorme no banco por engano de quem chama.
  if (Array.isArray(raw?.columns)) {
    const chaves = raw.columns
      .filter((c) => typeof c === "string" && c.trim())
      .map((c) => c.trim().slice(0, 120))
      .slice(0, 60);
    if (chaves.length) out.columns = chaves;
  }
  return out;
}
