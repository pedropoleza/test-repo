/**
 * POST /api/admin/recompute-tier
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Multi-action endpoint. Ações:
 *
 *   action=recompute_tier (default)
 *     ?locationId=… — recomputa tier do indicador, aplica/revoga discount
 *
 *   action=setup_tiers
 *     One-shot: cria 3 Stripe Products + Prices + Payment Links
 *     (Spark Starter $79, Spark Growth $120, Spark Scale $250),
 *     com metadata pra roteamento de webhook. Idempotente via
 *     metadata.tier search.
 */
import { stripeClient, ensureIndicadoCoupon } from "../../lib/server/stripe-coupon.js";
import { db } from "../../lib/server/db.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { recomputeTier } from "../../lib/server/tier-discount.js";

const TIERS = [
  {
    id: "starter",
    name: "Spark Starter",
    monthlyUsd: 79,
    activationUsd: 0,
    slug: "spark-starter",
    indicacaoCoupon: {
      code: "INDICACAO_STARTER",
      amountUsd: 40,
      duration: "repeating",
      durationInMonths: 3,
      name: "Indicação Starter — $40 off por 3 meses",
    },
  },
  {
    id: "growth",
    name: "Spark Growth",
    monthlyUsd: 120,
    activationUsd: 99,
    slug: "spark-growth",
    indicacaoCoupon: {
      code: "INDICACAO_GROWTH",
      amountUsd: 50,
      duration: "once",
      name: "Indicação Growth — $50 off",
    },
  },
  {
    id: "scale",
    name: "Spark Scale",
    monthlyUsd: 250,
    activationUsd: 199,
    slug: "spark-scale",
    indicacaoCoupon: {
      code: "INDICACAO_SCALE",
      amountUsd: 100,
      duration: "once",
      name: "Indicação Scale — $100 off",
    },
  },
];

const WELCOME_BASE = "https://sparkleads.pro/welcome";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!checkCronSecret(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const action = String(req.query?.action || "recompute_tier");

  if (action === "setup_tiers") return setupTiers(req, res);
  if (action === "cleanup_pit") return cleanupPit(req, res);
  if (action === "repair_coupons") return repairCoupons(req, res);

  if (action === "recompute_tier") {
    const locationId = req.query?.locationId;
    if (!locationId) return res.status(400).json({ error: "missing_locationId" });
    try {
      const result = await recomputeTier(locationId, { reason: "manual" });
      return res.status(200).json({ ok: true, result });
    } catch (err) {
      console.error("[admin.recompute-tier]", err);
      return res.status(500).json({ error: "internal", message: err.message });
    }
  }

  return res.status(400).json({ error: "unknown_action", action });
}

/**
 * Limpa rows agency_pit + arquiva Promotion Codes velhos.
 * Útil pra refresh quando muda a derivação de cupom.
 */
async function cleanupPit(_req, res) {
  const stripe = stripeClient();
  const { data: rows, error } = await db()
    .from("installations")
    .select("location_id, location_name, coupon_code, stripe_promotion_id")
    .eq("provision_source", "agency_pit");
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });

  const summary = { candidates: rows.length, archived: 0, archive_errors: [], deleted_rows: 0 };
  for (const r of rows) {
    if (!r.stripe_promotion_id) continue;
    try {
      await stripe.promotionCodes.update(r.stripe_promotion_id, { active: false });
      summary.archived++;
    } catch (err) {
      summary.archive_errors.push({
        promo: r.stripe_promotion_id,
        location: r.location_id,
        error: err?.message || String(err),
      });
    }
  }
  const { error: delErr, count } = await db()
    .from("installations")
    .delete({ count: "exact" })
    .eq("provision_source", "agency_pit");
  if (delErr) return res.status(500).json({ error: "delete_failed", detail: delErr.message, partial: summary });
  summary.deleted_rows = count || 0;
  return res.status(200).json({ ok: true, summary });
}

/**
 * Pra rows com coupon_code IS NULL, refaz ensureIndicadoCoupon.
 */
async function repairCoupons(_req, res) {
  const { data: rows, error } = await db()
    .from("installations")
    .select("location_id, location_name")
    .is("coupon_code", null);
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });

  const out = { candidates: rows.length, fixed: 0, errors: [] };
  for (const r of rows) {
    try {
      const cd = await ensureIndicadoCoupon(r.location_id, r.location_name);
      if (!cd) {
        out.errors.push({ location_id: r.location_id, error: "ensure_returned_null" });
        continue;
      }
      const upd = await db()
        .from("installations")
        .update({
          coupon_code: cd.couponCode,
          stripe_coupon_id: cd.stripeCouponId,
          stripe_promotion_id: cd.stripePromotionId,
          last_sync_at: new Date().toISOString(),
        })
        .eq("location_id", r.location_id);
      if (upd.error) throw upd.error;
      out.fixed++;
    } catch (err) {
      out.errors.push({ location_id: r.location_id, error: err?.message || String(err) });
    }
  }
  return res.status(200).json({ ok: true, summary: out });
}

