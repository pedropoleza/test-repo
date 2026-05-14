/**
 * POST /api/admin/recompute-tier?locationId=...
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Recomputa manualmente o tier de uma location e aplica/revoga discount.
 * Útil pra testes e ops manuais.
 */
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { recomputeTier } from "../../lib/server/tier-discount.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!checkCronSecret(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const locationId = req.query?.locationId;
  if (!locationId) return res.status(400).json({ error: "missing_locationId" });

  try {
    const result = await recomputeTier(locationId, { reason: "manual" });
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[admin.recompute-tier]", err);
    return res.status(500).json({ error: "internal", message: err.message });
  }
}
