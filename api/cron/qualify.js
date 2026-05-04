/**
 * GET /api/cron/qualify
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Job diário (Etapa 4). Promove `referrals` em status `paid` cujo
 * relógio de qualificação já estourou (D1 define quando o relógio
 * começa) para status `qualified`, recalcula o tier do indicador, e
 * grava transições.
 *
 * Provider de cron (D7): Vercel Cron (default), QStash ou GitHub
 * Actions. Configuração concreta entra na Etapa 4.
 *
 * Suporta override em dev: ?simulate_days_passed=30 ignora a janela
 * de espera pra acelerar testes.
 */

const QUALIFYING_DAYS = 30;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // ====== ETAPA 4 — proteção por header secreto ======
  const expected = process.env.CRON_SECRET;
  const provided = req.headers["x-cron-secret"];
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // ====== ETAPA 4 — override de tempo em dev ======
  // const simulateDays = Number(req.query?.simulate_days_passed) || 0;
  // const cutoff = new Date(Date.now() - (QUALIFYING_DAYS - simulateDays) * 86400000);

  // ====== ETAPA 4 — buscar candidates ======
  // const candidates = await db.referrals.findMany({
  //   where: {
  //     status: "paid",
  //     first_payment_at: { lte: cutoff },
  //   },
  // });

  // ====== ETAPA 4 — promover + recalcular tier ======
  // const summary = { promoted: 0, demoted: 0, tierChanges: 0 };
  // for (const ref of candidates) {
  //   await db.referrals.update(ref.id, {
  //     status: "qualified",
  //     qualified_at: new Date(),
  //   });
  //   summary.promoted++;
  //   const change = await recomputeIndicadorTier(ref.indicador_location);
  //   if (change) {
  //     summary.tierChanges++;
  //     // TODO: disparar workflow GHL de notificação (Etapa 4)
  //   }
  // }

  // ====== ETAPA 4 — desqualificações pendentes ======
  // Ex.: referrals em status refunded/fraud/canceled que ainda não
  // tiveram o tier do indicador recalculado.
  // for (const ref of pendingDisqualifications) {
  //   await recomputeIndicadorTier(ref.indicador_location);
  //   summary.demoted++;
  // }

  // STUB: nada pra fazer ainda
  const summary = {
    note: "stub_no_db",
    cutoff_days: QUALIFYING_DAYS,
    promoted: 0,
    demoted: 0,
    tier_changes: 0,
  };
  console.log("[cron.qualification.run]", JSON.stringify(summary));
  return res.status(200).json({ ok: true, summary });
}