/**
 * Cria/reusa pra cada tier:
 *   - Product
 *   - Recurring Price (mensalidade)
 *   - One-time Price de ativação (Growth + Scale; Starter não tem)
 *   - Indicação Coupon (INDICACAO_STARTER / GROWTH / SCALE)
 *
 * NÃO cria Payment Links — agora temos checkout próprio.
 * Idempotente via metadata.tier / metadata.role.
 */
async function setupTiers(req, res) {
  const stripe = stripeClient();
  const results = [];

  for (const tier of TIERS) {
    const out = {
      tier: tier.id,
      name: tier.name,
      monthly_usd: tier.monthlyUsd,
      activation_usd: tier.activationUsd,
    };

    // 1) Product
    let product;
    try {
      const search = await stripe.products.search({
        query: `metadata['tier']:'${tier.id}' AND metadata['source']:'spark-referral-hub'`,
        limit: 1,
      });
      product = search.data?.[0];
    } catch (err) {
      out.search_error = err.message;
    }
    if (!product) {
      try {
        product = await stripe.products.create({
          name: tier.name,
          description: `Plano ${tier.name} da SparkLeads — assinatura mensal.`,
          metadata: {
            tier: tier.id,
            plan_slug: tier.slug,
            source: "spark-referral-hub",
          },
        });
      } catch (err) {
        out.product_error = err.message;
        results.push(out);
        continue;
      }
    }
    out.product_id = product.id;

    // 2) Recurring Price (mensalidade)
    let monthlyPrice;
    try {
      const list = await stripe.prices.list({
        product: product.id,
        active: true,
        limit: 20,
      });
      monthlyPrice = list.data?.find(
        (p) =>
          p.unit_amount === tier.monthlyUsd * 100 &&
          p.recurring?.interval === "month",
      );
    } catch (err) {
      out.monthly_list_error = err.message;
    }
    if (!monthlyPrice) {
      try {
        monthlyPrice = await stripe.prices.create({
          product: product.id,
          unit_amount: tier.monthlyUsd * 100,
          currency: "usd",
          recurring: { interval: "month" },
          nickname: `${tier.name} — mensal`,
          metadata: { tier: tier.id, plan_slug: tier.slug, role: "monthly" },
        });
      } catch (err) {
        out.monthly_error = err.message;
        results.push(out);
        continue;
      }
    }
    out.monthly_price_id = monthlyPrice.id;

    // 3) Activation Price (one-time) — só Growth + Scale
    if (tier.activationUsd > 0) {
      let activationPrice;
      try {
        const list = await stripe.prices.list({
          product: product.id,
          active: true,
          limit: 20,
        });
        activationPrice = list.data?.find(
          (p) =>
            p.unit_amount === tier.activationUsd * 100 &&
            !p.recurring &&
            p.metadata?.role === "activation",
        );
      } catch (err) {
        out.activation_list_error = err.message;
      }
      if (!activationPrice) {
        try {
          activationPrice = await stripe.prices.create({
            product: product.id,
            unit_amount: tier.activationUsd * 100,
            currency: "usd",
            nickname: `${tier.name} — taxa de ativação`,
            metadata: { tier: tier.id, plan_slug: tier.slug, role: "activation" },
          });
        } catch (err) {
          out.activation_error = err.message;
        }
      }
      if (activationPrice) out.activation_price_id = activationPrice.id;
    }

    // 4) Indicação Coupon
    const coupOpts = tier.indicacaoCoupon;
    let coupon;
    try {
      const search = await stripe.coupons.list({ limit: 100 });
      coupon = search.data?.find(
        (c) =>
          c.metadata?.role === "indicacao" &&
          c.metadata?.tier === tier.id &&
          c.amount_off === coupOpts.amountUsd * 100,
      );
    } catch (err) {
      out.coupon_list_error = err.message;
    }
    if (!coupon) {
      try {
        const couponParams = {
          amount_off: coupOpts.amountUsd * 100,
          currency: "usd",
          duration: coupOpts.duration,
          name: coupOpts.name,
          metadata: {
            role: "indicacao",
            tier: tier.id,
            source: "spark-referral-hub",
          },
        };
        if (coupOpts.durationInMonths) {
          couponParams.duration_in_months = coupOpts.durationInMonths;
        }
        coupon = await stripe.coupons.create(couponParams);
      } catch (err) {
        out.coupon_error = err.message;
      }
    }
    if (coupon) {
      out.coupon_id = coupon.id;
      // Cria Promotion Code com nome legível
      try {
        const existingPromos = await stripe.promotionCodes.list({
          coupon: coupon.id,
          active: true,
          limit: 5,
        });
        let promo = existingPromos.data?.find((p) => p.code === coupOpts.code);
        if (!promo) {
          promo = await stripe.promotionCodes.create({
            coupon: coupon.id,
            code: coupOpts.code,
            metadata: { role: "indicacao", tier: tier.id },
          });
        }
        out.promo_code = promo.code;
        out.promo_code_id = promo.id;
      } catch (err) {
        out.promo_error = err.message;
      }
    }

    results.push(out);
  }

  return res.status(200).json({ ok: true, tiers: results });
}
