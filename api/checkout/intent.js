/**
 * POST /api/checkout/intent
 *
 * Cria um Stripe Subscription pendente com PaymentIntent. Retorna o
 * client_secret pra o checkout próprio Spark usar com Stripe Elements
 * (cliente nunca sai da nossa página, só insere cartão).
 *
 * Fluxo:
 *   1. Customer escolhe tier em /checkout/[tier]
 *   2. Frontend envia { tier, email, name, cupomCode?, ref? } pra cá
 *   3. Validamos cupom (lookup do coupon ID via env vars)
 *   4. Criamos Stripe Customer (ou reusamos por email)
 *   5. Criamos Subscription com payment_behavior=default_incomplete:
 *        - items: [{ price: monthly_price_id }]
 *        - add_invoice_items: [{ price: activation_price_id }] (Growth/Scale)
 *        - discounts: [{ coupon: indicacao_coupon_id }] se cupom válido
 *   6. Metadata da subscription inclui ref+indicado_*+tier+cupom — webhook
 *      monta referrals row a partir disso quando invoice payment succeed
 *   7. Retorna { clientSecret, amount, currency, breakdown }
 *
 * O cliente NUNCA vê interface Stripe. Tudo é nossa UI + Stripe Elements
 * (Card Element é o ÚNICO componente Stripe na página, embedded).
 */
import { stripeClient } from "../../lib/server/stripe-coupon.js";
import { log } from "../../lib/server/log.js";

// Mapping tier → { monthly_price_id, activation_price_id?, coupon_id }
// Resolvido em runtime via env vars (preenchidas pelo setup_tiers).
function tierConfig(tierId) {
  const cfg = {
    starter: {
      monthlyUsd: 79,
      activationUsd: 0,
      monthlyPriceEnv: "STRIPE_PRICE_STARTER_MONTHLY",
      activationPriceEnv: null,
      couponEnv: "STRIPE_COUPON_INDICACAO_STARTER",
      cupomCode: "INDICACAO_STARTER",
      name: "Spark Starter",
    },
    growth: {
      monthlyUsd: 120,
      activationUsd: 99,
      monthlyPriceEnv: "STRIPE_PRICE_GROWTH_MONTHLY",
      activationPriceEnv: "STRIPE_PRICE_GROWTH_ACTIVATION",
      couponEnv: "STRIPE_COUPON_INDICACAO_GROWTH",
      cupomCode: "INDICACAO_GROWTH",
      name: "Spark Growth",
    },
    scale: {
      monthlyUsd: 250,
      activationUsd: 199,
      monthlyPriceEnv: "STRIPE_PRICE_SCALE_MONTHLY",
      activationPriceEnv: "STRIPE_PRICE_SCALE_ACTIVATION",
      couponEnv: "STRIPE_COUPON_INDICACAO_SCALE",
      cupomCode: "INDICACAO_SCALE",
      name: "Spark Scale",
    },
  };
  return cfg[tierId] || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  const tier = String(body.tier || "").toLowerCase();
  const cfg = tierConfig(tier);
  if (!cfg) return res.status(400).json({ error: "invalid_tier" });

  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "missing_name" });

  // ref é opcional — locationId do indicador, capturado via URL share
  const ref = body.ref ? String(body.ref).slice(0, 32) : null;

  // Cupom é opcional. Se vier, deve bater com o cupom previsto do tier.
  const cupomCode = body.cupomCode
    ? String(body.cupomCode).toUpperCase().trim()
    : null;
  let couponId = null;
  let couponApplied = false;
  if (cupomCode) {
    if (cupomCode !== cfg.cupomCode) {
      return res.status(400).json({
        error: "wrong_coupon_for_tier",
        message: `O cupom ${cupomCode} não é válido pra ${cfg.name}. Cupom correto: ${cfg.cupomCode}.`,
      });
    }
    couponId = process.env[cfg.couponEnv];
    if (!couponId) {
      return res.status(500).json({
        error: "coupon_env_missing",
        message: `${cfg.couponEnv} não configurado no servidor`,
      });
    }
    couponApplied = true;
  }

  const monthlyPriceId = process.env[cfg.monthlyPriceEnv];
  if (!monthlyPriceId) {
    return res.status(500).json({
      error: "price_env_missing",
      message: `${cfg.monthlyPriceEnv} não configurado no servidor`,
    });
  }
  const activationPriceId = cfg.activationPriceEnv
    ? process.env[cfg.activationPriceEnv]
    : null;

  const stripe = stripeClient();

  // 1) Customer (search by email, reuse if exists)
  let customer;
  try {
    const search = await stripe.customers.search({
      query: `email:'${email.replace(/'/g, "\\'")}'`,
      limit: 1,
    });
    customer = search.data?.[0];
  } catch (err) {
    log.warn("checkout.customer_search_failed", { error: err.message });
  }
  if (!customer) {
    try {
      customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          source: "spark-checkout",
          indicador_ref: ref || "",
        },
      });
    } catch (err) {
      log.error("checkout.customer_create_failed", { error: err.message });
      return res.status(500).json({ error: "customer_create_failed", message: err.message });
    }
  } else {
    // Atualiza metadata com ref se ainda não tem
    if (ref && !customer.metadata?.indicador_ref) {
      try {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, indicador_ref: ref },
        });
      } catch {}
    }
  }

  // 2) Subscription with default_incomplete payment
  const subParams = {
    customer: customer.id,
    items: [{ price: monthlyPriceId }],
    payment_behavior: "default_incomplete",
    payment_settings: {
      save_default_payment_method: "on_subscription",
      payment_method_types: ["card"],
    },
    expand: ["latest_invoice.payment_intent"],
    metadata: {
      source: "spark-checkout",
      indicador_ref: ref || "",
      indicado_email: email,
      indicado_name: name,
      tier_purchased: tier,
      cupom_code: cupomCode || "",
      activation_paid: cfg.activationUsd > 0 ? "true" : "false",
    },
  };
  if (activationPriceId) {
    subParams.add_invoice_items = [{ price: activationPriceId, quantity: 1 }];
  }
  if (couponId) {
    subParams.discounts = [{ coupon: couponId }];
  }

  let subscription;
  try {
    subscription = await stripe.subscriptions.create(subParams);
  } catch (err) {
    log.error("checkout.subscription_create_failed", {
      tier,
      error: err.message,
      code: err.code,
    });
    return res.status(500).json({
      error: "subscription_create_failed",
      message: err.message,
    });
  }

  const invoice = subscription.latest_invoice;
  const pi = invoice?.payment_intent;
  if (!pi?.client_secret) {
    log.error("checkout.no_payment_intent", { subId: subscription.id });
    return res.status(500).json({ error: "no_payment_intent" });
  }

  log.info("checkout.intent_created", {
    tier,
    subId: subscription.id,
    customer_id: customer.id,
    coupon_applied: couponApplied,
    activation: cfg.activationUsd > 0,
    ref: ref || null,
    amount_due_cents: invoice?.amount_due,
  });

  return res.status(200).json({
    ok: true,
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id,
    subscriptionId: subscription.id,
    customerId: customer.id,
    amount: invoice?.amount_due, // cents
    currency: invoice?.currency || "usd",
    breakdown: {
      monthly_usd: cfg.monthlyUsd,
      activation_usd: cfg.activationUsd,
      coupon_applied: couponApplied,
      coupon_code: cupomCode,
      tier_name: cfg.name,
    },
  });
}
