/**
 * GET /api/oauth/callback — OAuth install do app de WhatsApp secundário.
 *
 * Usa as credenciais DESTE app (GHL_CLIENT_ID / GHL_CLIENT_SECRET setadas no
 * projeto secondary-whatsapp) — NÃO as do referral hub. O install é o que faz
 * o Custom Conversation Provider aparecer no Conversations da location.
 *
 * Fluxo:
 *   1. recebe ?code
 *   2. troca por access/refresh token (grant_type=authorization_code)
 *   3. guarda o token do app (criptografado) pra status sync (§12)
 *   4. mostra página de sucesso
 *
 * redirect_uri precisa bater EXATAMENTE com o Redirect URL registrado no app
 * e usado no authorize — montamos de PUBLIC_BASE_URL + /api/oauth/callback.
 */
import { saveOauthInstall } from "../../lib/whatsapp/oauth-store.js";
import { log } from "../../lib/server/log.js";

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

  const clientId = process.env.GHL_CLIENT_ID;
  const clientSecret = process.env.GHL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return renderError(res, "App não configurado", "GHL_CLIENT_ID / GHL_CLIENT_SECRET ausentes neste projeto.");
  }

  const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  const redirectUri = `${base}/api/oauth/callback`;

  let tokens;
  try {
    tokens = await exchangeCode(code, clientId, clientSecret, redirectUri);
  } catch (err) {
    log.error("wa.oauth.exchange_failed", { error: err.message });
    return renderError(res, "Falha ao trocar code por tokens", err.message);
  }

  const locationId = tokens.locationId || tokens.location_id;
  const companyId = tokens.companyId || tokens.company_id;
  const userType = tokens.userType || tokens.user_type;

  if (tokens.access_token && (locationId || companyId)) {
    try {
      await saveOauthInstall({
        locationId: locationId || companyId, // se agency install, chaveia por company
        companyId,
        userType,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + (Number(tokens.expires_in) || 86400) * 1000).toISOString(),
        scope: tokens.scope,
      });
    } catch (err) {
      // não bloqueia o install se a persistência falhar — o provider já foi habilitado
      log.warn("wa.oauth.persist_failed", { error: err.message });
    }
  }

  log.info("wa.oauth.installed", { locationId, companyId, userType });
  return renderSuccess(res, { locationId, companyId });
}

async function exchangeCode(code, clientId, clientSecret, redirectUri) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
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
  if (!r.ok) throw new Error(`status ${r.status}: ${txt.slice(0, 200)}`);
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`invalid JSON: ${txt.slice(0, 200)}`);
  }
}

function page(res, status, title, bodyHtml, color) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(status).send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#0f172a;
    padding:48px 24px;text-align:center}
  .card{max-width:460px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;
    border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(15,23,42,.06)}
  .dot{width:56px;height:56px;border-radius:50%;margin:0 auto 16px;display:grid;
    place-items:center;background:${color}22;color:${color};font-size:28px;font-weight:800}
  h1{font-size:20px;margin:0 0 8px}p{color:#64748b;margin:6px 0}
  code{background:#f1f5f9;padding:2px 6px;border-radius:6px;font-size:12px}
</style></head>
<body><div class="card">${bodyHtml}</div></body></html>`);
}

function renderSuccess(res, { locationId, companyId }) {
  return page(res, 200, "App instalado", `
    <div class="dot">✓</div>
    <h1>Spark WhatsApp instalado</h1>
    <p>O provider já está disponível no Conversations desta conta.</p>
    <p>Location: <code>${escapeHtml(locationId || "—")}</code></p>
    <p style="margin-top:16px;font-size:13px">Pode fechar esta aba.</p>
  `, "#16a34a");
}

function renderError(res, title, detail) {
  return page(res, 400, title, `
    <div class="dot">!</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
    <p style="margin-top:16px;font-size:13px">Tente reinstalar o app no GHL. Se persistir, contate o suporte.</p>
  `, "#dc2626");
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
