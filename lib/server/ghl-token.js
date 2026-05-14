/**
 * Resolve um access_token GHL válido para operar numa location.
 *
 * Estratégia (em ordem de preferência):
 *   1. Se a installation é 'agency_pit' → retorna GHL_AGENCY_PIT direto
 *      (PIT da agency tem acesso agency-wide).
 *   2. Se é 'oauth' → checa expires_at:
 *      - Se ainda válido (>60s de margem): decripta e retorna access_token
 *      - Se vencido / quase vencendo: faz refresh via /oauth/token
 *        (grant_type=refresh_token), re-encripta, persiste, retorna novo
 *
 * Sem refresh, installations OAuth quebram silenciosamente em ~24h.
 */
import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";

const REFRESH_MARGIN_MS = 60 * 1000; // refresh se faltar < 60s
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

export async function getLocationAccessToken(locationId) {
  if (!locationId) throw new Error("locationId required");

  const { data: row, error } = await db()
    .from("installations")
    .select(
      "location_id, provision_source, access_token, refresh_token, expires_at, status",
    )
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("installation_not_found");
  if (row.status !== "active") throw new Error(`installation_status_${row.status}`);

  if (row.provision_source === "agency_pit") {
    const pit = process.env.GHL_AGENCY_PIT;
    if (!pit) throw new Error("GHL_AGENCY_PIT not set");
    return pit;
  }

  // OAuth path
  const expiresMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const needsRefresh = !expiresMs || expiresMs - Date.now() < REFRESH_MARGIN_MS;
  if (!needsRefresh) {
    return decrypt(row.access_token);
  }

  // Refresh
  if (!row.refresh_token) {
    throw new Error("no_refresh_token");
  }
  const refreshed = await refreshOauthToken(decrypt(row.refresh_token));
  const expiresAt = new Date(
    Date.now() + (Number(refreshed.expires_in) || 3600) * 1000,
  ).toISOString();
  const encAccess = encrypt(refreshed.access_token);
  const encRefresh = encrypt(refreshed.refresh_token || decrypt(row.refresh_token));

  const { error: updErr } = await db()
    .from("installations")
    .update({
      access_token: encAccess,
      refresh_token: encRefresh,
      expires_at: expiresAt,
    })
    .eq("location_id", locationId);
  if (updErr) console.warn("[ghl-token] persist refreshed token failed:", updErr.message);

  console.info("[ghl-token] refreshed:", locationId, "expires_at=", expiresAt);
  return refreshed.access_token;
}

async function refreshOauthToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.GHL_CLIENT_ID || "",
    client_secret: process.env.GHL_CLIENT_SECRET || "",
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: "Location",
  });
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const txt = await r.text();
  if (!r.ok) {
    throw new Error(`refresh_failed_${r.status}: ${txt.slice(0, 160)}`);
  }
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`refresh_invalid_json: ${txt.slice(0, 160)}`);
  }
}
