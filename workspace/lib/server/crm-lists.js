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
import { listPipelines } from "./ghl.js";

const FIELDS =
  "id,workspace_id,name,icon_value,kind,filters,seed_key,position,created_at,updated_at";

/** Pipelines que ganham lista pronta, pelo que o nome diz. */
const SEEDS = [
  { key: "policies", match: /pol[ií]c|ap[oó]lic/i, name: "Apólices", icon: "📄" },
];

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
export async function listCrmLists(ctx) {
  const rows = await readAll(ctx);
  const jaSemeadas = new Set(rows.map((r) => r.seed_key).filter(Boolean));
  const faltando = SEEDS.filter((s) => !jaSemeadas.has(s.key));
  if (!faltando.length) return rows;

  let pipelines;
  try {
    pipelines = await listPipelines();
  } catch {
    return rows;
  }

  const novas = [];
  let ultima = rows.length ? rows[rows.length - 1].position : null;
  for (const seed of faltando) {
    const pipeline = pipelines.find((p) => seed.match.test(p.name || ""));
    if (!pipeline) continue;
    ultima = keyBetween(ultima, null);
    novas.push({
      workspace_id: ctx.workspaceId,
      name: seed.name,
      icon_value: seed.icon,
      kind: "opportunities",
      filters: { pipelineId: pipeline.id, pipelineName: pipeline.name },
      seed_key: seed.key,
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
  return out;
}
