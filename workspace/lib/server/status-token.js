/**
 * Tokens do portal de status do cliente.
 *
 * Mesma ideia do QR do dossiê: quem abre o link está fora do workspace, e
 * o token no endereço é a credencial. Só que aqui ele aponta para um
 * CONTATO (não uma página) e dá acesso a UMA coisa — o andamento dos
 * serviços daquele contato, em leitura, no idioma dele.
 *
 * O token é estável de propósito (um link mandado por WhatsApp não pode
 * parar de funcionar sozinho); `revoked_at` corta o acesso quando preciso,
 * sem tocar nos outros. Um token vivo por contato: reabrir reaproveita o
 * mesmo em vez de trocar o link a cada vez.
 */
import { randomBytes } from "node:crypto";
import { db } from "./db.js";
import { WorkspaceError } from "./context.js";

const FIELDS = "id,workspace_id,contact_external_id,token,created_at,revoked_at,use_count";

function novoToken() {
  return randomBytes(32).toString("base64url");
}

/** O token do contato, criando na primeira vez (reaproveita o vivo). */
export async function ensureStatusToken(ctx, contactId) {
  if (!contactId) throw new WorkspaceError(400, "missing_id");

  const { data: existente } = await db()
    .from("workspace_status_tokens")
    .select(FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_external_id", String(contactId))
    .is("revoked_at", null)
    .maybeSingle();
  if (existente) return existente;

  const { data, error } = await db()
    .from("workspace_status_tokens")
    .insert({
      workspace_id: ctx.workspaceId,
      contact_external_id: String(contactId).slice(0, 120),
      token: novoToken(),
      created_by: ctx.userKey,
    })
    .select(FIELDS)
    .maybeSingle();

  if (error) {
    // Corrida no unique index: relê em vez de estourar.
    const { data: outra } = await db()
      .from("workspace_status_tokens")
      .select(FIELDS)
      .eq("workspace_id", ctx.workspaceId)
      .eq("contact_external_id", String(contactId))
      .is("revoked_at", null)
      .maybeSingle();
    if (outra) return outra;
    throw new WorkspaceError(500, "status_token_failed", { detail: error.message });
  }
  return data;
}

/**
 * Resolve o token de quem chega pelo link, sem sessão. Sem workspace_id no
 * filtro: quem chega não tem tenant, o token É a credencial — e o unique
 * index garante que ele é único no banco inteiro.
 */
export async function resolveStatusToken(token) {
  if (!token || typeof token !== "string" || token.length < 20) return null;
  const { data } = await db()
    .from("workspace_status_tokens")
    .select(FIELDS)
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  return data || null;
}

/** Uso é auditoria, não controle: registra sem bloquear a resposta. */
export async function recordStatusUse(id, atual = 0) {
  await db()
    .from("workspace_status_tokens")
    .update({ last_used_at: new Date().toISOString(), use_count: atual + 1 })
    .eq("id", id);
}

export async function revokeStatusToken(ctx, contactId) {
  const { error } = await db()
    .from("workspace_status_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_external_id", String(contactId))
    .is("revoked_at", null);
  if (error) throw new WorkspaceError(500, "status_revoke_failed", { detail: error.message });
  return true;
}
