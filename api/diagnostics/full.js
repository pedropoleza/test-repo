/**
 * GET /api/diagnostics/full
 *   ?mode=location&locationId=...   → estado completo de 1 location
 *   ?mode=stripe                    → estado geral do Stripe (default)
 *   ?mode=dlq                       → webhook_events com processed=false
 *
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Endpoint único de diagnóstico (Hobby plan: 12 funções no máximo).
 */
import { db } from "../../lib/server/db.js";
import { stripeClient } from "../../lib/server/stripe-coupon.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { resolveStripeCustomerId } from "../../lib/server/d8-resolver.js";

export default async function handler(req, res) {
  if (!checkCronSecret(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const mode = (req.query?.mode || "stripe").toLowerCase();

  if (mode === "location") return locationDetail(req, res);
  if (mode === "dlq") return dlqState(req, res);
  return stripeState(req, res);
}

async function stripeState(_req, res) {
  const out = {
    mode: "stripe",
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
      amount_off: p.coupon?.amount_off,
      currency: p.coupon?.currency,
      percent_off: p.coupon?.percent_off,
      duration: p.coupon?.duration,
      valid: p.coupon?.valid,
      times_redeemed: p.times_redeemed,
      metadata: p.coupon?.metadata,
    }));
  } catch (err) {
    out.promo_codes_error = err.message;
  }

  // Payment Links (precisa de escopo Payment Links: Read na restricted key)
  try {
    const links = await stripeClient().paymentLinks.list({ limit: 20, active: true });
    out.payment_links = links.data.map((l) => ({
      id: l.id,
      url: l.url,
      active: l.active,
      allow_promotion_codes: l.allow_promotion_codes,
      after_completion: l.after_completion,
      created: new Date(l.created * 1000).toISOString(),
      metadata: l.metadata,
    }));
  } catch (err) {
    out.payment_links_error = err.message;
  }

  // Products + Prices (precisa de escopo Products: Read)
  try {
    const products = await stripeClient().products.list({ limit: 20, active: true });
    out.products = [];
    for (const p of products.data) {
      const prices = await stripeClient().prices.list({
        product: p.id,
        limit: 10,
        active: true,
      });
      out.products.push({
        id: p.id,
        name: p.name,
        prices: prices.data.map((pr) => ({
          id: pr.id,
          unit_amount: pr.unit_amount,
          currency: pr.currency,
          recurring: pr.recurring
            ? { interval: pr.recurring.interval }
            : null,
          nickname: pr.nickname,
        })),
      });
    }
  } catch (err) {
    out.products_error = err.message;
  }

  return res.status(200).json(out);
}

async function dlqState(_req, res) {
  const { data: pending, error } = await db()
    .from("webhook_events")
    .select("source, event_id, event_type, received_at, signature_valid")
    .eq("processed", false)
    .order("received_at", { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });
  return res.status(200).json({
    mode: "dlq",
    total_pending: pending?.length || 0,
    pending,
  });
}

async function locationDetail(req, res) {
  const locationId = req.query?.locationId;
  if (!locationId) return res.status(400).json({ error: "missing_locationId" });

  const out = { mode: "location", locationId };

  const { data: inst } = await db()
    .from("installations")
    .select("*")
    .eq("location_id", locationId)
    .maybeSingle();
  if (!inst) return res.status(404).json({ error: "installation_not_found", locationId });
  out.installation = {
    location_name: inst.location_name,
    company_id: inst.company_id,
    coupon_code: inst.coupon_code,
    stripe_coupon_id: inst.stripe_coupon_id,
    stripe_promotion_id: inst.stripe_promotion_id,
    stripe_customer_id: inst.stripe_customer_id,
    provision_source: inst.provision_source,
    current_tier_id: inst.current_tier_id,
    tier_once_coupon_id: inst.tier_once_coupon_id,
    tier_recurring_coupon_id: inst.tier_recurring_coupon_id,
    tier_applied_at: inst.tier_applied_at,
    status: inst.status,
    installed_at: inst.installed_at,
  };

  const { data: refs } = await db()
    .from("referrals")
    .select(
      "id, status, indicado_email, coupon_used, first_payment_at, qualified_at, " +
        "disqualified_at, disqualification_reason, plan_id, created_at",
    )
    .eq("indicador_location", locationId)
    .order("created_at", { ascending: false });
  out.referrals = { total: refs?.length || 0, by_status: {}, recent: (refs || []).slice(0, 5) };
  for (const r of refs || []) {
    out.referrals.by_status[r.status] = (out.referrals.by_status[r.status] || 0) + 1;
  }

  const { data: th } = await db()
    .from("tier_history")
    .select("from_tier, to_tier, qualified_count, reason, created_at")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(10);
  out.tier_history = th || [];

  out.stripe = {};
  try {
    const customerId = await resolveStripeCustomerId(locationId);
    out.stripe.customer_id = customerId;
    if (customerId) {
      const c = await stripeClient().customers.retrieve(customerId);
      out.stripe.customer = {
        id: c.id,
        email: c.email,
        name: c.name,
        delinquent: c.delinquent,
        discount: c.discount
          ? {
              coupon_id: c.discount.coupon?.id,
              amount_off: c.discount.coupon?.amount_off,
              percent_off: c.discount.coupon?.percent_off,
            }
          : null,
        metadata: c.metadata,
      };
      const subs = await stripeClient().subscriptions.list({ customer: customerId, limit: 5 });
      out.stripe.subscriptions = subs.data.map((s) => ({
        id: s.id,
        status: s.status,
        discount: s.discount
          ? { coupon_id: s.discount.coupon?.id, amount_off: s.discount.coupon?.amount_off }
          : null,
      }));
    }
  } catch (err) {
    out.stripe.error = err.message;
  }

  if (inst.stripe_coupon_id) {
    try {
      const coupon = await stripeClient().coupons.retrieve(inst.stripe_coupon_id);
      out.indicado_coupon = {
        id: coupon.id,
        amount_off: coupon.amount_off,
        currency: coupon.currency,
        duration: coupon.duration,
        valid: coupon.valid,
        times_redeemed: coupon.times_redeemed,
      };
    } catch (err) {
      out.indicado_coupon = { error: err.message };
    }
  }

  return res.status(200).json(out);
}
