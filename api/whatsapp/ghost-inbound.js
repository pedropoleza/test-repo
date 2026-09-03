/**
 * POST /api/whatsapp/ghost-inbound   (rewrite: /webhooks/ghl/ghost/inbound)
 *
 * Webhook InboundMessage da GHOST account (§3). O cliente mandou mensagem pro
 * WhatsApp #2; a Ghost dispara este webhook; nós reinjetamos na Main via nosso
 * Conversation Provider.
 *
 * Segurança (§16): valida a assinatura Ed25519 sobre o body CRU antes do parse.
 */
import { readRawBody } from "../../lib/server/raw-body.js";
import { verifyGhlSignature, extractSignature } from "../../lib/whatsapp/signature.js";
import { parseGhostInbound } from "../../lib/whatsapp/payload.js";
import { processGhostInbound } from "../../lib/whatsapp/inbound.js";
import { log } from "../../lib/server/log.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "wa-ghost-inbound" });
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
    log.warn("wa.ghost_inbound.bad_signature", { reason: check.reason });
    return res.status(401).json({ error: "invalid_signature", reason: check.reason });
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  const evt = parseGhostInbound(body);
  try {
    const result = await processGhostInbound(evt);
    // 200 sempre que processamos deterministicamente (inclui ignored/dedupe) —
    // não queremos que o GHL fique reentregando um evento já resolvido.
    const code = result.status === "error" ? 422 : 200;
    return res.status(code).json(result);
  } catch (err) {
    log.error("wa.ghost_inbound.unhandled", { error: err.message });
    return res.status(500).json({ error: "internal_error", message: err.message });
  }
}
