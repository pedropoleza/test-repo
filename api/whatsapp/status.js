/**
 * POST /api/whatsapp/status   (rewrite: /webhooks/ghl/ghost/status)
 *
 * Webhook de status de mensagem vindo da GHOST (§12). Reflete
 * pending/sent/delivered/read/failed no provider da Main.
 *
 * Segurança (§16): valida a assinatura Ed25519 sobre o body CRU.
 */
import { readRawBody } from "../../lib/server/raw-body.js";
import { verifyGhlSignature, extractSignature } from "../../lib/whatsapp/signature.js";
import { parseStatusEvent } from "../../lib/whatsapp/payload.js";
import { processStatusEvent } from "../../lib/whatsapp/status.js";
import { log } from "../../lib/server/log.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "wa-status" });
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

  const sig = extractSignature(req.headers);
  const check = verifyGhlSignature(raw, sig);
  if (!check.valid) {
    log.warn("wa.status.bad_signature", { reason: check.reason });
    return res.status(401).json({ error: "invalid_signature", reason: check.reason });
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  try {
    const result = await processStatusEvent(parseStatusEvent(body));
    const code = result.status === "error" ? 422 : 200;
    return res.status(code).json(result);
  } catch (err) {
    log.error("wa.status.unhandled", { error: err.message });
    return res.status(500).json({ error: "internal_error", message: err.message });
  }
}
