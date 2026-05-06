/**
 * POST /api/webhooks/ghl — handler real (Etapa 3).
 *
 * Validação:
 *   - HMAC-SHA256 do raw body com GHL_WEBHOOK_SECRET; assinatura
 *     vem em algum header (lista abaixo) — GHL usa `x-wh-signature`
 *     em apps recentes, mas tolera variações.
 *   - Idempotência: PK composta (source='ghl', event_id).
 *
 * Eventos relevantes (nomes podem variar; aceitamos sinônimos):
 *   - LocationCreated / subaccount.created → cria referral pending
 *     se foi criada via cupom de uma installation existente
 *   - LocationUpdated → noop por enquanto
 *   - SubscriptionCanceled / SubscriptionPaymentFailed →
 *     desqualifica via referrals.indicado_location
 *
 * GET retorna metadata.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../../lib/server/db.js";
import { readRawBody } from "../../lib/server/raw-body.js";

export const config = { api: { bodyParser: false } };

const SIG_HEADERS = [
  "x-wh-signature",
  "x-ghl-signature",
  "x-signature",
  "signature",
];

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
  if (!secret) return res.status(500).json({ error: "no_webhook_secret" });

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    return res.status(400).json({ error: "raw_body_error", message: err.message });
  }

  // Localiza a assinatura num dos headers conhecidos
  let providedSig = null;
  for (const h of SIG_HEADERS) {
    if (req.headers[h]) {
      providedSig = String(req.headers[h]);
      break;
    }
  }
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  let signatureValid = false;
  if (providedSig) {
    const a = Buffer.from(providedSig);
    const b = Buffer.from(expected);
    signatureValid = a.length === b.length && timingSafeEqual(a, b);
  }
  // Em produção: rejeitar se a assinatura for inválida.
  // Em transição (alguns webhooks GHL ainda não enviam header):
  // logamos signature_valid=false e deixamos passar; remover esse
  // fallback assim que confirmarmos qual header o GHL envia.
  if (!signatureValid && providedSig) {
    console.warn("[ghl-webhook] bad_signature");
    return res.status(401).json({ error: "bad_signature" });
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  const eventId = body.id || body.eventId || body.webhookId || cryptoRandomFallback();
  const type = body.type || body.event || body.eventType || "unknown";

  try {
    const ins = await db()
      .from("webhook_events")
      .insert({
        event_id: eventId,
        source: "ghl",
        event_type: type,
        payload: body,
        signature_valid: signatureValid,
      })
      .select("event_id")
      .maybeSingle();
    if (!ins.data && ins.error) throw ins.error;
  } catch (err) {
    if (err?.code === "23505" || /duplicate/i.test(err?.message || "")) {
      return res.status(200).json({ duplicate: true });
    }
    console.error("[ghl-webhook] insert error:", err);
    return res.status(500).json({ error: "db_error" });
  }

  try {
    await dispatch(type, body);
    await db()
      .from("webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("source", "ghl")
      .eq("event_id", eventId);
  } catch (err) {
    console.error("[ghl-webhook] handler error:", err);
  }

  console.info("[ghl-webhook] handled:", type, eventId);
  return res.status(200).json({ received: true });
}

async function dispatch(type, body) {
  const t = String(type).toLowerCase();
  if (t.includes("location") && t.includes("created")) {
    return onLocationCreated(body);
  }
  if (
    t.includes("subscription") &&
    (t.includes("canceled") || t.includes("cancelled") || t.includes("failed"))
  ) {
    return onSubscriptionLost(body);
  }
  // outros eventos — sem handler ainda
}

/**
 * Sub-account criada. Se ela foi criada via cupom de uma installation
 * existente, registramos uma referral pending.
 *
 * O contrato exato dos campos depende do payload do GHL; abaixo cobrimos
 * os casos mais comuns. Quando você capturar o primeiro evento real,
 * me passa o JSON e eu ajusto os caminhos.
 */
async function onLocationCreated(body) {
  const newLocationId =
    body?.locationId || body?.location?.id || body?.id || null;
  const couponUsed =
    body?.couponCode ||
    body?.coupon ||
    body?.location?.couponCode ||
    body?.metadata?.coupon ||
    null;
  const indicadoEmail =
    body?.email || body?.location?.email || body?.user?.email || null;

  if (!newLocationId || !couponUsed) {
    console.info("[ghl-webhook] location_created sem coupon — skip", newLocationId);
    return;
  }

  // Localiza a installation (indicador) pelo cupom
  const { data: install, error: instErr } = await db()
    .from("installations")
    .select("location_id")
    .eq("coupon_code", couponUsed)
    .maybeSingle();
  if (instErr) throw instErr;
  if (!install) {
    console.info("[ghl-webhook] cupom não bate com installation:", couponUsed);
    return;
  }

  const { error } = await db()
    .from("referrals")
    .upsert(
      {
        indicador_location: install.location_id,
        indicado_location: newLocationId,
        indicado_email: indicadoEmail,
        coupon_used: couponUsed,
        status: "pending",
        subaccount_created_at: new Date().toISOString(),
      },
      { onConflict: "indicado_location" },
    );
  if (error) throw error;
}

/**
 * D2=a → cancelamento ou falha persistente desqualifica.
 */
async function onSubscriptionLost(body) {
  const lostLocationId =
    body?.locationId || body?.location?.id || null;
  if (!lostLocationId) return;
  const { error } = await db()
    .from("referrals")
    .update({
      status: "canceled",
      disqualified_at: new Date().toISOString(),
      disqualification_reason: "ghl_subscription_lost",
    })
    .eq("indicado_location", lostLocationId)
    .in("status", ["pending", "paid", "qualified"]);
  if (error) throw error;
}

function cryptoRandomFallback() {
  // Eventos que não trazem id estável: criamos um UUID-ish. Não é
  // ideal pra idempotência (uma re-entrega vira evento novo). Quando
  // o GHL confirmar que sempre envia id, removemos.
  return "ghl_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
