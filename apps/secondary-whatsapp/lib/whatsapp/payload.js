/**
 * Extração tolerante de campos dos payloads de webhook do GHL.
 *
 * O shape exato varia entre "InboundMessage" (Ghost) e o outbound do
 * Conversation Provider. Centralizamos aqui a leitura pra não espalhar
 * `?.` por todo lado e pra ficar fácil de ajustar contra payloads reais.
 */

function first(obj, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, part) => (o == null ? o : o[part]), obj);
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function toAttachments(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((a) => (typeof a === "string" ? a : a?.url || a?.href || null))
      .filter(Boolean);
  }
  if (typeof v === "string") return [v];
  return [];
}

/**
 * Normaliza o webhook InboundMessage vindo da GHOST account (§3 ETAPA B).
 */
export function parseGhostInbound(body = {}) {
  return {
    ghostLocationId: first(body, ["locationId", "location_id", "location.id", "ghostLocationId"]),
    ghostContactId: first(body, ["contactId", "contact_id", "contact.id", "ghostContactId"]),
    ghostConversationId: first(body, [
      "conversationId",
      "conversation_id",
      "conversation.id",
      "ghostConversationId",
    ]),
    ghostMessageId: first(body, [
      "messageId",
      "message_id",
      "message.id",
      "id",
      "ghostMessageId",
    ]),
    phone: first(body, ["phone", "from", "contact.phone", "contactPhone"]),
    contactName: first(body, ["contactName", "fullName", "contact.name", "name"]),
    message: first(body, ["message", "body", "text", "message.body"]) || "",
    attachments: toAttachments(first(body, ["attachments", "media", "message.attachments"])),
    timestamp: first(body, ["timestamp", "dateAdded", "createdAt"]),
    messageType: first(body, ["messageType", "type"]),
    direction: first(body, ["direction"]) || "inbound",
  };
}

/**
 * Normaliza o payload do outbound do Conversation Provider (§6).
 * O GHL chama nossa Delivery URL quando o atendente responde por "WhatsApp 2".
 */
export function parseProviderOutbound(body = {}) {
  return {
    mainLocationId: first(body, ["locationId", "location_id", "location.id"]),
    mainContactId: first(body, ["contactId", "contact_id", "contact.id"]),
    mainConversationId: first(body, ["conversationId", "conversation_id"]),
    mainMessageId: first(body, ["messageId", "message_id", "message.id", "id"]),
    conversationProviderId: first(body, [
      "conversationProviderId",
      "providerId",
      "conversation_provider_id",
    ]),
    phone: first(body, ["phone", "to", "contact.phone", "contactPhone"]),
    contactName: first(body, ["contactName", "fullName", "contact.name", "name"]),
    message: first(body, ["message", "body", "text"]) || "",
    attachments: toAttachments(first(body, ["attachments", "media"])),
    userId: first(body, ["userId", "user_id", "user.id"]),
  };
}

/** Normaliza um evento de status vindo da Ghost (§12). */
export function parseStatusEvent(body = {}) {
  return {
    ghostLocationId: first(body, ["locationId", "location_id"]),
    ghostMessageId: first(body, ["messageId", "message_id", "id"]),
    status: (first(body, ["status", "messageStatus", "state"]) || "").toLowerCase(),
    error: first(body, ["error", "errorMessage", "reason"]),
  };
}

/** Mapeia um status cru do GHL/WhatsApp pro nosso enum (§12). */
export function normalizeStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (["delivered", "delivery"].includes(s)) return "delivered";
  if (["read", "seen"].includes(s)) return "read";
  if (["failed", "undelivered", "error", "rejected"].includes(s)) return "failed";
  if (["sent", "submitted", "queued"].includes(s)) return "sent";
  if (["pending", "accepted"].includes(s)) return "pending";
  return null;
}
