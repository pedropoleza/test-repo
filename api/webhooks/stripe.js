/**
 * POST /api/webhooks/stripe — handler real (Etapa 3).
 *
 * Validação:
 *   - Assinatura via stripe.webhooks.constructEvent (rawBody, sig, secret)
 *   - Idempotência via PK composta (source='stripe', event_id)
 *
 * Dispatch (decisões D1, D2 aplicadas):
 *   D1=b → o relógio dos 30 dias começa no first_payment_at, gravado
 *          quando invoice.payment_succeeded chega pela primeira vez
 *          numa subscription que tenha cupom nosso aplicado.
 *   D2=a → charge.refunded ou customer.subscription.deleted
 *          desqualifica imediatamente.
 *
 * GET retorna metadata do endpoint (saúde / ready_for_validation).
 */
import Stripe from "stripe";
import { db } from "../../lib/server/db.js";
import { readRawBody } from "../../lib/server/raw-body.js";

export const config = { api: { bodyParser: false } };

let _stripe = null;
function stripeClient() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "indicacoes-stripe-webhook",
      mode: process.env.STRIPE_MODE || "unknown",
      ready_for_signature_validation: !!process.env.STRIPE_WEBHOOK_SECRET,
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: "no_webhook_secret" });

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ error: "missing_signature" });

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: "raw_body_error", message: err.message });
  }

  let event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] bad signature:", err.message);
    return res.status(401).json({ error: "bad_signature" });
  }

  // Idempotência: PK composta (source, event_id). Insert duplicado
  // → 23505; tratamos como já-processado.
  let inserted;
  try {
    const ins = await db()
      .from("webhook_events")
      .insert({
        event_id: event.id,
        source: "stripe",
        event_type: event.type,
        payload: event,
        signature_valid: true,
      })
      .select("event_id")
      .maybeSingle();
    inserted = !!ins.data;
  } catch (err) {
    if (err?.code === "23505" || /duplicate/i.test(err?.message || "")) {
      console.info("[stripe-webhook] duplicate", event.id);
      return res.status(200).json({ duplicate: true });
    }
    console.error("[stripe-webhook] insert error:", err);
    return res.status(500).json({ error: "db_error" });
  }

  // Dispatch
  try {
    await dispatch(event);
    await db()
      .from("webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("source", "stripe")
      .eq("event_id", event.id);
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    // 200 mesmo assim — evento gravado, podemos reprocessar pelo
    // processed_at IS NULL.
  }

  console.info("[stripe-webhook] handled:", event.type, event.id);
  return res.status(200).json({ received: true, inserted });
}

async function dispatch(event) {
  switch (event.type) {
    case "invoice.payment_succeeded":
      return onPaymentSucceeded(event);
    case "invoice.payment_failed":
      return onPaymentFailed(event);
    case "charge.refunded":
      return onCharged(event, "refunded", "refunded");
    case "customer.subscription.deleted":
      return onSubscriptionDeleted(event);
    case "customer.subscription.updated":
      return; // sem ação por enquanto; reservado pra mudança de plano
    default:
      return;
  }
}

/**
 * D1=b → o relógio dos 30 dias começa no first_payment_at.
 *
 * Identificamos a indicação pelo cupom usado: a subscription tem
 * `discount.coupon.id` que persistimos em referrals.coupon_used quando
 * a indicação foi criada. Marca status=paid e first_payment_at = agora.
 */
async function onPaymentSucceeded(event) {
  const inv = event.data.object;
  const subId = inv.subscription;
  const couponId = inv.discount?.coupon?.id || inv.discount?.promotion_code || null;
  const customerId = inv.customer;
  if (!subId && !couponId) return;

  // Tenta achar referral pelo coupon_used (preferred) ou pela subscription
  const updates = {
    status: "paid",
    first_payment_at: new Date().toISOString(),
    stripe_customer_id: customerId,
    stripe_subscription_id: subId || null,
  };

  let q = db()
    .from("referrals")
    .update(updates)
    .in("status", ["pending"]); // só promove de pending

  if (couponId) {
    q = q.eq("coupon_used", couponId);
  } else {
    q = q.eq("stripe_subscription_id", subId);
  }

  const { error } = await q;
  if (error) console.error("[stripe-webhook] payment_succeeded update:", error);
}

async function onPaymentFailed(event) {
  // Não desqualifica — só loga. Falha de pagamento não é refund.
  console.info("[stripe-webhook] payment_failed", event.data.object?.id);
}

async function onCharged(event, newStatus, reason) {
  const ch = event.data.object;
  const customerId = ch.customer;
  if (!customerId) return;
  const { error } = await db()
    .from("referrals")
    .update({
      status: newStatus,
      disqualified_at: new Date().toISOString(),
      disqualification_reason: reason,
    })
    .eq("stripe_customer_id", customerId)
    .in("status", ["pending", "paid", "qualified"]);
  if (error) console.error("[stripe-webhook] disqualify update:", error);
}

async function onSubscriptionDeleted(event) {
  const sub = event.data.object;
  const subId = sub.id;
  const { error } = await db()
    .from("referrals")
    .update({
      status: "canceled",
      disqualified_at: new Date().toISOString(),
      disqualification_reason: "subscription_deleted",
    })
    .eq("stripe_subscription_id", subId)
    .in("status", ["pending", "paid", "qualified"]);
  if (error) console.error("[stripe-webhook] sub_deleted update:", error);
}
