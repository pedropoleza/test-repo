/**
 * POST /api/admin/cleanup-pit-installations
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Limpeza one-shot: arquiva Stripe Promotion Codes e remove rows
 * de installations com provision_source='agency_pit'.
 *
 * Útil quando mudamos a lógica de derivação de cupom e queremos
 * que o resync recrie do zero com nomes melhores. Não toca nas rows
 * provision_source='oauth' (essas têm tokens próprios e não dá pra
 * recriar via PIT).
 */
import Stripe from "stripe";
import { db } from "../../lib/server/db.js";

let _stripe = null;
function stripeClient() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const expected = process.env.CRON_SECRET;
  const provided = req.headers["x-cron-secret"];
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // 1) Lê as rows agency_pit
  const { data: rows, error } = await db()
    .from("installations")
    .select("location_id, location_name, coupon_code, stripe_promotion_id")
    .eq("provision_source", "agency_pit");
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });

  const summary = {
    candidates: rows.length,
    archived: 0,
    archive_errors: [],
    deleted_rows: 0,
  };

  // 2) Arquiva cada Promotion Code no Stripe
  for (const r of rows) {
    if (!r.stripe_promotion_id) continue;
    try {
      await stripeClient().promotionCodes.update(r.stripe_promotion_id, {
        active: false,
      });
      summary.archived++;
    } catch (err) {
      summary.archive_errors.push({
        promo: r.stripe_promotion_id,
        location: r.location_id,
        error: err?.message || String(err),
      });
    }
  }

  // 3) Deleta as rows. Como referrals.indicador_location é FK ON DELETE
  //    CASCADE, isso também limpa qualquer indicação atrelada (não
  //    deve ter ainda).
  const { error: delErr, count } = await db()
    .from("installations")
    .delete({ count: "exact" })
    .eq("provision_source", "agency_pit");
  if (delErr) {
    return res.status(500).json({
      error: "delete_failed",
      detail: delErr.message,
      partial: summary,
    });
  }
  summary.deleted_rows = count || 0;

  console.info("[admin.cleanup]", JSON.stringify(summary));
  return res.status(200).json({ ok: true, summary });
}
