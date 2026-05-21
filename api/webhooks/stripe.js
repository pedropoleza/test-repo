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
import { db } from "../../lib/server/db.js";
import { readRawBody } from "../../lib/server/raw-body.js";
import { stripeClient } from "../../lib/server/stripe-coupon.js";
import { recomputeTier } from "../../lib/server/tier-discount.js";

export const config = { api: { bodyParser: false } };

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
  const affectedIndicators = new Set();
  try {
    const result = await dispatch(event);
    if (result?.indicadorLocations) {
      for (const l of result.indicadorLocations) affectedIndicators.add(l);
    }
    await db()
      .from("webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("source", "stripe")
      .eq("event_id", event.id);
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    // Em vez de marcar processed=true em falha, deixamos processed_at=null
    // pra eventual reprocessamento futuro via cron de DLQ.
  }

  // Recomputa tier dos indicadores afetados (best-effort; não bloqueia 200)
  for (const loc of affectedIndicators) {
    try {
      await recomputeTier(loc, { reason: `stripe.${event.type}` });
    } catch (err) {
      console.warn("[stripe-webhook] recomputeTier failed:", loc, err.message);
    }
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
      return null;
    default:
      return null;
  }
}

async function collectIndicators(filter) {
  const { data } = await db()
    .from("referrals")
    .select("indicador_location")
    .match(filter);
  return [...new Set((data || []).map((r) => r.indicador_location).filter(Boolean))];
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
    .in("status", ["pending"])
    .select("indicador_location");

  if (couponId) {
    q = q.eq("coupon_used", couponId);
  } else {
    q = q.eq("stripe_subscription_id", subId);
  }

  const { error, data } = await q;
  if (error) {
    console.error("[stripe-webhook] payment_succeeded update:", error);
    return null;
  }

  // Se nenhuma referral existente casou, tenta AUTO-CRIAR a partir da
  // metadata da subscription (checkout próprio Spark). Assim, usar um
  // cupom per-plano (SPARKOFF*) registra a indicação na location do
  // indicador sem precisar de adição manual no /admin.
  if ((!data || data.length === 0) && subId) {
    const autoLoc = await autoCreateReferralFromSub(subId, {
      customerId,
      couponId,
    });
    if (autoLoc) return { indicadorLocations: [autoLoc] };
  }

  return { indicadorLocations: (data || []).map((r) => r.indicador_location).filter(Boolean) };
}

/**
 * Cria uma referral a partir da metadata de uma subscription do checkout
 * Spark. Idempotente: se já existe referral pra essa subscription, não
 * duplica. Retorna o indicador_location se criou (ou já existia), senão null.
 */
async function autoCreateReferralFromSub(subId, { customerId, couponId }) {
  let sub;
  try {
    sub = await stripeClient().subscriptions.retrieve(subId);
  } catch (err) {
    console.warn("[stripe-webhook] sub retrieve failed:", err.message);
    return null;
  }
  const m = sub?.metadata || {};
  if (m.source !== "spark-checkout") return null;

  const indicadorLocation = (m.indicador_ref || "").trim();
  const indicadoEmail = (m.indicado_email || "").trim().toLowerCase();
  const tier = (m.tier_purchased || "").trim().toLowerCase() || null;
  if (!indicadorLocation || !indicadoEmail) return null;
  if (!/^[A-Za-z0-9]{15,30}$/.test(indicadorLocation)) return null;

  // Só registra se o indicador existir como installation.
  const { data: install } = await db()
    .from("installations")
    .select("location_id")
    .eq("location_id", indicadorLocation)
    .maybeSingle();
  if (!install) {
    console.info("[stripe-webhook] auto-referral skipped, unknown indicador:", indicadorLocation);
    return null;
  }

  // Idempotência: já existe referral pra essa subscription?
  const { data: dup } = await db()
    .from("referrals")
    .select("id")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  if (dup) return indicadorLocation;

  const insert = {
    indicador_location: indicadorLocation,
    indicado_email: indicadoEmail,
    indicado_name: (m.indicado_name || "").slice(0, 200) || indicadoEmail,
    tier_purchased: ["starter", "growth", "scale"].includes(tier) ? tier : null,
    cupom_code: (m.cupom_code || "").slice(0, 40) || null,
    coupon_used: couponId || null,
    activation_paid: m.activation_paid === "true",
    status: "paid",
    first_payment_at: new Date().toISOString(),
    stripe_customer_id: customerId || null,
    stripe_subscription_id: subId,
  };

  const { error: insErr } = await db().from("referrals").insert(insert);
  if (insErr) {
    if (insErr.code === "23505" || /duplicate/i.test(insErr.message || "")) {
      return indicadorLocation;
    }
    console.error("[stripe-webhook] auto-referral insert failed:", insErr.message);
    return null;
  }
  console.info("[stripe-webhook] auto-created referral:", indicadoEmail, "→", indicadorLocation, tier || "");
  return indicadorLocation;
}

