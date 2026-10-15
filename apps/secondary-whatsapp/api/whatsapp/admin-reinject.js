/**
 * POST /api/whatsapp/admin-reinject — admin (x-cron-secret).
 *
 * Reexecuta o fluxo de inbound (processGhostInbound) a partir de um evento
 * fornecido no body — sem passar pelo webhook/assinatura. Usos:
 *   - testar o inject de ponta a ponta;
 *   - reprocessar inbounds que falharam (ex.: antes do fix de token do app).
 *
 * Body = o mesmo shape normalizado do inbound:
 *   { ghostLocationId, ghostContactId, ghostMessageId, phone, contactName,
 *     message, attachments, direction }
 */
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { processGhostInbound } from "../../lib/whatsapp/inbound.js";

export default async function handler(req, res) {
  if (!checkCronSecret(req)) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid_json" }); } }
  body = body || {};
  if (!body.ghostLocationId) return res.status(400).json({ error: "missing_ghostLocationId" });
  if (!body.ghostMessageId) return res.status(400).json({ error: "missing_ghostMessageId" });
  const evt = {
    ghostLocationId: body.ghostLocationId,
    ghostContactId: body.ghostContactId,
    ghostConversationId: body.ghostConversationId,
    ghostMessageId: body.ghostMessageId,
    phone: body.phone,
    contactName: body.contactName,
    message: body.message || "",
    attachments: body.attachments || [],
    direction: body.direction || "inbound",
  };
  try {
    const result = await processGhostInbound(evt);
    return res.status(result.status === "error" ? 422 : 200).json(result);
  } catch (err) {
    return res.status(500).json({ error: "internal_error", message: err.message });
  }
}
