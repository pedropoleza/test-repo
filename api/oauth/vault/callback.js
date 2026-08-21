/**
 * OAuth callback do app Cofre de Documentos (GHL) — handler real.
 *
 * App GHL distinto do Referral Hub: credenciais, banco e chave de cripto
 * próprios. Persiste em document_vault.installations (Sparkleads OS), não
 * no banco/tabela do Referral.
 *
 * Fluxo:
 *   1. Recebe `code` (OAuth code grant, user_type=Location)
 *   2. Troca por access/refresh tokens via /oauth/token
 *   3. Encripta os tokens (AES-256-GCM, VAULT_TOKEN_ENCRYPTION_KEY) e faz upsert
 *   4. Assina JWT curto e redireciona pro Cofre (/vault.html)
 *
 * Env vars necessárias na Vercel:
 *   VAULT_GHL_CLIENT_ID, VAULT_GHL_CLIENT_SECRET, PUBLIC_BASE_URL,
 *   VAULT_TOKEN_ENCRYPTION_KEY, VAULT_DATABASE_URL, JWT_SIGNING_KEY.
 */
import { encrypt } from "../../../lib/server/vault/crypto.js";
import { sign as jwtSign } from "../../../lib/server/jwt.js";
import { sql } from "../../../lib/server/vault/db.js";

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { code, error: oauthError, error_description } = req.query || {};
  if (oauthError) {
    return renderError(res, "OAuth recusado", `${oauthError}: ${error_description || ""}`);
  }
  if (!code || typeof code !== "string") {
    return renderError(res, "Code ausente", "A query string não contém ?code=...");
  }

  // 1) Troca de code por tokens
  let tokens;
  try {
    tokens = await exchangeCode(code, req);
  } catch (err) {
    console.error("[oauth-vault] token exchange failed:", err.message);
    return renderError(res, "Falha ao trocar code por tokens", err.message);
  }

  const { access_token, refresh_token, expires_in, scope, locationId, companyId, userType } = tokens;

  console.info("[oauth-vault] token response keys:", Object.keys(tokens || {}),
    "userType=", userType, "hasLocationId=", !!locationId);

  if (!access_token || !refresh_token) {
    return renderError(res, "Resposta inesperada do GHL",
      `Faltam tokens. Recebido: ${Object.keys(tokens || {}).join(", ") || "(vazio)"} | userType=${userType || "?"}`);
  }
  if (!locationId) {
    if (userType === "Company" || companyId) {
      return renderError(res, "Autorização em nível errado",
        `Você autorizou no nível Agency. Instale o Cofre em uma SUB-LOCATION específica (selecione a location na lista do GHL).`);
    }
    return renderError(res, "locationId ausente",
      `Tokens vieram sem locationId. Campos: ${Object.keys(tokens).join(", ")}.`);
  }

  // 2) Encripta tokens
  let encAccess, encRefresh;
  try {
    encAccess = encrypt(access_token);
    encRefresh = encrypt(refresh_token);
  } catch (err) {
    console.error("[oauth-vault] encrypt failed:", err.message);
    return renderError(res, "Erro de configuração", "TOKEN_ENCRYPTION_KEY ausente ou inválida");
  }

  // 3) Persistência (upsert por location_id)
  const expiresAt = new Date(Date.now() + (Number(expires_in) || 3600) * 1000).toISOString();
  let locationName = null;
  try {
    locationName = await fetchLocationName(access_token, locationId);
  } catch (err) {
    console.warn("[oauth-vault] could not fetch location name:", err.message);
  }

  try {
    await sql()`
      insert into document_vault.installations
        (location_id, location_name, company_id, access_token, refresh_token, expires_at, scope, status)
      values
        (${locationId}, ${locationName}, ${companyId || null}, ${encAccess}, ${encRefresh}, ${expiresAt}, ${scope || null}, 'active')
      on conflict (location_id) do update set
        location_name = excluded.location_name,
        company_id    = excluded.company_id,
        access_token  = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at    = excluded.expires_at,
        scope         = excluded.scope,
        status        = 'active'`;
  } catch (err) {
    console.error("[oauth-vault] persist failed:", err.message || err);
    return renderError(res, "Falha ao salvar instalação", err.message || "DB error");
  }

  console.info("[oauth-vault] installed:", locationId, locationName || "(no name)");

  // 4) JWT curto + redirect pro Cofre
  let session;
  try {
    session = jwtSign({ locationId, companyId, userType, app: "vault", role: "owner" }, { ttlSeconds: 600 });
  } catch (err) {
    console.error("[oauth-vault] jwt sign failed:", err.message);
    return renderError(res, "Erro de configuração", "JWT_SIGNING_KEY ausente ou inválida");
  }

  const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  res.setHeader(
    "Location",
    `${base}/vault.html?session=${encodeURIComponent(session)}&locationId=${encodeURIComponent(locationId)}`,
  );
  return res.status(302).end();
}

async function exchangeCode(code, req) {
  const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  const body = new URLSearchParams({
    client_id: process.env.VAULT_GHL_CLIENT_ID || "",
    client_secret: process.env.VAULT_GHL_CLIENT_SECRET || "",
    grant_type: "authorization_code",
    code,
    redirect_uri: `${base}/api/oauth/vault/callback`,
    user_type: "Location",
  });
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`status ${r.status}: ${txt.slice(0, 200)}`);
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`invalid JSON: ${txt.slice(0, 200)}`);
  }
}

async function fetchLocationName(accessToken, locationId) {
  const r = await fetch(`https://services.leadconnectorhq.com/locations/${locationId}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Version: "2021-07-28", Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`location ${r.status}`);
  const json = await r.json();
  return json?.location?.name || json?.name || null;
}

function renderError(res, title, detail) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(400).send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><title>${title}</title>
<style>
body { font-family: Inter, system-ui, sans-serif; background: #f8fafc; color: #0f172a; padding: 40px 24px; text-align: center; }
.card { max-width: 460px; margin: 60px auto; background: #fff; border: 1px solid #fecaca; border-radius: 16px; padding: 32px; box-shadow: 0 4px 12px -4px rgba(220,38,38,0.10); }
h1 { font-size: 22px; margin: 0 0 8px; color: #b91c1c; }
p { color: #64748b; margin: 0 0 16px; }
code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; word-break: break-all; }
.x { font-size: 32px; color: #dc2626; }
</style></head><body>
<div class="card"><div class="x">!</div><h1>${title}</h1>
<p><code>${escapeHtml(detail || "")}</code></p>
<p>Tente reinstalar o Cofre no GHL. Se persistir, contate o suporte.</p>
</div></body></html>`);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
