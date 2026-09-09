/**
 * Comentários da ficha do contato.
 *
 * Um fio simples, preso ao contato (external id) e ao tenant. O texto é
 * cru; quem cita alguém escreve "@Nome", e os ids citados vêm resolvidos
 * do cliente em `mentions` (guardados para um dia virar notificação).
 * Exclusão é lógica — some do fio, fica no banco.
 */
import { db } from "./db.js";
import { WorkspaceError } from "./context.js";
import { mencoesEm } from "../../src/shared/mentions.js";

const CAMPOS = "id,body,author,mentions,created_at";
const LIMITE_CORPO = 4000;

/** Os comentários de um contato, do mais antigo ao mais novo. */
export async function listComments(ctx, contactId) {
  if (!contactId) return [];
  const { data, error } = await db()
    .from("workspace_comments")
    .select(CAMPOS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_external_id", String(contactId))
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return (data || []).map(saida);
}

/**
 * Grava um comentário. `usuarios` (a equipe) serve para resolver as
 * @menções do próprio texto no servidor — nunca confiando só no que o
 * cliente mandou. `author` é o nome escolhido no dispositivo.
 */
export async function addComment(ctx, { contactId, body, author, usuarios = [] } = {}) {
  const texto = String(body ?? "").trim();
  if (!contactId) throw new WorkspaceError(400, "missing_field", { field: "contactId" });
  if (!texto) throw new WorkspaceError(400, "empty_comment");
  if (texto.length > LIMITE_CORPO) throw new WorkspaceError(400, "comment_too_long");

  const mentions = mencoesEm(texto, usuarios).map((u) => u.id);
  const { data, error } = await db()
    .from("workspace_comments")
    .insert({
      workspace_id: ctx.workspaceId,
      contact_external_id: String(contactId).slice(0, 120),
      body: texto,
      author: String(author || "Equipe").slice(0, 120),
      mentions,
      created_at: new Date().toISOString(),
    })
    .select(CAMPOS)
    .maybeSingle();
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return saida(data);
}

/** Exclusão lógica de um comentário. */
export async function deleteComment(ctx, id) {
  if (!id) throw new WorkspaceError(400, "missing_field", { field: "id" });
  const { error } = await db()
    .from("workspace_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", String(id));
  if (error) throw new WorkspaceError(500, "db_error", { detail: error.message });
  return { ok: true };
}

function saida(row) {
  return {
    id: row.id,
    body: row.body,
    author: row.author,
    mentions: row.mentions || [],
    createdAt: row.created_at,
  };
}
