/**
 * GET /api/whatsapp/logs — backend da tela "Message Logs" (§15).
 *
 * Query:
 *   tenant_id     (opcional) filtra por tenant
 *   direction     (opcional) INBOUND | OUTBOUND
 *   limit         (default 100, max 500)
 *   before        (opcional) ISO timestamp pra paginação
 *
 * Protegido pelo segredo administrativo (x-cron-secret).
 */
import { db } from "../../lib/server/db.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { log } from "../../lib/server/log.js";

export default async function handler(req, res) {
  if (!checkCronSecret(req)) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { tenant_id, direction, before } = req.query || {};
  const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 100, 1), 500);

  try {
    let q = db()
      .from("whatsapp_message_logs")
      .select(
        "id, occurred_at, contact_name, phone, direction, message_preview, source, destination, status, error",
      )
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (tenant_id) q = q.eq("tenant_id", tenant_id);
    if (direction) q = q.eq("direction", direction);
    if (before) q = q.lt("occurred_at", before);

    const { data, error } = await q;
    if (error) throw error;
    return res.status(200).json({ logs: data || [], count: data?.length || 0 });
  } catch (err) {
    log.error("wa.logs.get_failed", { error: err.message });
    return res.status(500).json({ error: "internal_error", message: err.message });
  }
}
