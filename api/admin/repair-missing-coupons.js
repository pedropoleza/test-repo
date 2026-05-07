/**
 * POST /api/admin/repair-missing-coupons
 * Header: x-cron-secret: <CRON_SECRET>
 *
 * Pra cada installation com coupon_code IS NULL, tenta criar o cupom
 * agora via Stripe e atualizar a row. Reporta erro específico por
 * location pra diagnóstico.
 */
import Stripe from "stripe";
import { db } from "../../lib/server/db.js";

const INDICADO_DISCOUNT_USD = 20;

let _stripe = null;
function stripeClient() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

function deriveCouponBase(name) {
  if (!name) return null;
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);
  if (!words.length) return null;
  let base = "";
  for (const w of words) {
    base += w;
    if (base.length >= 5) break;
  }
  return base.slice(0, 16) || null;
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

  const { data: rows, error } = await db()
    .from("installations")
    .select("location_id, location_name")
    .is("coupon_code", null);
  if (error) return res.status(500).json({ error: "db_error", detail: error.message });

  const stripe = stripeClient();
  const out = { candidates: rows.length, fixed: 0, errors: [] };

  for (const r of rows) {
    const base =
      deriveCouponBase(r.location_name) ||
      `LOC${(r.location_id || "").slice(0, 6).toUpperCase()}`;
    let coupon, promo;
    try {
      // Reusa Coupon existente por metadata, ou cria
      const list = await stripe.coupons.list({ limit: 100 });
      coupon = list.data?.find(
        (c) =>
          c.metadata?.location_id === r.location_id &&
          c.metadata?.role === "indicado",
      );
      if (!coupon) {
        coupon = await stripe.coupons.create({
          amount_off: INDICADO_DISCOUNT_USD * 100,
          currency: "usd",
          duration: "once",
          name: `Indicação — ${r.location_name || r.location_id}`.slice(0, 40),
          metadata: {
            location_id: r.location_id,
            role: "indicado",
            source: "spark-referral-hub",
          },
        });
      }

      // Promo code: 4 tentativas (mais permissivo que ensureStripeCoupon)
      let attempt = `${base}OFF`;
      for (let i = 0; i < 4 && !promo; i++) {
        try {
          promo = await stripe.promotionCodes.create({
            coupon: coupon.id,
            code: attempt,
            metadata: { location_id: r.location_id },
          });
        } catch (err) {
          if (
            err?.code === "resource_already_exists" ||
            /already/i.test(err?.message || "")
          ) {
            const suf = (r.location_id || "")
              .slice(0, 4)
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "");
            attempt = `${base}${suf}${i || ""}OFF`;
            continue;
          }
          throw err;
        }
      }
      if (!promo) throw new Error("promo_collision_unresolved_after_4");

      const upd = await db()
        .from("installations")
        .update({
          coupon_code: promo.code,
          stripe_coupon_id: coupon.id,
          stripe_promotion_id: promo.id,
          last_sync_at: new Date().toISOString(),
        })
        .eq("location_id", r.location_id);
      if (upd.error) throw upd.error;
      out.fixed++;
    } catch (err) {
      out.errors.push({
        location_id: r.location_id,
        location_name: r.location_name,
        derived_base: base,
        error: err?.message || String(err),
        code: err?.code,
        type: err?.type,
      });
    }
  }

  return res.status(200).json({ ok: true, summary: out });
}
