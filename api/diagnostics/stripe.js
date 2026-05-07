/**
 * GET /api/diagnostics/stripe
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Endpoint de diagnóstico — devolve estado do Stripe (account default
 * currency, country, lista de promo codes existentes). Útil pra validar
 * se cupons foram criados, e em qual moeda.
 *
 * Não expõe nada sensível além do que o usuário já tem no Dashboard.
 */
import Stripe from "stripe";

let _stripe = null;
function stripeClient() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers["x-cron-secret"];
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const out = {
    stripe_mode: process.env.STRIPE_MODE,
    has_secret: !!process.env.STRIPE_SECRET_KEY,
  };

  try {
    const account = await stripeClient().accounts.retrieve();
    out.account = {
      id: account.id,
      country: account.country,
      default_currency: account.default_currency,
      display_name: account.settings?.dashboard?.display_name,
    };
  } catch (err) {
    out.account_error = err.message;
  }

  try {
    const promos = await stripeClient().promotionCodes.list({ limit: 50 });
    out.promotion_codes_total = promos.data.length;
    out.promotion_codes = promos.data.map((p) => ({
      code: p.code,
      active: p.active,
      coupon_id: p.coupon?.id,
      amount_off: p.coupon?.amount_off,
      currency: p.coupon?.currency,
      percent_off: p.coupon?.percent_off,
      duration: p.coupon?.duration,
      valid: p.coupon?.valid,
      times_redeemed: p.times_redeemed,
      created: new Date(p.created * 1000).toISOString(),
      metadata: p.coupon?.metadata,
    }));
  } catch (err) {
    out.promo_codes_error = err.message;
  }

  try {
    const coupons = await stripeClient().coupons.list({ limit: 50 });
    out.coupons_total = coupons.data.length;
    out.coupons = coupons.data.map((c) => ({
      id: c.id,
      name: c.name,
      amount_off: c.amount_off,
      currency: c.currency,
      percent_off: c.percent_off,
      duration: c.duration,
      valid: c.valid,
      created: new Date(c.created * 1000).toISOString(),
    }));
  } catch (err) {
    out.coupons_error = err.message;
  }

  return res.status(200).json(out);
}
