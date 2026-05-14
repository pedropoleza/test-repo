/**
 * POST /api/admin/create-payment-link
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * One-shot: cria Product + Prices (mensalidade $99/mo + ativação $75
 * one-time) + Payment Link com allow_promotion_codes=true.
 *
 * Idempotente best-effort: usa metadata.purpose='spark_main_plan_v1'
 * e tenta achar produto existente via stripe.products.search. Se
 * existir, reusa.
 *
 * Retorna { product_id, price_monthly, price_activation, payment_link,
 * payment_link_url }.
 *
 * Permissões necessárias na restricted key:
 *   - Products: Write
 *   - Prices: Write
 *   - Payment Links: Write
 *   - (Products: Read e Prices: Read pra idempotência)
 */
import { stripeClient } from "../../lib/server/stripe-coupon.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";

const PURPOSE_TAG = "spark_main_plan_v1";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!checkCronSecret(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const monthlyUsd = Number(req.query?.monthly_usd) || 99;
  const activationUsd = Number(req.query?.activation_usd) || 75;
  const productName = String(req.query?.name || "Spark Leads Subscription");

  const stripe = stripeClient();
  const out = {
    monthly_usd: monthlyUsd,
    activation_usd: activationUsd,
    first_invoice_usd: monthlyUsd + activationUsd,
    after_coupon_usd: monthlyUsd + activationUsd - 50,
  };

  // 1) Tenta achar product existente
  let product;
  try {
    const search = await stripe.products.search({
      query: `metadata['purpose']:'${PURPOSE_TAG}'`,
      limit: 1,
    });
    product = search.data?.[0];
    if (product) out.product_reused = true;
  } catch (err) {
    return res.status(403).json({
      error: "scope_missing_products_read",
      stripe_message: err.message,
      hint: "Adicione 'Products: Read' à restricted key.",
    });
  }

  if (!product) {
    try {
      product = await stripe.products.create({
        name: productName,
        description: "Plano principal com taxa de ativação e mensalidade.",
        metadata: { purpose: PURPOSE_TAG, source: "spark-referral-hub" },
      });
    } catch (err) {
      return res.status(403).json({
        error: "scope_missing_products_write",
        stripe_message: err.message,
        hint: "Adicione 'Products: Write' à restricted key.",
      });
    }
  }
  out.product_id = product.id;

  // 2) Cria Prices (mensalidade + ativação). Não dá pra reusar Price
  // direto via metadata search (Stripe não suporta search em prices),
  // então criamos novos a cada call. Em prod, rodar uma vez só.
  let priceMonthly, priceActivation;
  try {
    priceMonthly = await stripe.prices.create({
      product: product.id,
      unit_amount: monthlyUsd * 100,
      currency: "usd",
      recurring: { interval: "month" },
      nickname: `Mensalidade $${monthlyUsd}`,
      metadata: { purpose: PURPOSE_TAG, role: "monthly" },
    });
    priceActivation = await stripe.prices.create({
      product: product.id,
      unit_amount: activationUsd * 100,
      currency: "usd",
      nickname: `Taxa de ativação $${activationUsd}`,
      metadata: { purpose: PURPOSE_TAG, role: "activation" },
    });
  } catch (err) {
    return res.status(403).json({
      error: "scope_missing_prices_write",
      stripe_message: err.message,
      hint: "Adicione 'Prices: Write' à restricted key.",
      product_id: product.id,
    });
  }
  out.price_monthly = priceMonthly.id;
  out.price_activation = priceActivation.id;

  // 3) Cria Payment Link com ambos os Prices
  let paymentLink;
  try {
    paymentLink = await stripe.paymentLinks.create({
      line_items: [
        { price: priceMonthly.id, quantity: 1 },
        {
          price: priceActivation.id,
          quantity: 1,
          // sem adjustable_quantity (1 fixo)
        },
      ],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      metadata: { purpose: PURPOSE_TAG, source: "spark-referral-hub" },
    });
  } catch (err) {
    return res.status(403).json({
      error: "scope_missing_payment_links_write",
      stripe_message: err.message,
      hint: "Adicione 'Payment Links: Write' à restricted key.",
      product_id: product.id,
      price_monthly: priceMonthly.id,
      price_activation: priceActivation.id,
    });
  }
  out.payment_link_id = paymentLink.id;
  out.payment_link_url = paymentLink.url;

  return res.status(200).json({ ok: true, ...out });
}
