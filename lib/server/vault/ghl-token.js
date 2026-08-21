/**
 * Resolve um access_token GHL válido para operar numa location — versão do Cofre.
 *
 * Lê de document_vault.installations (não da tabela do Referral), decripta com
 * a chave própria do Cofre e, se vencido, faz refresh via /oauth/token usando
 * as credenciais do app do Cofre (VAULT_GHL_CLIENT_ID / VAULT_GHL_CLIENT_SECRET).
 */
import { sql } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";

const REFRESH_MARGIN_MS = 60 * 1000; // refresh se faltar < 60s
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

export async function getVaultLocationToken(locationId) {
  if (!locationId) throw new Error("locationId required");

  const rows = await sql()`
    select location_id, access_token, refresh_token, expires_at, status
    from document_vault.installations
    where location_id = ${locationId}
    limit 1`;
  const row = rows[0];
  if (!row) throw new Error("installation_not_found");
  if (row.status !== "active") throw new Error(`installation_status_${row.status}`);

  const expiresMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const needsRefresh = !expiresMs || expiresMs - Date.now() < REFRESH_MARGIN_MS;
  if (!needsRefresh) return decrypt(row.access_token);

  if (!row.refresh_token) throw new Error("no_refresh_token");
  const currentRefresh = decrypt(row.refresh_token);
  const refreshed = await refreshOauthToken(currentRefresh);
  const expiresAt = new Date(
    Date.now() + (Number(refreshed.expires_in) || 3600) * 1000,
  ).toISOString();

  try {
    await sql()`
      update document_vault.installations set
        access_token = ${encrypt(refreshed.access_token)},
        refresh_token = ${encrypt(refreshed.refresh_token || currentRefresh)},
        expires_at = ${expiresAt}
      where location_id = ${locationId}`;
  } catch (updErr) {
    console.warn("[vault-token] persist refresh failed:", updErr.message);
  }

  return refreshed.access_token;
}

async function refreshOauthToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.VAULT_GHL_CLIENT_ID || "",
    client_secret: process.env.VAULT_GHL_CLIENT_SECRET || "",
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: "Location",
  });
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`refresh status ${r.status}: ${txt.slice(0, 160)}`);
  return JSON.parse(txt);
}
