/**
 * Message Logs (§15) — registro legível de cada trânsito de mensagem, pra
 * diagnosticar sem entrar no banco.
 *
 * Nunca lança: logar não pode quebrar o fluxo da mensagem.
 */
import { db } from "../server/db.js";
import { log } from "../server/log.js";

function preview(msg, n = 140) {
  if (!msg) return "";
  const s = String(msg).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * @param {object} entry
 * @param {string} entry.tenantId
 * @param {string} [entry.providerId]
 * @param {string} [entry.contactName]
 * @param {string} [entry.phone]
 * @param {'INBOUND'|'OUTBOUND'} entry.direction
 * @param {string} [entry.message]
 * @param {string} [entry.source]       'Ghost' | 'Main'
 * @param {string} [entry.destination]  'Main' | 'Ghost' | 'WhatsApp'
 * @param {string} [entry.status]
 * @param {string} [entry.error]
 * @param {string} [entry.bridgeId]
 */
export async function recordLog(entry) {
  try {
    await db().from("whatsapp_message_logs").insert({
      tenant_id: entry.tenantId,
      provider_id: entry.providerId || null,
      contact_name: entry.contactName || null,
      phone: entry.phone || null,
      direction: entry.direction || null,
      message_preview: preview(entry.message),
      source: entry.source || null,
      destination: entry.destination || null,
      status: entry.status || null,
      error: entry.error ? String(entry.error).slice(0, 500) : null,
      bridge_id: entry.bridgeId || null,
    });
  } catch (err) {
    log.warn("wa.recordLog.failed", { error: err.message });
  }
}
