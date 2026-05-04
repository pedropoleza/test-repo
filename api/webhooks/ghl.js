/**
 * Webhook do GHL — skeleton com validação HMAC + dispatch por tipo.
 *
 * Eventos relevantes (Etapa 3):
 *   - LocationCreated / LocationUpdated     → cria/atualiza referrals
 *   - SubscriptionCreated / PaymentSuccess  → confirma pagamento
 *   - SubscriptionCanceled / PaymentFailed  → invalida indicação
 *
 * Estado atual: valida assinatura (se header presente), grava no log
 * e responde 200. Idempotência e persistência entram quando a Etapa 0
 * fechar o DATABASE_URL.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

// Vercel parseia JSON automaticamente; pra HMAC precisamos do raw body.
// Solução: re-stringify com mesma ordem de chaves não é ideal — quando o
// handler real entrar, vamos desligar o bodyParser pra ler o stream:
//   export const config = { api: { bodyParser: false } };
// e usar uma função que lê chunks do req. Por enquanto usamos JSON.stringify
// para o stub.

function verifyHmac(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "indicacoes-ghl-webhook",
      ready_for_signature_validation: !!process.env.GHL_WEBHOOK_SECRET,
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[ghl-webhook] GHL_WEBHOOK_SECRET not set");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  // ====== ETAPA 3 — TODO: validar HMAC com raw body ======
  // const rawBody = await readRaw(req);
  // const sig = req.headers["x-wh-signature"]; // ou nome correto do GHL
  // if (!verifyHmac(rawBody, sig, secret)) {
  //   return res.status(401).json({ error: "bad_signature" });
  // }

  const body = req.body || {};
  const eventId = body.id || body.eventId || body.webhookId;
  const type = body.type || body.event;

  // ====== ETAPA 3 — TODO: idempotência ======
  // try {
  //   await db.ghl_events.insert({ event_id: eventId, type, payload: body });
  // } catch (e) {
  //   if (isUniqueViolation(e)) return res.status(200).json({ duplicate: true });
  //   throw e;
  // }

  // ====== ETAPA 3 — TODO: dispatch por tipo ======
  // switch (type) {
  //   case "LocationCreated":
  //   case "subaccount.created":
  //     await handleSubaccountCreated(body);    // grava referral pending
  //     break;
  //   case "SubscriptionCreated":
  //     // TODO(D1): se D1 = b ("primeiro pagamento"), aguardar invoice
  //     break;
  //   case "SubscriptionCanceled":
  //   case "SubscriptionPaymentFailed":
  //     // TODO(D2): desqualificar; recalcular tier do indicador
  //     break;
  //   default:
  //     console.log("[ghl-webhook] unhandled type:", type);
  // }

  // ====== ETAPA 3 — TODO: marcar processed_at ======
  // await db.ghl_events.update({ event_id: eventId }, { processed_at: now() });

  console.log("[ghl-webhook]", JSON.stringify({ eventId, type }).slice(0, 400));
  return res.status(200).json({ received: true });
}

// Helper para o handler real. Configure { api: { bodyParser: false } }
// na rota e leia o stream:
//
// async function readRaw(req) {
//   const chunks = [];
//   for await (const c of req) chunks.push(c);
//   return Buffer.concat(chunks).toString("utf8");
// }
