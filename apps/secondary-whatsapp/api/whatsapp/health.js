/**
 * GET /api/whatsapp/health — saúde do subsistema Secondary WhatsApp.
 * Público (sem segredos), reporta prontidão de configuração.
 *
 * GET /api/whatsapp/health?deep=1  (com x-cron-secret) — checagem profunda:
 * resolve o token do Marketplace App (com refresh) e reporta se está válido.
 */
import { db } from "../../lib/server/db.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { getInstallationByMain, providerAppToken } from "../../lib/whatsapp/provider.js";

export default async function handler(req, res) {
  const base = {
    ok: true,
    service: "secondary-whatsapp-bridge",
    ready: {
      db: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      token_encryption: !!process.env.TOKEN_ENCRYPTION_KEY,
      webhook_verification: process.env.WA_SKIP_WEBHOOK_VERIFY === "1" ? "skipped" : "builtin_ed25519_key",
      app_token: !!process.env.GHL_APP_ACCESS_TOKEN,
    },
    endpoints: {
      ghost_inbound: "/webhooks/ghl/ghost/inbound",
      provider_outbound: "/webhooks/ghl/provider/outbound",
      status: "/webhooks/ghl/ghost/status",
    },
  };

  if (req.query?.deep === "1") {
    if (!checkCronSecret(req)) return res.status(401).json({ error: "unauthorized" });
    const mainLoc = req.query?.main_location_id;
    const out = { ...base, deep: {} };
    try {
      const inst = mainLoc ? await getInstallationByMain(mainLoc) : null;
      let tok = null, err = null;
      try { tok = await providerAppToken(inst); } catch (e) { err = e.message; }
      out.deep.app_token_resolved = !!tok;
      out.deep.app_token_error = err;
      // expiry atual (após refresh) do install mais recente
      const { data } = await db()
        .from("wa_oauth_installs")
        .select("location_id, company_id, user_type, expires_at")
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (data) {
        out.deep.install = data;
        out.deep.app_token_valid = data.expires_at ? new Date(data.expires_at).getTime() > Date.now() : false;
      } else {
        out.deep.install = null;
      }
    } catch (e) {
      out.deep.error = e.message;
    }
    return res.status(200).json(out);
  }

  return res.status(200).json(base);
}
