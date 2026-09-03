/**
 * POST /api/whatsapp/test-connection — botão "Test Connection" (§14).
 *
 * Body: { main_location_id } | { tenant_id }
 * Verifica se conseguimos autenticar e alcançar a Main e a Ghost account.
 * Atualiza last_checked_at / status / last_error na installation.
 *
 * Protegido pelo segredo administrativo (x-cron-secret).
 */
import { db } from "../../lib/server/db.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { getInstallationByMain, mainToken, ghostToken } from "../../lib/whatsapp/provider.js";
import { ghlRequest } from "../../lib/whatsapp/ghl-conversations.js";
import { log } from "../../lib/server/log.js";

async function pingLocation(token, locationId) {
  try {
    await ghlRequest(token, "GET", `/locations/${locationId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export default async function handler(req, res) {
  if (!checkCronSecret(req)) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const mainLocationId = body?.main_location_id;
  if (!mainLocationId) return res.status(400).json({ error: "missing_main_location_id" });

  try {
    const inst = await getInstallationByMain(mainLocationId);
    if (!inst) return res.status(404).json({ error: "installation_not_found" });

    const [main, ghost] = await Promise.all([
      pingLocation(mainToken(inst), inst.main_location_id),
      pingLocation(ghostToken(inst), inst.ghost_location_id),
    ]);

    const ok = main.ok && ghost.ok;
    const lastError = ok ? null : [main.error, ghost.error].filter(Boolean).join(" | ");

    await db()
      .from("provider_installations")
      .update({
        status: ok ? "active" : "error",
        last_error: lastError,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", inst.id);

    return res.status(200).json({
      ok,
      main: { location_id: inst.main_location_id, reachable: main.ok, error: main.error },
      ghost: { location_id: inst.ghost_location_id, reachable: ghost.ok, error: ghost.error },
    });
  } catch (err) {
    log.error("wa.test_connection.failed", { error: err.message });
    return res.status(500).json({ error: "internal_error", message: err.message });
  }
}
