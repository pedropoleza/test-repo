/**
 * Tokens de compartilhamento: o que o QR code carrega.
 *
 * Quem lê o QR está fora do workspace — é a pessoa com o celular na mão,
 * possivelmente sem sessão. Mandar a URL da página exigiria login e
 * entregaria o workspace inteiro; o token dá acesso a UMA coisa, o PDF
 * daquela ficha, somente leitura.
 *
 * O token é estável de propósito: um QR impresso não pode parar de
 * funcionar porque expirou. Quando for preciso cortar o acesso,
 * `revoked_at` invalida aquele QR sem tocar nos outros.
 *
 * QUEM TEM O QR TEM OS DADOS DAQUELE CONTATO. É a natureza do pedido —
 * ler e baixar sem login.
 */
import { randomBytes } from "node:crypto";
import { db } from "./db.js";
import { WorkspaceError } from "./context.js";

const FIELDS = "id,workspace_id,page_id,token,kind,created_at,revoked_at,use_count";
const KIND = "dossier_pdf";

/** 32 bytes base64url: espaço de busca grande demais para adivinhação. */
function novoToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Devolve o token da página, criando na primeira vez.
 *
 * Reaproveitar é o certo: gerar um novo a cada abertura invalidaria na
 * prática todo QR já impresso, sem ninguém pedir.
 */
export async function ensureShareToken(ctx, pageId) {
  if (!pageId) throw new WorkspaceError(400, "missing_id");

  const { data: existente } = await db()
    .from("workspace_share_tokens")
    .select(FIELDS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("page_id", pageId)
    .eq("kind", KIND)
    .is("revoked_at", null)
    .maybeSingle();
  if (existente) return existente;

  const { data, error } = await db()
    .from("workspace_share_tokens")
    .insert({
      workspace_id: ctx.workspaceId,
      page_id: pageId,
      token: novoToken(),
      kind: KIND,
      created_by: ctx.userKey,
    })
    .select(FIELDS)
    .maybeSingle();

  if (error) {
    // Corrida entre duas abas caindo no unique index: relê em vez de
    // estourar, senão a primeira abertura falharia sem motivo.
    const { data: outra } = await db()
      .from("workspace_share_tokens")
      .select(FIELDS)
      .eq("workspace_id", ctx.workspaceId)
      .eq("page_id", pageId)
      .eq("kind", KIND)
      .is("revoked_at", null)
      .maybeSingle();
    if (outra) return outra;
    throw new WorkspaceError(500, "share_token_failed", { detail: error.message });
  }
  return data;
}

/**
 * Resolve o token de quem chega pelo QR, sem sessão.
 *
 * Sem workspace_id no filtro de propósito: quem chega aqui não tem
 * tenant, o token É a credencial. Por isso ele precisa ser aleatório e
 * único no banco inteiro — e é o unique index que garante isso.
 */
export async function resolveShareToken(token) {
  if (!token || typeof token !== "string" || token.length < 20) return null;
  const { data } = await db()
    .from("workspace_share_tokens")
    .select(FIELDS)
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  return data || null;
}

/** Uso é registrado sem bloquear a resposta: é auditoria, não controle. */
export async function recordShareUse(id, atual = 0) {
  await db()
    .from("workspace_share_tokens")
    .update({ last_used_at: new Date().toISOString(), use_count: atual + 1 })
    .eq("id", id);
}

export async function revokeShareToken(ctx, pageId) {
  const { error } = await db()
    .from("workspace_share_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspaceId)
    .eq("page_id", pageId)
    .eq("kind", KIND)
    .is("revoked_at", null);
  if (error) throw new WorkspaceError(500, "share_revoke_failed", { detail: error.message });
  return true;
}
