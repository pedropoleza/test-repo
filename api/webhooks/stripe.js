/**
 * Webhook do Stripe — skeleton.
 *
 * Eventos subscritos no dashboard do Stripe:
 *   - invoice.payment_succeeded         → primeiro pagamento confirmado
 *                                          (gatilho do qualify após 30d)
 *   - invoice.payment_failed
 *   - charge.refunded                   → desqualifica indicação
 *   - customer.subscription.deleted     → desqualifica
 *   - customer.subscription.updated     → mudança de plano
 *
 * Validação real (Etapa 3): vai usar o SDK oficial do Stripe
 *   const event = stripe.webhooks.constructEvent(rawBody, sig, secret);
 *
 * Importante: Stripe exige raw body para verificar a assinatura. A rota
 * precisa de `export const config = { api: { bodyParser: false } }` e
 * leitura manual do stream. No skeleton mantemos bodyParser default e
 * só logamos.
 */

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

  // ====== ETAPA 3 — TODO: validação via SDK Stripe ======
  // import Stripe from "stripe";
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  // const sig = req.headers["stripe-signature"];
  // const rawBody = await readRaw(req);
  // let event;
  // try {
  //   event = stripe.webhooks.constructEvent(
  //     rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET
  //   );
  // } catch (err) {
  //   console.error("[stripe-webhook] bad signature:", err.message);
  //   return res.status(401).json({ error: "bad_signature" });
  // }

  const body = req.body || {};
  const eventId = body.id;
  const type = body.type;

  // ====== ETAPA 3 — TODO: idempotência ======
  // try {
  //   await db.stripe_events.insert({ event_id: eventId, type, payload: event });
  // } catch (e) {
  //   if (isUniqueViolation(e)) return res.status(200).json({ duplicate: true });
  //   throw e;
  // }

  // ====== ETAPA 3 — TODO: dispatch por tipo ======
  // switch (type) {
  //   case "invoice.payment_succeeded": {
  //     // TODO(D1): se D1 = b, aqui é onde o relógio dos 30 dias começa
  //     const couponUsed = event.data.object.discount?.coupon?.metadata?.indicador_location;
  //     if (couponUsed) {
  //       await db.referrals.update(
  //         { stripe_subscription_id: event.data.object.subscription },
  //         { status: "paid", first_payment_at: new Date() },
  //       );
  //     }
  //     break;
  //   }
  //   case "charge.refunded":
  //   case "customer.subscription.deleted": {
  //     // TODO(D2): refund retroativo desqualifica e recalcula tier
  //     await db.referrals.update(
  //       { stripe_customer_id: event.data.object.customer },
  //       { status: type === "charge.refunded" ? "refunded" : "canceled",
  //         disqualified_at: new Date(),
  //         disqualification_reason: type },
  //     );
  //     await recomputeIndicadorTier(/* ... */);
  //     break;
  //   }
  //   default:
  //     console.log("[stripe-webhook] unhandled:", type);
  // }

  // ====== ETAPA 3 — TODO: marcar processed_at ======
  // await db.stripe_events.update({ event_id: eventId }, { processed_at: now() });

  console.log("[stripe-webhook]", JSON.stringify({ eventId, type }).slice(0, 400));
  return res.status(200).json({ received: true });
}
