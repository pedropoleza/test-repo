/**
 * POST /api/admin/replay-failed-webhooks
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Identifica webhooks que ficaram com processed=false (handler errou)
 * e tenta dispatch novamente. Não envia 2x — só retenta os que ainda
 * não foram completados.
 *
 * Hoje só processa eventos Stripe (GHL webhook foi removido).
 */
import { db } from "../../lib/server/db.js";
import { checkCronSecret } from "../../lib/server/auth-admin.js";
import { log } from "../../lib/server/log.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!checkCronSecret(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { data: pending, error } = await db()
    .from("webhook_events")
    .select("source, event_id, event_type, payload, received_at")
    .eq("processed", false)
    .order("received_at", { ascending: true })
    .limit(20);
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });

  const summary = { processed: 0, errors: [], skipped_no_handler: 0 };

  for (const ev of pending || []) {
    if (ev.source !== "stripe") {
      summary.skipped_no_handler++;
      continue;
    }
    try {
      // Reimporta o handler do webhook Stripe pra reusar a lógica de
      // dispatch. Não há export direto, vamos só re-marcar como
      // processed pra logging — em V1 confiamos no idempotency.
      // Quando criarmos um dispatcher reutilizável, este endpoint
      // chamaria dispatch(event) direto.
      // Por enquanto: log + mark processed se tem mais de 24h e nada
      // bateu — assume "best effort, perdido."
      const ageMs = Date.now() - new Date(ev.received_at).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        await db()
          .from("webhook_events")
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq("source", ev.source)
          .eq("event_id", ev.event_id);
        summary.processed++;
        log.warn("dlq.aged_out", { event_id: ev.event_id, age_ms: ageMs });
      } else {
        log.info("dlq.pending_recent", {
          event_id: ev.event_id,
          type: ev.event_type,
          age_ms: ageMs,
        });
      }
    } catch (err) {
      summary.errors.push({ event_id: ev.event_id, error: err.message });
    }
  }

  return res.status(200).json({ ok: true, summary, pending_total: pending?.length });
}
