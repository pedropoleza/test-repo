/**
 * POST /api/whatsapp/provider-outbound   (rewrite: /webhooks/ghl/provider/outbound)
 *
 * Delivery URL do nosso Conversation Provider (§6). Quando o atendente responde
 * na Main selecionando "WhatsApp 2", o GHL NÃO envia sozinho — chama esta URL.
 * Nós resolvemos o contato na Ghost e enviamos pelo WhatsApp real (§7).
 *
 * Segurança (§16): valida a assinatura Ed25519 sobre o body CRU antes do parse.
 */
import { readRawBody } from "../../lib/server/raw-body.js";
import { verifyGhlSignature, extractSignature } from "../../lib/whatsapp/signature.js";
import { parseProviderOutbound } from "../../lib/whatsapp/payload.js";
import { processProviderOutbound } from "../../lib/whatsapp/outbound.js";
import { log } from "../../lib/server/log.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: "wa-provider-outbound" });
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
    log.warn("wa.provider_outbound.bad_signature", { reason: check.reason });
    return res.status(401).json({ error: "invalid_signature", reason: check.reason });
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  const evt = parseProviderOutbound(body);
  try {
    const result = await processProviderOutbound(evt);
    const code = result.status === "error" ? 422 : 200;
    return res.status(code).json(result);
  } catch (err) {
    log.error("wa.provider_outbound.unhandled", { error: err.message });
    return res.status(500).json({ error: "internal_error", message: err.message });
  }
}
