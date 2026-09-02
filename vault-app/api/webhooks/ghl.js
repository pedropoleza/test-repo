/**
 * POST /api/webhooks/ghl — webhook do app Cofre de Documentos.
 *
 * Faz duas coisas:
 *  (a) INSTALL/UNINSTALL → marca status da installation.
 *  (b) InboundMessage / OutboundMessage COM ANEXO → baixa o(s) arquivo(s) e
 *      grava automaticamente na pasta do contato (source='conversation'),
 *      idempotente por messageId. É assim que um documento enviado numa
 *      conversa aparece sozinho no Cofre daquele contato.
 *
 * Assinatura: se GHL_WEBHOOK_PUBLIC_KEY estiver setada, valida RSA-SHA256 do
 * body cru (header x-wh-signature). Sem a chave, signature_valid=null.
 *
 * Idempotência do evento: PK event_id em document_vault.webhook_events.
 * GET retorna saúde do endpoint.
 */
import { createVerify, createHash } from "node:crypto";
import { sql } from "../../lib/db.js";
import { encrypt } from "../../lib/crypto.js";
import { getVaultLocationToken } from "../../lib/ghl-token.js";
import { readRawBody } from "../../lib/raw-body.js";

export const config = { api: { bodyParser: false }, maxDuration: 30 };

const GHL_BASE = "https://services.leadconnectorhq.com";
const MAX_BYTES = 10 * 1024 * 1024; // 10MB por anexo guardado no banco

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "vault-ghl-webhook",
      ready_for_signature_validation: !!process.env.GHL_WEBHOOK_PUBLIC_KEY,
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let raw;
  try { raw = await readRawBody(req); }
  catch (err) { return res.status(400).json({ error: "raw_body_error", message: err.message }); }

  let payload;
  try { payload = JSON.parse(raw.toString("utf8") || "{}"); }
  catch { return res.status(400).json({ error: "invalid_json" }); }

  const signatureValid = verifySignature(raw, req.headers["x-wh-signature"]);
  const eventType = payload.type || payload.event || "unknown";
  const eventId = payload.webhookId || payload.messageId || payload.id || createHash("sha256").update(raw).digest("hex");
  const locationId = payload.locationId || payload.location_id || null;

  // Persiste o evento (idempotente).
  try {
    const inserted = await sql()`
      insert into document_vault.webhook_events
        (event_id, event_type, payload, headers, signature_valid, processed)
      values
        (${eventId}, ${eventType}, ${sql().json(payload)}, ${sql().json(pickHeaders(req.headers))}, ${signatureValid}, false)
      on conflict (event_id) do nothing
      returning event_id`;
    if (!inserted.length) return res.status(200).json({ ok: true, duplicate: true });
  } catch (err) {
    console.error("[vault-webhook] persist failed:", err.message || err);
    return res.status(500).json({ error: "persist_failed" });
  }

  const trusted = signatureValid !== false;
  let result = {};
  try {
    if (trusted && locationId && /uninstall/i.test(eventType)) {
      await sql()`update document_vault.installations set status = 'uninstalled' where location_id = ${locationId}`;
      await markProcessed(eventId);
    } else if (trusted && /install/i.test(eventType)) {
      await markProcessed(eventId);
    } else if (trusted && isMessage(eventType, payload)) {
      result = await handleMessageAttachments(payload, eventId);
      await markProcessed(eventId);
    }
  } catch (err) {
    console.warn("[vault-webhook] action failed:", err.message || err);
  }

  return res.status(200).json({ ok: true, ...result });
}

function isMessage(eventType, payload) {
  return /message/i.test(eventType) || !!(payload.messageType && (payload.attachments || payload.message?.attachments));
}

/**
 * Baixa os anexos da mensagem e grava na pasta do contato.
 */
async function handleMessageAttachments(payload, eventId) {
  const locationId = payload.locationId || payload.location_id;
  const contactId = payload.contactId || payload.contact_id;
  const messageId = payload.messageId || payload.id || eventId;
  let attachments = payload.attachments || payload.message?.attachments || [];
  if (!Array.isArray(attachments)) attachments = attachments ? [attachments] : [];
  if (!locationId || !contactId || !attachments.length) return { attachments: 0 };

  const token = await getVaultLocationToken(locationId).catch(() => null);
  const contactName = token ? await fetchContactName(token, contactId).catch(() => null) : null;

  let stored = 0;
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    const url = typeof a === "string" ? a : (a.url || a.link || a.fileUrl || a.attachmentUrl);
    if (!url) continue;
    const sourceRef = `${messageId}:${i}`;

    let buf = null, mime = (typeof a === "object" && a.type) || null;
    try {
      let resp = await fetch(url);
      if (!resp.ok && token) resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) {
        const ab = await resp.arrayBuffer();
        if (ab.byteLength <= MAX_BYTES) { buf = Buffer.from(ab); mime = resp.headers.get("content-type") || mime; }
      }
    } catch (err) { console.warn("[vault-webhook] download failed:", err.message); }

    const filename = safeName(url, a);
    try {
      await sql()`
        insert into document_vault.documents
          (location_id, contact_id, contact_name, source, source_ref, contact_resolution,
           ghl_url_enc, filename, mime, size_bytes, status, content, created_at_ghl)
        values
          (${locationId}, ${contactId}, ${contactName}, 'conversation', ${sourceRef}, 'conversation_fallback',
           ${url ? encrypt(url) : null}, ${filename}, ${mime}, ${buf ? buf.length : (typeof a === "object" ? a.size : null) || null},
           ${buf ? "mirrored" : "pending"}, ${buf}, now())
        on conflict (location_id, source, source_ref) do nothing`;
      stored++;
    } catch (err) { console.warn("[vault-webhook] store failed:", err.message); }
  }
  return { attachments: attachments.length, stored };
}

async function fetchContactName(token, contactId) {
  const r = await fetch(`${GHL_BASE}/contacts/${contactId}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" } });
  if (!r.ok) return null;
  const j = await r.json();
  const c = j.contact || {};
  return c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || null;
}

function safeName(url, a) {
  if (typeof a === "object" && (a.fileName || a.name)) return a.fileName || a.name;
  try { return decodeURIComponent((url.split("?")[0].split("/").pop()) || "arquivo"); }
  catch { return "arquivo"; }
}

function verifySignature(raw, sig) {
  const pubKey = process.env.GHL_WEBHOOK_PUBLIC_KEY;
  if (!pubKey || !sig) return null;
  try { return createVerify("RSA-SHA256").update(raw).verify(pubKey, String(sig), "base64"); }
  catch (err) { console.warn("[vault-webhook] signature verify error:", err.message); return false; }
}

async function markProcessed(eventId) {
  await sql()`update document_vault.webhook_events set processed = true, processed_at = ${new Date().toISOString()} where event_id = ${eventId}`;
}

function pickHeaders(h) {
  const keep = ["x-wh-signature", "user-agent", "content-type"];
  const out = {};
  for (const k of keep) if (h[k]) out[k] = h[k];
  return out;
}
