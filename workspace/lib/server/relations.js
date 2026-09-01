/**
 * Associações entre contatos, gravadas nos dois sentidos.
 *
 * A simetria é do servidor, não do cliente: se dependesse de duas
 * chamadas do browser, uma falha de rede no meio deixaria o vínculo
 * existindo de um lado só — e o par assimétrico é pior que a ausência
 * dele, porque ninguém procura o erro no lado que não mostra nada.
 */
import { db } from "./db.js";
import { WorkspaceError } from "./context.js";
import { isRelation, inverseRelation } from "../../src/shared/relations.js";

const FIELDS = "id,contact_id,related_contact_id,relation,created_at";

function fail(error, code = "db_error") {
  throw new WorkspaceError(500, code, { detail: error.message });
}

export async function listRelations(ctx, contactId) {
  if (!contactId) throw new WorkspaceError(400, "missing_id");
  const { data, error } = await db()
    .from("workspace_contact_relations")
    .select(FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_id", contactId);
  if (error) fail(error);
  return data || [];
}

/** Marca o vínculo. `relation` é o que o RELACIONADO é do contato. */
export async function linkContacts(ctx, { contactId, relatedContactId, relation }) {
  if (!contactId || !relatedContactId) throw new WorkspaceError(400, "missing_id");
  if (contactId === relatedContactId) throw new WorkspaceError(400, "mesmo_contato");
  if (!isRelation(relation)) throw new WorkspaceError(400, "relacao_invalida", { relation });

  const linhas = [
    {
      workspace_id: ctx.workspaceId,
      contact_id: contactId,
      related_contact_id: relatedContactId,
      relation,
      created_by: ctx.userKey,
    },
    {
      workspace_id: ctx.workspaceId,
      contact_id: relatedContactId,
      related_contact_id: contactId,
      relation: inverseRelation(relation),
      created_by: ctx.userKey,
    },
  ];

  // Upsert: remarcar o mesmo par troca o rótulo em vez de duplicar.
  const { error } = await db()
    .from("workspace_contact_relations")
    .upsert(linhas, { onConflict: "workspace_id,contact_id,related_contact_id" });
  if (error) fail(error, "link_failed");
  return linhas[0];
}

/**
 * Desfaz nos dois sentidos: um vínculo pela metade não é um vínculo.
 *
 * Dois deletes com `eq`, e não um `or` com filtro montado por
 * interpolação: os ids vêm do corpo da requisição, e concatená-los numa
 * expressão de filtro é construir uma consulta com entrada de fora.
 * Duas idas ao banco numa operação rara valem esse sossego.
 */
export async function unlinkContacts(ctx, { contactId, relatedContactId }) {
  if (!contactId || !relatedContactId) throw new WorkspaceError(400, "missing_id");

  for (const [de, para] of [[contactId, relatedContactId], [relatedContactId, contactId]]) {
    const { error } = await db()
      .from("workspace_contact_relations")
      .delete()
      .eq("workspace_id", ctx.workspaceId)
      .eq("contact_id", de)
      .eq("related_contact_id", para);
    if (error) fail(error, "unlink_failed");
  }
  return true;
}
