/**
 * POST /api/admin/repair-missing-coupons
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Pra cada installation com coupon_code IS NULL, chama ensureIndicadoCoupon
 * e atualiza a row. Reporta erro específico por location pra diagnóstico.
 */
import { timingSafeEqual } from "node:crypto";
import { db } from "../../lib/server/db.js";
import { ensureIndicadoCoupon } from "../../lib/server/stripe-coupon.js";

function safeEq(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!safeEq(process.env.CRON_SECRET, req.headers["x-cron-secret"])) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { data: rows, error } = await db()
    .from("installations")
    .select("location_id, location_name")
    .is("coupon_code", null);
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });

  const out = { candidates: rows.length, fixed: 0, errors: [] };

  for (const r of rows) {
    try {
      const cd = await ensureIndicadoCoupon(r.location_id, r.location_name);
      if (!cd) {
        out.errors.push({
          location_id: r.location_id,
          location_name: r.location_name,
          error: "ensure_returned_null",
        });
        continue;
      }
      const upd = await db()
        .from("installations")
        .update({
          coupon_code: cd.couponCode,
          stripe_coupon_id: cd.stripeCouponId,
          stripe_promotion_id: cd.stripePromotionId,
          last_sync_at: new Date().toISOString(),
        })
        .eq("location_id", r.location_id);
      if (upd.error) throw upd.error;
      out.fixed++;
    } catch (err) {
      out.errors.push({
        location_id: r.location_id,
        location_name: r.location_name,
        error: err?.message || String(err),
      });
    }
  }

  return res.status(200).json({ ok: true, summary: out });
}
