/**
 * GET /api/r/[code]
 *
 * Redirector que cria um Stripe Checkout Session com o coupon do
 * indicado AUTO-APLICADO via discounts:[{coupon}], depois 303 redirect
 * pro URL do session.
 *
 * URL pattern: https://test-repo-ebon-nine.vercel.app/r/SPARKOFF
 *   → lookup do coupon_code em installations
 *   → checkout.sessions.create com discounts + line_items
 *   → 303 redirect pro session.url
 *
 * Vantagem sobre Payment Link + prefilled_promo_code:
 *   - Discount aparece já aplicado no Checkout (sem clicar Apply)
 *   - URL nossa fica perpétua (cada visita gera session fresca)
 *
 * Trade-off: cada session expira em 24h, mas como geramos on-demand,
 * nunca vê uma expirada.
 */
import { db } from "../../lib/server/db.js";
import { stripeClient } from "../../lib/server/stripe-coupon.js";
import { log } from "../../lib/server/log.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const code = String(req.query?.code || "").toUpperCase().trim();
  if (!code) return renderError(res, "Cupom ausente", "URL incompleta.");

  // Lookup do cupom em installations
  const { data: install, error } = await db()
    .from("installations")
    .select("location_id, location_name, stripe_coupon_id, coupon_code")
    .eq("coupon_code", code)
    .maybeSingle();
  if (error) {
    log.error("r.db_error", { code, error: error.message });
    return renderError(res, "Erro interno", "Tente novamente em alguns instantes.");
  }
  if (!install || !install.stripe_coupon_id) {
    log.warn("r.cupom_not_found", { code });
    return renderError(res, "Cupom inválido", `O cupom ${code} não foi encontrado.`);
  }

  const priceMonthly = process.env.STRIPE_PRICE_MONTHLY;
  const priceActivation = process.env.STRIPE_PRICE_ACTIVATION;
  if (!priceMonthly || !priceActivation) {
    log.error("r.prices_not_configured", {});
    return renderError(res, "Configuração pendente", "Planos não configurados ainda.");
  }

  const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;

  let session;
  try {
    session = await stripeClient().checkout.sessions.create({
      mode: "subscription",
      line_items: [
        { price: priceMonthly, quantity: 1 },
        { price: priceActivation, quantity: 1 },
      ],
      discounts: [{ coupon: install.stripe_coupon_id }],
      // 24h de validade (default já é isso, mas fica explícito)
      expires_at: Math.floor(Date.now() / 1000) + 23 * 60 * 60,
      success_url: `${base}/?paid=1&cs={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?canceled=1`,
      metadata: {
        indicador_location_id: install.location_id,
        indicador_location_name: (install.location_name || "").slice(0, 60),
        coupon_used: code,
        source: "spark-referral-hub",
      },
      subscription_data: {
        metadata: {
          indicador_location_id: install.location_id,
          coupon_used: code,
        },
      },
    });
  } catch (err) {
    log.error("r.session_create_failed", { code, error: err.message });
    return renderError(res, "Falha ao iniciar checkout", err.message);
  }

  log.info("r.redirect", {
    code,
    indicador: install.location_id,
    session_id: session.id,
  });

  // 303 redirect pro Stripe Checkout
  res.setHeader("Location", session.url);
  res.setHeader("Cache-Control", "no-store");
  return res.status(303).end();
}

function renderError(res, title, detail) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(404).send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><title>${title}</title>
<style>
body{font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#0f172a;padding:40px 24px;text-align:center}
.card{max-width:460px;margin:60px auto;background:#fff;border:1px solid #fecaca;border-radius:16px;padding:32px;box-shadow:0 4px 12px -4px rgba(220,38,38,.1)}
h1{font-size:22px;margin:0 0 8px;color:#b91c1c}
p{color:#64748b;margin:0 0 16px}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px}
.x{font-size:32px;color:#dc2626}
</style></head><body>
<div class="card">
<div class="x">!</div><h1>${escapeHtml(title)}</h1>
<p><code>${escapeHtml(detail || "")}</code></p>
<p>Volte ao hub do indicador e gere um novo link.</p>
</div></body></html>`);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
