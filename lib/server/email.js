/**
 * Email backend stub.
 *
 * V1: noop com log estruturado. Quando configurar provider (Resend
 * recomendado), seta RESEND_API_KEY no Vercel e este módulo passa a
 * disparar de verdade. Sem mudanças em quem chama.
 *
 * Triggers previstos (chamados de webhooks/cron):
 *   - sendIndicacaoQualificada(toEmail, { name, indicador })
 *   - sendTierUp(toEmail, { tierName, discountValue })
 *   - sendTierDown(toEmail, { tierName, reason })
 */
import { log } from "./log.js";

const PROVIDER = (process.env.EMAIL_PROVIDER || "noop").toLowerCase();
const FROM = process.env.EMAIL_FROM || "indicacoes@sparkleads.com";

async function sendViaResend(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`resend_${r.status}: ${txt.slice(0, 200)}`);
  }
  return await r.json();
}

async function dispatch(to, subject, html) {
  if (!to) {
    log.warn("email.skipped_no_recipient", { subject });
    return { skipped: "no_recipient" };
  }
  if (PROVIDER === "noop") {
    log.info("email.dispatch_noop", { to, subject, length: html?.length || 0 });
    return { sent: false, reason: "noop_provider" };
  }
  if (PROVIDER === "resend") {
    try {
      const result = await sendViaResend(to, subject, html);
      log.info("email.sent", { to, subject, id: result?.id });
      return { sent: true, id: result?.id };
    } catch (err) {
      log.error("email.send_failed", { to, subject, error: err.message });
      return { sent: false, error: err.message };
    }
  }
  log.warn("email.unknown_provider", { provider: PROVIDER });
  return { sent: false, reason: "unknown_provider" };
}

export async function sendIndicacaoQualificada(to, { indicadorName, indicadoName }) {
  return dispatch(
    to,
    "Sua indicação foi qualificada! 🎉",
    `<p>Olá ${indicadorName || ""},</p>
     <p>A indicação <strong>${indicadoName || ""}</strong> completou
     30 dias e foi qualificada no programa.</p>
     <p>Confira seu hub: <a href="https://test-repo-ebon-nine.vercel.app/">abrir</a></p>`,
  );
}

export async function sendTierUp(to, { tierName, discountValue }) {
  return dispatch(
    to,
    `Você subiu pro tier ${tierName}! 🚀`,
    `<p>Parabéns! Você ganhou um novo desconto de <strong>$${discountValue}</strong>.</p>`,
  );
}

export async function sendTierDown(to, { tierName, reason }) {
  return dispatch(
    to,
    `Mudança no seu tier`,
    `<p>Seu tier atual é ${tierName}. Motivo: ${reason || "ajuste"}.</p>`,
  );
}
