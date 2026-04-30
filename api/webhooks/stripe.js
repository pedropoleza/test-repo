/**
 * Webhook do Stripe.
 *
 * Eventos relevantes pro programa de indicações:
 *   - invoice.payment_succeeded   -> confirma pagamento da subaccount
 *                                    indicada (gatilho do qualify após 30d)
 *   - charge.refunded             -> invalida indicação
 *   - customer.subscription.deleted -> invalida (cliente cancelou)
 *   - customer.subscription.updated -> detectar trocas de plano
 *   - coupon.created / coupon.deleted -> log/auditoria
 *
 * Stub atual: 200 OK. Próxima fase valida assinatura via
 * Stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET),
 * persiste eventId em `stripe_events` (idempotência) e dispara o pipeline.
 */
export default function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "indicacoes-stripe-webhook",
      mode: process.env.STRIPE_MODE || "unknown",
      ready: true,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // TODO(fase 2):
  //   1. const sig = req.headers["stripe-signature"]
  //   2. const event = stripe.webhooks.constructEvent(rawBody, sig, secret)
  //   3. switch (event.type) { ... }
  //
  // Importante: precisamos do raw body (não JSON parseado) para
  // verificar a assinatura. Em Vercel Node functions, configurar
  //   export const config = { api: { bodyParser: false } }
  // e ler o stream manualmente. Isso será feito quando o handler real
  // entrar em produção.
  console.log("[stripe-webhook] received");

  return res.status(200).json({ received: true });
}