async function onPaymentFailed(event) {
  // Não desqualifica — só loga. Falha de pagamento não é refund.
  console.info("[stripe-webhook] payment_failed", event.data.object?.id);
}

async function onCharged(event, newStatus, reason) {
  // Match em ordem: subscription_id (mais específico) → customer_id →
  // coupon usado no charge. Resolve a race onde charge.refunded chega
  // antes do invoice.payment_succeeded (stripe_customer_id ainda null).
  const ch = event.data.object;
  const customerId = ch.customer;
  const invoiceId = ch.invoice;
  let subId = null;
  let couponId = null;
  if (invoiceId) {
    try {
      const inv = await stripeClient().invoices.retrieve(invoiceId, {
        expand: ["discount.coupon", "subscription"],
      });
      subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
      couponId = inv.discount?.coupon?.id || null;
    } catch (err) {
      console.warn("[stripe-webhook] invoice retrieve failed:", err.message);
    }
  }

  // Tenta de forma escalonada: primeiro pelo identificador mais específico
  // que tivermos. Se nada bater, ainda assim retorna 200 (não-erro).
  const baseUpdate = {
    status: newStatus,
    disqualified_at: new Date().toISOString(),
    disqualification_reason: reason,
  };

  for (const filter of [
    subId ? { col: "stripe_subscription_id", val: subId } : null,
    customerId ? { col: "stripe_customer_id", val: customerId } : null,
    couponId ? { col: "coupon_used", val: couponId } : null,
  ]) {
    if (!filter) continue;
    const { error, data } = await db()
      .from("referrals")
      .update(baseUpdate)
      .eq(filter.col, filter.val)
      .in("status", ["pending", "paid", "qualified"])
      .select("indicador_location");
    if (error) {
      console.error("[stripe-webhook] disqualify update:", error);
      return null;
    }
    if (data && data.length > 0) {
      console.info("[stripe-webhook] disqualified", data.length, "via", filter.col);
      return {
        indicadorLocations: data.map((r) => r.indicador_location).filter(Boolean),
      };
    }
  }
  console.info("[stripe-webhook] no referral matched for disqualify",
    { customerId, subId, couponId, eventId: event.id });
  return null;
}

async function onSubscriptionDeleted(event) {
  const sub = event.data.object;
  const subId = sub.id;
  const { error, data } = await db()
    .from("referrals")
    .update({
      status: "canceled",
      disqualified_at: new Date().toISOString(),
      disqualification_reason: "subscription_deleted",
    })
    .eq("stripe_subscription_id", subId)
    .in("status", ["pending", "paid", "qualified"])
    .select("indicador_location");
  if (error) {
    console.error("[stripe-webhook] sub_deleted update:", error);
    return null;
  }
  return { indicadorLocations: (data || []).map((r) => r.indicador_location).filter(Boolean) };
}
