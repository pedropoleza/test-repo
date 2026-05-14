/**
 * GET /api/diagnostics/full?locationId=...
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Mostra estado completo de uma location: installation + referrals +
 * tier history + Stripe customer + coupons aplicados. Útil pra debug
 * end-to-end ("o que tá acontecendo com a location X?").
 */
import { db } from "../../lib/server/db.js";
import { stripeClient } from "../../lib/server/stripe-coupon.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { resolveStripeCustomerId } from "../../lib/server/d8-resolver.js";

export default async function handler(req, res) {
  if (!checkCronSecret(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const locationId = req.query?.locationId;
  if (!locationId) return res.status(400).json({ error: "missing_locationId" });

  const out = { locationId };

  // 1) Installation
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

  // 2) Referrals
  const { data: refs } = await db()
    .from("referrals")
    .select(
      "id, status, indicado_email, coupon_used, first_payment_at, qualified_at, " +
        "disqualified_at, disqualification_reason, plan_id, created_at",
    )
    .eq("indicador_location", locationId)
    .order("created_at", { ascending: false });
  out.referrals = {
    total: refs?.length || 0,
    by_status: {},
    recent: (refs || []).slice(0, 5),
  };
  for (const r of refs || []) {
    out.referrals.by_status[r.status] = (out.referrals.by_status[r.status] || 0) + 1;
  }

  // 3) Tier history
  const { data: th } = await db()
    .from("tier_history")
    .select("from_tier, to_tier, qualified_count, reason, created_at")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(10);
  out.tier_history = th || [];

  // 4) Stripe customer resolution
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
        balance: c.balance,
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
      // subscriptions
      const subs = await stripeClient().subscriptions.list({
        customer: customerId,
        limit: 5,
      });
      out.stripe.subscriptions = subs.data.map((s) => ({
        id: s.id,
        status: s.status,
        current_period_end: s.current_period_end,
        discount: s.discount
          ? { coupon_id: s.discount.coupon?.id, amount_off: s.discount.coupon?.amount_off }
          : null,
      }));
    }
  } catch (err) {
    out.stripe.error = err.message;
  }

  // 5) Indicado coupon details (do próprio location)
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
