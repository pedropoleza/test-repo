/**
 * Webhook do GHL.
 *
 * GHL faz POST com JSON quando eventos subscritos disparam:
 *   - LocationCreated / LocationUpdated
 *   - SubscriptionCreated / SubscriptionPaymentSuccess
 *   - SubscriptionCanceled / SubscriptionPaymentFailed
 *
 * Por enquanto: 200 OK + log. A próxima fase valida assinatura
 * (HMAC com GHL_WEBHOOK_SECRET), grava em `stripe_events` ou
 * `ghl_events` para idempotência, e dispara o pipeline de
 * qualificação / emissão de cupom.
 *
 * GET retorna 200 com info estática para a verificação inicial
 * que alguns sistemas fazem ao salvar a URL.
 */
export default function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "indicacoes-ghl-webhook",
      ready: true,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // TODO(fase 3):
  //  1. Validar assinatura (header X-Wh-Signature) com GHL_WEBHOOK_SECRET
  //  2. Persistir o eventId em ghl_events (idempotência)
  //  3. Despachar para o handler conforme req.body.type
  console.log("[ghl-webhook]", JSON.stringify(req.body || {}).slice(0, 800));

  return res.status(200).json({ received: true });
}
