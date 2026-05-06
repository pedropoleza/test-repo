/**
 * GET /api/cron/qualify
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Job diário (Etapa 4). Qualifica indicações cujo relógio dos 30 dias
 * já estourou.
 *
 * Decisões aplicadas:
 *   D1=b → o relógio começa em first_payment_at.
 *   D2=a → desqualificações retroativas (refunded/fraud/canceled)
 *           recalculam o tier do indicador na hora (já feito pelos
 *           webhooks; o cron só finaliza promoções pendentes).
 *
 * Override de tempo em dev: ?simulate_days_passed=30 ignora a janela.
 *
 * Provider de cron (D7=a): Vercel Cron — definido em vercel.json.
 */
import { db } from "../../lib/server/db.js";

const QUALIFYING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Vercel Cron envia o header `x-vercel-cron`. Em runs manuais
  // (curl), exigimos o CRON_SECRET para evitar abuso.
  const isVercelCron = !!req.headers["x-vercel-cron"];
  const expected = process.env.CRON_SECRET;
  if (!isVercelCron) {
    const provided = req.headers["x-cron-secret"];
    if (!expected || provided !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const simulateDays = Math.max(0, Number(req.query?.simulate_days_passed) || 0);
  const cutoff = new Date(
    Date.now() - Math.max(0, QUALIFYING_DAYS - simulateDays) * DAY_MS,
  );

  const summary = {
    cutoff_iso: cutoff.toISOString(),
    promoted: 0,
    skipped: 0,
    error_rows: 0,
    started_at: new Date().toISOString(),
  };

  // 1) Buscar candidatos: status=paid e first_payment_at <= cutoff
  const { data: candidates, error: selErr } = await db()
    .from("referrals")
    .select("id,indicador_location,first_payment_at")
    .eq("status", "paid")
    .lte("first_payment_at", cutoff.toISOString());
  if (selErr) {
    console.error("[cron-qualify] select error:", selErr);
    return res.status(500).json({ error: "db_error", message: selErr.message });
  }

  // 2) Promover cada um pra qualified
  for (const ref of candidates || []) {
    const { error } = await db()
      .from("referrals")
      .update({
        status: "qualified",
        qualified_at: new Date().toISOString(),
      })
      .eq("id", ref.id)
      .eq("status", "paid"); // proteção contra race
    if (error) {
      summary.error_rows++;
      console.error("[cron-qualify] update error:", ref.id, error);
    } else {
      summary.promoted++;
    }
  }

  summary.finished_at = new Date().toISOString();
  console.info("[cron.qualification.run]", JSON.stringify(summary));
  return res.status(200).json({ ok: true, summary });
}
