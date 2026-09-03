/**
 * GET/PUT /api/whatsapp/settings — backend da tela "Secondary WhatsApp" (§14).
 *
 * GET  ?main_location_id=... | ?tenant_id=...  → estado do provider pra UI
 * PUT  body → cria/atualiza a provider_installation (multi-tenant, §13)
 *
 * Protegido pelo mesmo segredo administrativo do projeto (CRON_SECRET via
 * header x-cron-secret). Tokens são criptografados em repouso antes de gravar.
 */
import { db } from "../../lib/server/db.js";
import { encrypt } from "../../lib/server/crypto.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { getInstallationByMain } from "../../lib/whatsapp/provider.js";
import { log } from "../../lib/server/log.js";

const PUBLIC_COLS =
  "id, tenant_id, agency_id, main_location_id, main_location_name, ghost_location_id, " +
  "ghost_location_name, ghost_whatsapp_number, conversation_provider_id, provider_alias, " +
  "provider_logo_url, status, last_error, last_checked_at, created_at, updated_at";

/** Nunca vaza tokens; deriva um resumo amigável pra UI (§14). */
function toView(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    provider_status: row.status === "active" ? "Connected" : row.status,
    main_account: row.main_location_name || row.main_location_id,
    main_location_id: row.main_location_id,
    secondary_account: row.ghost_location_name || row.ghost_location_id,
    ghost_location_id: row.ghost_location_id,
    whatsapp_number: row.ghost_whatsapp_number,
    provider: row.provider_alias || "Spark WhatsApp",
    conversation_provider_id: row.conversation_provider_id,
    provider_logo_url: row.provider_logo_url,
    last_error: row.last_error,
    last_checked_at: row.last_checked_at,
    updated_at: row.updated_at,
  };
}

export default async function handler(req, res) {
  if (!checkCronSecret(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (req.method === "GET") {
    const { main_location_id, tenant_id } = req.query || {};
    try {
      if (main_location_id) {
        const inst = await getInstallationByMain(main_location_id);
        return res.status(200).json({ installation: toView(inst) });
      }
      let q = db().from("provider_installations").select(PUBLIC_COLS).order("created_at", { ascending: false });
      if (tenant_id) q = q.eq("tenant_id", tenant_id);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ installations: (data || []).map(toView) });
    } catch (err) {
      log.error("wa.settings.get_failed", { error: err.message });
      return res.status(500).json({ error: "internal_error", message: err.message });
    }
  }

  if (req.method === "PUT" || req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid_json" }); }
    }
    body = body || {};

    const required = ["tenant_id", "main_location_id", "ghost_location_id", "conversation_provider_id"];
    const missing = required.filter((k) => !body[k]);
    if (missing.length) return res.status(400).json({ error: "missing_fields", fields: missing });

    const row = {
      tenant_id: body.tenant_id,
      agency_id: body.agency_id || null,
      main_location_id: body.main_location_id,
      main_location_name: body.main_location_name || null,
      ghost_location_id: body.ghost_location_id,
      ghost_location_name: body.ghost_location_name || null,
      ghost_whatsapp_number: body.ghost_whatsapp_number || null,
      conversation_provider_id: body.conversation_provider_id,
      provider_alias: body.provider_alias || "Spark WhatsApp",
      provider_logo_url: body.provider_logo_url || null,
      status: body.status || "active",
    };
    // Tokens só são gravados quando fornecidos — criptografados em repouso.
    if (body.main_access_token) row.main_access_token = encrypt(String(body.main_access_token));
    if (body.ghost_access_token) row.ghost_access_token = encrypt(String(body.ghost_access_token));

    try {
      const { data, error } = await db()
        .from("provider_installations")
        .upsert(row, { onConflict: "main_location_id" })
        .select(PUBLIC_COLS)
        .single();
      if (error) throw error;
      return res.status(200).json({ installation: toView(data) });
    } catch (err) {
      log.error("wa.settings.upsert_failed", { error: err.message });
      return res.status(500).json({ error: "internal_error", message: err.message });
    }
  }

  res.setHeader("Allow", "GET, POST, PUT");
  return res.status(405).json({ error: "method_not_allowed" });
}
