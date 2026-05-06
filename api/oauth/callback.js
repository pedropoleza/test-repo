/**
 * OAuth callback do GHL — handler real (Etapa 1).
 *
 * Fluxo:
 *   1. Recebe `code` da URL (OAuth code grant)
 *   2. Troca o code por access/refresh tokens via /oauth/token
 *   3. Encripta os tokens com TOKEN_ENCRYPTION_KEY (AES-256-GCM)
 *   4. Persiste em `installations` (upsert por location_id)
 *   5. Assina JWT curto com locationId/userId
 *   6. Redireciona pro hub com `?session=<jwt>`
 *
 * Pendente (Etapa 3):
 *   - Criar Stripe Coupon + Promotion Code (depende de D5)
 *   - Mapear stripe_customer_id (depende de D8)
 */
import Stripe from "stripe";
import { encrypt } from "../../lib/server/crypto.js";
import { sign as jwtSign } from "../../lib/server/jwt.js";
import { db } from "../../lib/server/db.js";

const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

// D5=a (working assumption): indicado ganha $20 once quando digita o cupom.
const INDICADO_DISCOUNT_USD = 20;

let _stripe = null;
function stripeClient() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

function deriveCouponCode(name) {
  const first = (name || "").trim().split(/\s+/)[0] || "";
  const slug = first
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return slug ? `${slug}OFF` : null;
}

/**
 * Cria (ou reaproveita) Stripe Coupon + Promotion Code para a
 * location. Em caso de colisão de Promotion Code, sufixa com 4 chars
 * do locationId.
 *
 * Retorna { couponCode, stripeCouponId, stripePromotionId } ou null
 * se a key não tiver escopo / Stripe falhar.
 */
