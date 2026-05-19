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
import { stripeClient } from "../../lib/server/stripe-coupon.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { recomputeTier } from "../../lib/server/tier-discount.js";

const TIERS = [
  { id: "starter", name: "Spark Starter", price: 79, slug: "spark-starter" },
  { id: "growth", name: "Spark Growth", price: 120, slug: "spark-growth" },
  { id: "scale", name: "Spark Scale", price: 250, slug: "spark-scale" },
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
 * Cria/reusa: 3 Products + 3 Prices + 3 Payment Links.
 * Idempotente via metadata.tier.
 */
async function setupTiers(req, res) {
  const stripe = stripeClient();
  const results = [];

  for (const tier of TIERS) {
    const out = { tier: tier.id, name: tier.name, price_usd: tier.price };

    // 1) Find or create Product
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
            plan_price_usd: String(tier.price),
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
    out.product_reused = !!product.metadata?.tier;

    // 2) Create Price (sempre cria novo se não houver um com mesma tier+amount).
    //    Stripe não aceita search em Prices direto — fazemos list+filter.
    let price;
    try {
      const list = await stripe.prices.list({
        product: product.id,
        active: true,
        limit: 20,
      });
      price = list.data?.find(
        (p) =>
          p.unit_amount === tier.price * 100 &&
          p.recurring?.interval === "month",
      );
    } catch (err) {
      out.price_list_error = err.message;
    }
    if (!price) {
      try {
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: tier.price * 100,
          currency: "usd",
          recurring: { interval: "month" },
          nickname: `${tier.name} — mensal`,
          metadata: { tier: tier.id, plan_slug: tier.slug },
        });
      } catch (err) {
        out.price_error = err.message;
        results.push(out);
        continue;
      }
    }
    out.price_id = price.id;

    // 3) Find or create Payment Link
    let link;
    try {
      const list = await stripe.paymentLinks.list({ active: true, limit: 100 });
      link = list.data?.find(
        (l) =>
          l.metadata?.tier === tier.id &&
          l.metadata?.source === "spark-referral-hub",
      );
    } catch (err) {
      out.link_list_error = err.message;
    }
    if (!link) {
      try {
        link = await stripe.paymentLinks.create({
          line_items: [{ price: price.id, quantity: 1 }],
          allow_promotion_codes: true,
          billing_address_collection: "required",
          phone_number_collection: { enabled: true },
          after_completion: {
            type: "redirect",
            redirect: { url: `${WELCOME_BASE}/${tier.id}` },
          },
          metadata: {
            tier: tier.id,
            plan_slug: tier.slug,
            plan_price_usd: String(tier.price),
            source: "spark-referral-hub",
          },
          subscription_data: {
            metadata: { tier: tier.id, plan_slug: tier.slug },
          },
        });
      } catch (err) {
        out.link_error = err.message;
        results.push(out);
        continue;
      }
    }
    out.payment_link_id = link.id;
    out.payment_link_url = link.url;

    results.push(out);
  }

  return res.status(200).json({ ok: true, tiers: results });
}
