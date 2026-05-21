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
import { db } from "../../lib/server/db.js";
import { log } from "../../lib/server/log.js";

// Carrega config do plano de plan_config (fonte de verdade editável
// pelo /admin). Retorna o shape usado pelo handler ou null.
async function loadPlan(tierId) {
  const { data, error } = await db()
    .from("plan_config")
    .select("tier, name, monthly_usd, activation_usd, indicacao_discount_usd, indicacao_duration, indicacao_months, product_id, coupon_id")
    .eq("tier", tierId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    name: data.name,
    monthlyUsd: Number(data.monthly_usd),
    activationUsd: Number(data.activation_usd),
    productId: data.product_id,
    couponId: data.coupon_id,
    cupomCode: `INDICACAO_${tierId.toUpperCase()}`,
  };
}

export default async function handler(req, res) {
  // GET ?action=pubkey → publishable key pro front montar Stripe.js
  if (req.method === "GET" && req.query?.action === "pubkey") {
    const pk = process.env.STRIPE_PUBLISHABLE_KEY;
    if (!pk) {
      return res.status(500).json({ error: "STRIPE_PUBLISHABLE_KEY not set" });
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).json({ publishableKey: pk });
  }

  // GET ?action=plans → config atual dos planos (preços editáveis no /admin)
  if (req.method === "GET" && req.query?.action === "plans") {
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60");
    const { data, error } = await db()
      .from("plan_config")
      .select("tier, name, monthly_usd, activation_usd, indicacao_discount_usd, indicacao_duration, indicacao_months, discount_type, sort_order")
      .order("sort_order", { ascending: true });
    if (error) return res.status(500).json({ error: "db_error", detail: error.message });
    const plans = {};
    for (const p of data || []) {
      plans[p.tier] = {
        name: p.name,
        monthly_usd: Number(p.monthly_usd),
        activation_usd: Number(p.activation_usd),
        discount_value: Number(p.indicacao_discount_usd),
        discount_type: p.discount_type || "amount",
        discount_duration: p.indicacao_duration,
        discount_months: p.indicacao_months,
      };
    }
    return res.status(200).json({ plans });
  }

  // GET ?action=validate_coupon&code= → resolve QUALQUER promotion code
  // ativo no Stripe e devolve o desconto. Sem trava por tier.
  if (req.method === "GET" && req.query?.action === "validate_coupon") {
    const code = String(req.query?.code || "").toUpperCase().trim();
    if (!code) return res.status(400).json({ valid: false, error: "missing_code" });
    try {
      const list = await stripeClient().promotionCodes.list({ code, active: true, limit: 1 });
      const pc = list.data?.[0];
      if (!pc) return res.status(200).json({ valid: false });
      const c = pc.coupon || {};
      return res.status(200).json({
        valid: true,
        code: pc.code,
        amount_off: c.amount_off,    // cents ou null
        percent_off: c.percent_off,  // ou null
        currency: c.currency,
        duration: c.duration,
        duration_in_months: c.duration_in_months,
      });
    } catch (err) {
      return res.status(200).json({ valid: false, error: err.message });
    }
  }

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
  const cfg = await loadPlan(tier);
  if (!cfg) return res.status(400).json({ error: "invalid_tier" });
  if (!cfg.productId) {
    return res.status(500).json({ error: "plan_missing_product", message: `Plano ${tier} sem product_id configurado` });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "missing_name" });

  const phone = String(body.phone || "").trim().slice(0, 40);
  const company = String(body.company || "").trim().slice(0, 120);

  // ref é opcional — locationId do indicador, capturado via URL share
  const ref = body.ref ? String(body.ref).slice(0, 32) : null;

  // Cupom é opcional e SEM trava por tier — qualquer promotion code
  // ativo no Stripe é aceito. Stripe valida (restrições, expiração, etc).
  const cupomCode = body.cupomCode
    ? String(body.cupomCode).toUpperCase().trim()
    : null;
  let promotionCodeId = null;
  let couponApplied = false;
  if (cupomCode) {
    try {
      const list = await stripeClient().promotionCodes.list({ code: cupomCode, active: true, limit: 1 });
      const pc = list.data?.[0];
      if (!pc) {
        return res.status(400).json({
          error: "invalid_coupon",
          message: `Cupom ${cupomCode} inválido ou inativo.`,
        });
      }
      promotionCodeId = pc.id;
      couponApplied = true;
    } catch (err) {
      return res.status(502).json({ error: "coupon_lookup_failed", message: err.message });
    }
  }

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
        phone: phone || undefined,
        metadata: {
          source: "spark-checkout",
          indicador_ref: ref || "",
          company_name: company || "",
        },
      });
    } catch (err) {
      log.error("checkout.customer_create_failed", { error: err.message });
      return res.status(500).json({ error: "customer_create_failed", message: err.message });
    }
  } else {
    // Atualiza dados (phone/company/ref) no customer existente
    try {
      await stripe.customers.update(customer.id, {
        phone: phone || customer.phone || undefined,
        metadata: {
          ...customer.metadata,
          indicador_ref: ref || customer.metadata?.indicador_ref || "",
          company_name: company || customer.metadata?.company_name || "",
        },
      });
    } catch {}
  }

  // 2) Subscription com price_data INLINE — cobra o valor atual do
  //    plan_config (editável no /admin), não um Price fixo do Stripe.
  const subParams = {
    customer: customer.id,
    items: [{
      price_data: {
        currency: "usd",
        product: cfg.productId,
        unit_amount: Math.round(cfg.monthlyUsd * 100),
        recurring: { interval: "month" },
      },
    }],
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
      indicado_phone: phone || "",
      indicado_company: company || "",
      tier_purchased: tier,
      cupom_code: cupomCode || "",
      activation_paid: cfg.activationUsd > 0 ? "true" : "false",
      monthly_usd: String(cfg.monthlyUsd),
      activation_usd: String(cfg.activationUsd),
    },
  };
  // Taxa de ativação (one-time) na primeira fatura, via price_data inline
  if (cfg.activationUsd > 0) {
    subParams.add_invoice_items = [{
      price_data: {
        currency: "usd",
        product: cfg.productId,
        unit_amount: Math.round(cfg.activationUsd * 100),
      },
      quantity: 1,
    }];
  }
  if (promotionCodeId) {
    subParams.discounts = [{ promotion_code: promotionCodeId }];
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
