/**
 * GET /api/whatsapp/health — saúde do subsistema Secondary WhatsApp.
 * Público (sem segredos), reporta apenas prontidão de configuração.
 */
export default function handler(req, res) {
  return res.status(200).json({
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
  });
}
