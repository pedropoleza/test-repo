/**
 * Persistência + refresh dos tokens do Marketplace App (OAuth install).
 *
 * O token do app é o exigido pelas APIs que envolvem o conversationProviderId:
 *   - injeção de inbound no Conversations da Main (§5)
 *   - status update do provider (§12)
 * Um PIT de location NÃO tem acesso ao provider (401 PROVIDER_NO_ACCESS).
 *
 * Tokens OAuth do GHL expiram em ~24h. Guardamos access+refresh criptografados
 * e fazemos refresh automático quando estão vencidos/perto de vencer, usando o
 * client_id/secret deste app (grant_type=refresh_token).
 */
import { db } from "../server/db.js";
import { encrypt, decrypt } from "../server/crypto.js";
import { log } from "../server/log.js";

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // renova se faltar < 5 min

/** Upsert do token de um install — criptografa em repouso. */
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

const ROW_COLS = "location_id, company_id, user_type, access_token, refresh_token, expires_at";

async function fetchRow({ locationId, companyId }) {
  if (locationId) {
    const { data } = await db()
      .from("wa_oauth_installs").select(ROW_COLS)
      .eq("location_id", locationId).maybeSingle();
    if (data) return data;
  }
  if (companyId) {
    const { data } = await db()
      .from("wa_oauth_installs").select(ROW_COLS)
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }
  const { data } = await db()
    .from("wa_oauth_installs").select(ROW_COLS)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data || null;
}

/** Faz o refresh_token grant, persiste os novos tokens e devolve o access novo. */
async function refreshRow(row) {
  if (!row.refresh_token) throw new Error("no_refresh_token");
  const body = new URLSearchParams({
    client_id: process.env.GHL_CLIENT_ID || "",
    client_secret: process.env.GHL_CLIENT_SECRET || "",
    grant_type: "refresh_token",
    refresh_token: decrypt(row.refresh_token),
    user_type: row.user_type || "Company",
  });
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`oauth_refresh_${r.status}: ${txt.slice(0, 160)}`);
  const t = JSON.parse(txt);
  const expiresAt = new Date(Date.now() + (Number(t.expires_in) || 86400) * 1000).toISOString();
  const patch = {
    access_token: encrypt(t.access_token),
    expires_at: expiresAt,
  };
  if (t.refresh_token) patch.refresh_token = encrypt(t.refresh_token);
  const { error } = await db()
    .from("wa_oauth_installs").update(patch).eq("location_id", row.location_id);
  if (error) log.warn("wa.oauth.persist_refresh_failed", { error: error.message });
  log.info("wa.oauth.refreshed", { location_id: row.location_id, expires_at: expiresAt });
  return t.access_token;
}

/**
 * Token do app válido (com refresh automático). Preferência: install da própria
 * location → company → mais recente. Retorna o access_token DECRIPTADO ou null.
 */
export async function getAppToken({ locationId, companyId } = {}) {
  const row = await fetchRow({ locationId, companyId });
  if (!row || !row.access_token) return null;
  const expMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!expMs || expMs - Date.now() < REFRESH_MARGIN_MS) {
    try {
      return await refreshRow(row);
    } catch (err) {
      log.error("wa.oauth.refresh_failed", { error: err.message });
      // devolve o atual como último recurso (pode estar vencido)
      return decrypt(row.access_token);
    }
  }
  return decrypt(row.access_token);
}

const GHL_LOCATION_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/locationToken";
// cache em memória por container quente: locationId -> { token, exp }
const _locCache = new Map();

/**
 * Token de nível LOCATION pra operar no Conversations/provider da Main.
 *
 * As APIs que envolvem o conversationProviderId (inbound inject §5, status §12)
 * exigem authClass = Location. Se o install do app foi feito na própria location,
 * usamos direto. Se foi a nível de agência (Company), cunhamos um token de
 * location via /oauth/locationToken (companyId + locationId).
 */
export async function getLocationToken({ companyId, locationId }) {
  if (!locationId) throw new Error("locationId required");

  // 1) install direto da location?
  const locRow = await fetchRow({ locationId });
  if (locRow && (locRow.user_type || "").toLowerCase() === "location") {
    return await getAppToken({ locationId });
  }

  // 2) cache quente
  const cached = _locCache.get(locationId);
  if (cached && cached.exp - Date.now() > REFRESH_MARGIN_MS) return cached.token;

  // 3) cunha a partir do token de agência (Company)
  let cid = companyId;
  if (!cid) {
    const anyCompany = await fetchRow({});
    cid = anyCompany?.company_id;
  }
  const companyTok = await getAppToken(cid ? { companyId: cid } : {});
  if (!companyTok) throw new Error("no_company_app_token");

  const body = new URLSearchParams({ companyId: cid || "", locationId });
  const r = await fetch(GHL_LOCATION_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${companyTok}`,
      Version: "2021-07-28",
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`location_token_${r.status}: ${txt.slice(0, 160)}`);
  const t = JSON.parse(txt);
  const exp = Date.now() + (Number(t.expires_in) || 86400) * 1000;
  _locCache.set(locationId, { token: t.access_token, exp });
  log.info("wa.oauth.location_token_minted", { locationId });
  return t.access_token;
}
