/**
 * Checklist de documentos por serviço.
 *
 * Os ITENS de cada serviço vêm do catálogo (o que o cliente precisa
 * trazer); aqui só se guarda o ESTADO de cada um por contato. Ausência de
 * linha é "pendente" — grava-se só o que saiu do padrão, e um upsert
 * mantém uma linha por (contato, serviço, item).
 */
import { db } from "./db.js";
import { WorkspaceError } from "./context.js";
import { estadoDocValido } from "../../src/shared/documents.js";

const CAMPOS = "service_code,item,state,updated_at";

/** Os estados guardados de um contato: { "servico|item": state }. */
export async function listChecklist(ctx, contactId) {
  if (!contactId) return {};
  const { data, error } = await db()
    .from("workspace_doc_checklist")
    .select(CAMPOS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_external_id", String(contactId));
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  const mapa = {};
  for (const r of data || []) mapa[`${r.service_code}|${r.item}`] = r.state;
  return mapa;
}

/**
 * Grava o estado de um item. Voltar para "pendente" apaga a linha — o
 * padrão não precisa ocupar espaço, e some do "o que falta" sem virar
 * exceção guardada.
 */
export async function setChecklistItem(ctx, { contactId, serviceCode, item, state } = {}) {
  if (!contactId || !serviceCode || !item) throw new WorkspaceError(400, "missing_field");
  if (!estadoDocValido(state)) throw new WorkspaceError(400, "estado_invalido");

  const chave = {
    workspace_id: ctx.workspaceId,
    contact_external_id: String(contactId).slice(0, 120),
    service_code: String(serviceCode).slice(0, 60),
    item: String(item).slice(0, 200),
  };

  if (state === "pendente") {
    const { error } = await db().from("workspace_doc_checklist").delete()
      .eq("workspace_id", chave.workspace_id)
      .eq("contact_external_id", chave.contact_external_id)
      .eq("service_code", chave.service_code)
      .eq("item", chave.item);
    if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
    return { state: "pendente" };
  }

  const { error } = await db().from("workspace_doc_checklist")
    .upsert({ ...chave, state, updated_by: ctx.userKey, updated_at: new Date().toISOString() },
      { onConflict: "workspace_id,contact_external_id,service_code,item" });
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return { state };
}
