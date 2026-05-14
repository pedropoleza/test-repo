/**
 * GET /api/cron/qualify
 * Header: x-cron-secret: <CRON_SECRET>  (ou x-vercel-cron de Vercel Cron)
 *
 * Job diário (03:00 UTC). Qualifica indicações cujo relógio dos 30 dias
 * já estourou. Paginado em cursor pra escalar pra >5k referrals sem
 * estourar timeout do Vercel.
 *
 * Decisões aplicadas:
 *   D1=b → o relógio começa em first_payment_at.
 *   D2=a → desqualificações retroativas recalculam o tier (webhooks fazem
 *           isso; o cron só promove pra qualified).
 *
 * Override em dev: ?simulate_days_passed=30 ignora a janela de 30 dias.
 */
import { db } from "../../lib/server/db.js";
import { checkCronSecret, isVercelCron } from "../../lib/server/auth-admin.js";
import { recomputeTier } from "../../lib/server/tier-discount.js";

const QUALIFYING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 200;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!isVercelCron(req) && !checkCronSecret(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const simulateDays = Math.max(0, Number(req.query?.simulate_days_passed) || 0);
  const cutoffMs = Date.now() - Math.max(0, QUALIFYING_DAYS - simulateDays) * DAY_MS;
  const cutoff = new Date(cutoffMs);
  const affectedIndicators = new Set();

  const summary = {
    cutoff_iso: cutoff.toISOString(),
    pages_processed: 0,
    promoted: 0,
    error_rows: 0,
    indicators_recomputed: 0,
    started_at: new Date().toISOString(),
  };

  // Cursor por created_at (estável + indexado naturalmente pela PK)
  let cursorTs = null;
  while (summary.pages_processed < 50) {
    let q = db()
      .from("referrals")
      .select("id, indicador_location, created_at")
      .eq("status", "paid")
      .lte("first_payment_at", cutoff.toISOString())
      .order("created_at", { ascending: true })
      .limit(PAGE_SIZE);
    if (cursorTs) q = q.gt("created_at", cursorTs);

    const { data: page, error: selErr } = await q;
    if (selErr) {
      console.error("[cron-qualify] select error:", selErr);
      return res.status(500).json({ error: "db_error", message: selErr.message });
    }
    if (!page || !page.length) break;
    summary.pages_processed++;

    for (const ref of page) {
      const { error } = await db()
        .from("referrals")
        .update({
          status: "qualified",
          qualified_at: new Date().toISOString(),
        })
        .eq("id", ref.id)
        .eq("status", "paid"); // race-safe
      if (error) {
        summary.error_rows++;
        console.error("[cron-qualify] update error:", ref.id, error);
      } else {
        summary.promoted++;
        if (ref.indicador_location) affectedIndicators.add(ref.indicador_location);
      }
    }

    cursorTs = page[page.length - 1].created_at;
    if (page.length < PAGE_SIZE) break;
  }

  // Recomputa tier dos indicadores que tiveram qualificação nova.
  // recomputeTier é noop se a tabela tier-discount ainda não estiver
  // habilitada / D8 não resolvido — degradação silenciosa.
  for (const locId of affectedIndicators) {
    try {
      await recomputeTier(locId, { reason: "cron_qualify" });
      summary.indicators_recomputed++;
    } catch (err) {
      console.warn("[cron-qualify] recompute failed:", locId, err.message);
    }
  }

  summary.finished_at = new Date().toISOString();
  console.info("[cron.qualification.run]", JSON.stringify(summary));
  return res.status(200).json({ ok: true, summary });
}
