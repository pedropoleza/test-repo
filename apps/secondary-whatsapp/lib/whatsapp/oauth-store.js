/**
 * Persistência dos tokens do Marketplace App capturados no OAuth install.
 *
 * O token do app é o exigido pela API de status do provider (§12) — os PITs
 * por-location não fazem status update no provider (o provider pertence ao app).
 * Guardamos aqui, criptografado, e servimos como fallback pro providerAppToken().
 */
import { db } from "../server/db.js";
import { encrypt, decrypt } from "../server/crypto.js";

/** Upsert do token de um install (location) — criptografa em repouso. */
export async function saveOauthInstall({
  locationId,
  companyId,
  userType,
  accessToken,
  refreshToken,
  expiresAt,
  scope,
}) {
  if (!locationId) throw new Error("locationId required");
  if (!accessToken) throw new Error("accessToken required");
  const row = {
    location_id: locationId,
    company_id: companyId || null,
    user_type: userType || null,
    access_token: encrypt(accessToken),
    refresh_token: refreshToken ? encrypt(refreshToken) : null,
    expires_at: expiresAt || null,
    scope: scope || null,
  };
  const { error } = await db()
    .from("wa_oauth_installs")
    .upsert(row, { onConflict: "location_id" });
  if (error) throw error;
}

/**
 * Token do app pra usar em status update. Preferimos o install da própria
 * location; senão o mais recente do mesmo company; senão o mais recente global.
 * Retorna o token DECRIPTADO ou null.
 */
export async function getAppToken({ locationId, companyId } = {}) {
  const pick = (row) => (row?.access_token ? decrypt(row.access_token) : null);

  if (locationId) {
    const { data } = await db()
      .from("wa_oauth_installs")
      .select("access_token")
      .eq("location_id", locationId)
      .maybeSingle();
    if (data) return pick(data);
  }
  if (companyId) {
    const { data } = await db()
      .from("wa_oauth_installs")
      .select("access_token")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return pick(data);
  }
  const { data } = await db()
    .from("wa_oauth_installs")
    .select("access_token")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return pick(data);
}
