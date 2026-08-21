/**
 * POST /api/webhooks/ghl-vault — webhook do app Cofre de Documentos.
 *
 * Postura (mesma do Referral Hub): a fonte da verdade dos documentos é o
 * POLL incremental (/api/cron/vault-harvest). O webhook é best-effort — serve
 * pra (a) marcar INSTALL/UNINSTALL e (b), quando o GHL emitir, subir a captura
 * de mídia para "instantâneo". Nunca é tratado como confiável sem assinatura.
 *
 * Assinatura: se VAULT_GHL_WEBHOOK_PUBLIC_KEY (PEM público do GHL) estiver
 * configurada, verifica RSA-SHA256 sobre o body cru (header x-wh-signature).
 * Sem a chave, grava signature_valid=null e não age em nada sensível.
 *
 * Idempotência: PK event_id em vault_webhook_events.
 *
 * GET retorna saúde do endpoint.
 */
import { createVerify, createHash } from "node:crypto";
import { db } from "../../lib/server/db.js";
import { readRawBody } from "../../lib/server/raw-body.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "vault-ghl-webhook",
      ready_for_signature_validation: !!process.env.VAULT_GHL_WEBHOOK_PUBLIC_KEY,
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: "raw_body_error", message: err.message });
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  // Assinatura (opcional até a chave pública estar configurada)
  const signatureValid = verifySignature(raw, req.headers["x-wh-signature"]);

  const eventType = payload.type || payload.event || "unknown";
  const eventId =
    payload.webhookId || payload.id ||
    createHash("sha256").update(raw).digest("hex");
  const locationId = payload.locationId || payload.location_id || null;

  // Persiste o evento (idempotente por event_id)
  try {
    const { error } = await db().from("vault_webhook_events").insert({
      event_id: eventId,
      event_type: eventType,
      payload,
      headers: pickHeaders(req.headers),
      signature_valid: signatureValid,
      processed: false,
    });
    // 23505 = unique_violation → duplicado, já recebemos. Responde 200.
    if (error && error.code === "23505") {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    if (error) throw error;
  } catch (err) {
    console.error("[vault-webhook] persist failed:", err.message || err);
    return res.status(500).json({ error: "persist_failed" });
  }

  // Ações confiáveis só quando a assinatura confere (ou ainda não exigida).
  const trusted = signatureValid !== false;
  try {
    if (trusted && locationId && /uninstall/i.test(eventType)) {
      await db().from("vault_installations")
        .update({ status: "uninstalled" }).eq("location_id", locationId);
      await markProcessed(eventId);
    } else if (trusted && /install/i.test(eventType)) {
      // Instalação: a criação da row acontece no OAuth callback. Só registra.
      await markProcessed(eventId);
    }
    // Eventos de mídia/contato ficam processed=false para o harvester consumir.
  } catch (err) {
    console.warn("[vault-webhook] action skipped:", err.message || err);
  }

  return res.status(200).json({ ok: true });
}

function verifySignature(raw, sig) {
  const pubKey = process.env.VAULT_GHL_WEBHOOK_PUBLIC_KEY;
  if (!pubKey || !sig) return null; // ainda não exigido
  try {
    const ok = createVerify("RSA-SHA256").update(raw).verify(pubKey, String(sig), "base64");
    return ok;
  } catch (err) {
    console.warn("[vault-webhook] signature verify error:", err.message);
    return false;
  }
}

async function markProcessed(eventId) {
  await db().from("vault_webhook_events")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq("event_id", eventId);
}

function pickHeaders(h) {
  const keep = ["x-wh-signature", "user-agent", "content-type"];
  const out = {};
  for (const k of keep) if (h[k]) out[k] = h[k];
  return out;
}