async function ensureStripeCoupon(locationId, locationName) {
  const baseCode = deriveCouponCode(locationName) || `LOC${(locationId || "").slice(0, 6).toUpperCase()}OFF`;
  const stripe = stripeClient();
  try {
    // 1) Cria o Coupon (idempotência via metadata.location_id)
    const existing = await stripe.coupons.list({ limit: 100 }).catch(() => ({ data: [] }));
    let coupon = existing.data?.find(
      (c) => c.metadata?.location_id === locationId && c.metadata?.role === "indicado",
    );
    if (!coupon) {
      coupon = await stripe.coupons.create({
        amount_off: INDICADO_DISCOUNT_USD * 100,
        currency: "usd",
        duration: "once",
        name: `Indicação — ${locationName || locationId}`,
        metadata: { location_id: locationId, role: "indicado", source: "spark-referral-hub" },
      });
    }

    // 2) Cria o Promotion Code (com fallback de sufixo em colisão)
    let promo;
    let attemptCode = baseCode;
    for (let i = 0; i < 3; i++) {
      try {
        promo = await stripe.promotionCodes.create({
          coupon: coupon.id,
          code: attemptCode,
          metadata: { location_id: locationId },
        });
        break;
      } catch (err) {
        if (err?.code === "resource_already_exists" || /already/i.test(err.message)) {
          // Sufixar com 4 chars do locationId
          const suf = (locationId || "").slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "");
          attemptCode = `${baseCode}${suf}${i || ""}`;
          continue;
        }
        throw err;
      }
    }
    if (!promo) throw new Error("promo_code_collision_unresolved");

    return {
      couponCode: promo.code,
      stripeCouponId: coupon.id,
      stripePromotionId: promo.id,
    };
  } catch (err) {
    console.warn("[oauth-ghl] stripe coupon skipped:", err?.message || err);
    return null;
  }
}

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
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("[oauth-ghl] token exchange failed:", err.message);
    return renderError(res, "Falha ao trocar code por tokens", err.message);
  }

  const {
    access_token,
    refresh_token,
    expires_in,
    scope,
    locationId,
    companyId,
    userType,
  } = tokens;

  if (!access_token || !refresh_token || !locationId) {
    console.error("[oauth-ghl] incomplete token payload", Object.keys(tokens));
    return renderError(res, "Resposta inesperada do GHL", "Tokens ou locationId faltando");
  }

  // 2) Encripta tokens
  let encAccess, encRefresh;
  try {
    encAccess = encrypt(access_token);
    encRefresh = encrypt(refresh_token);
  } catch (err) {
    console.error("[oauth-ghl] encrypt failed:", err.message);
    return renderError(res, "Erro de configuração", "TOKEN_ENCRYPTION_KEY ausente ou inválida");
  }

  // 3) Persistência (upsert por location_id)
  const expiresAt = new Date(Date.now() + (Number(expires_in) || 3600) * 1000).toISOString();
  let locationName = null;
  try {
    locationName = await fetchLocationName(access_token, locationId);
  } catch (err) {
    console.warn("[oauth-ghl] could not fetch location name:", err.message);
  }

  // Garante o Stripe Coupon + Promotion Code dessa location.
  const couponData = await ensureStripeCoupon(locationId, locationName);

  try {
    const { error } = await db()
      .from("installations")
      .upsert(
        {
          location_id: locationId,
          location_name: locationName,
          access_token: encAccess,
          refresh_token: encRefresh,
          expires_at: expiresAt,
          scope: scope || null,
          status: "active",
          coupon_code: couponData?.couponCode || null,
          stripe_coupon_id: couponData?.stripeCouponId || null,
          stripe_promotion_id: couponData?.stripePromotionId || null,
        },
        { onConflict: "location_id" },
      );
    if (error) throw error;
  } catch (err) {
    console.error("[oauth-ghl] persist failed:", err.message || err);
    return renderError(res, "Falha ao salvar instalação", err.message || "DB error");
  }

  console.info("[oauth-ghl] installed:", locationId, locationName || "(no name)",
    couponData ? `coupon=${couponData.couponCode}` : "(no stripe coupon)");

  // 4) JWT curto
  let session;
  try {
    session = jwtSign({ locationId, companyId, userType, role: "owner" }, { ttlSeconds: 600 });
  } catch (err) {
    console.error("[oauth-ghl] jwt sign failed:", err.message);
    return renderError(res, "Erro de configuração", "JWT_SIGNING_KEY ausente ou inválida");
  }

  // 5) Redirect ao hub
  const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  res.setHeader(
    "Location",
    `${base}/?session=${encodeURIComponent(session)}&locationId=${encodeURIComponent(locationId)}`,
  );
  return res.status(302).end();
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: process.env.GHL_CLIENT_ID || "",
    client_secret: process.env.GHL_CLIENT_SECRET || "",
    grant_type: "authorization_code",
    code,
    redirect_uri: `${process.env.PUBLIC_BASE_URL || ""}/api/oauth/callback`,
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
    throw new Error(`status ${r.status}: ${txt.slice(0, 200)}`);
  }
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(`invalid JSON: ${txt.slice(0, 200)}`);
  }
}

async function fetchLocationName(accessToken, locationId) {
  const r = await fetch(`https://services.leadconnectorhq.com/locations/${locationId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
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
body { font-family: Inter, system-ui, sans-serif; background: #f8fafc;
  color: #0f172a; padding: 40px 24px; text-align: center; }
.card { max-width: 460px; margin: 60px auto; background: #fff;
  border: 1px solid #fecaca; border-radius: 16px; padding: 32px;
  box-shadow: 0 4px 12px -4px rgba(220,38,38,0.10); }
h1 { font-size: 22px; margin: 0 0 8px; color: #b91c1c; }
p { color: #64748b; margin: 0 0 16px; }
code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; word-break: break-all; }
.x { font-size: 32px; color: #dc2626; }
</style></head><body>
<div class="card">
<div class="x">!</div><h1>${title}</h1>
<p><code>${escapeHtml(detail || "")}</code></p>
<p>Tente reinstalar o app no GHL. Se persistir, contate o suporte.</p>
</div></body></html>`);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
