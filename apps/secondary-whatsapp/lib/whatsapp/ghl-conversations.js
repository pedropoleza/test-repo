/**
 * Cliente da GHL Conversations/Contacts API usado pela bridge.
 *
 * Três operações centrais:
 *   1. resolveContact      — acha/cria contato numa location por telefone (§3 ETAPA D)
 *   2. injectInboundToMain  — POST /conversations/messages/inbound  (§5)
 *   3. sendOutboundFromGhost — POST /conversations/messages type=WhatsApp (§7)
 *   + updateProviderMessageStatus — status sync no provider da Main (§12)
 *
 * Os contratos exatos de campo do GHL podem variar por versão da API; os
 * payloads aqui seguem o que a spec descreve e ficam centralizados pra ajuste
 * único contra o sandbox. Base URL e Version são configuráveis por env.
 */
import { ghlBase, ghlVersion } from "./provider.js";
import { log } from "../server/log.js";

async function ghlRequest(token, method, path, { query, body } = {}) {
  const url = new URL(`${ghlBase()}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: ghlVersion(),
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* resposta não-JSON */
  }
  if (!res.ok) {
    const err = new Error(`ghl_${res.status}: ${text.slice(0, 240)}`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }
  return json;
}

/**
 * Acha um contato numa location pelo telefone (E.164). Se não existir, cria.
 * Retorna { contactId, created }.
 */
export async function resolveContact(token, { locationId, phone, name }) {
  if (!locationId) throw new Error("locationId required");
  if (!phone) throw new Error("phone required");

  // 1) tenta localizar duplicata por número
  try {
    const dup = await ghlRequest(token, "GET", "/contacts/search/duplicate", {
      query: { locationId, number: phone },
    });
    const existing = dup?.contact || dup?.contacts?.[0];
    if (existing?.id) return { contactId: existing.id, created: false };
  } catch (err) {
    // 404/não encontrado é esperado; loga o resto e segue pra criação
    if (err.status && err.status !== 404) {
      log.warn("wa.resolveContact.search_failed", { locationId, error: err.message });
    }
  }

  // 2) cria (§3 ETAPA D — "se não existir: criar contato")
  const created = await ghlRequest(token, "POST", "/contacts/", {
    body: {
      locationId,
      phone,
      name: name || undefined,
      source: "Spark WhatsApp Bridge",
    },
  });
  const id = created?.contact?.id || created?.id;
  if (!id) throw new Error("contact_create_no_id");
  return { contactId: id, created: true };
}

/**
 * Injeta uma mensagem INBOUND no Conversations da MAIN account, associada ao
 * nosso Conversation Provider (§5). O GHL passa a tratar a mensagem como
 * pertencente ao provider "Spark WhatsApp / WhatsApp 2" — NÃO ao WhatsApp
 * principal.
 *
 * @returns { messageId, conversationId }
 */
export async function injectInboundToMain(token, {
  contactId,
  conversationProviderId,
  message,
  attachments = [],
  conversationId,
}) {
  const body = {
    type: "SMS", // Custom SMS Provider (§2) — representa nosso WhatsApp 2
    contactId,
    conversationProviderId,
    message: message || "",
    attachments: attachments || [],
  };
  if (conversationId) body.conversationId = conversationId;

  const out = await ghlRequest(token, "POST", "/conversations/messages/inbound", { body });
  return {
    messageId: out?.messageId || out?.message?.id || out?.id || null,
    conversationId: out?.conversationId || out?.message?.conversationId || null,
  };
}

/**
 * Envia a mensagem pelo WhatsApp REAL a partir da GHOST account (§7).
 * type = WhatsApp, contactId = ghostContactId.
 *
 * @returns { messageId, conversationId }
 */
export async function sendOutboundFromGhost(token, {
  ghostContactId,
  message,
  attachments = [],
}) {
  const body = {
    type: "WhatsApp",
    contactId: ghostContactId,
    message: message || "",
  };
  if (attachments && attachments.length) body.attachments = attachments;

  const out = await ghlRequest(token, "POST", "/conversations/messages", { body });
  return {
    messageId: out?.messageId || out?.message?.id || out?.id || null,
    conversationId: out?.conversationId || out?.message?.conversationId || null,
  };
}

/**
 * Atualiza o status de uma mensagem no provider da MAIN (§12).
 * Exige o token do Marketplace App (o provider pertence ao app).
 *
 * @param {string} appToken   token do app
 * @param {string} messageId  id da mensagem NA MAIN (main_message_id)
 * @param {string} status     pending | delivered | read | failed
 * @param {object} [extra]    { error }
 */
export async function updateProviderMessageStatus(appToken, messageId, status, extra = {}) {
  if (!messageId) throw new Error("messageId required");
  const body = { status };
  if (extra.error) {
    body.error = { code: "1", type: "delivery_failed", message: String(extra.error).slice(0, 300) };
  }
  return ghlRequest(appToken, "PUT", `/conversations/messages/${messageId}/status`, { body });
}

export { ghlRequest };
