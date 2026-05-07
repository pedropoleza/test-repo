/**
 * Provisionamento de installations.
 *
 * Modelo dual:
 *   - 'oauth':       installation feita via /api/oauth/callback (per-location).
 *                    Tem access_token + refresh_token próprios (encriptados).
 *   - 'agency_pit':  installation provisionada via Private Integration token
 *                    da agency. Sem tokens próprios — usamos GHL_AGENCY_PIT
 *                    pra qualquer operação de leitura/escrita nessa location.
 *
 * ensureInstallation(locationId, hint?) é idempotente. Se a row já existe
 * retorna ela; se não, busca metadata da location no GHL via PIT, cria
 * Stripe Coupon + Promotion Code, e insere a row.
 */
import Stripe from "stripe";
import { db } from "./db.js";

const INDICADO_DISCOUNT_USD = 20; // D5=a (working assumption)

let _stripe = null;
function stripeClient() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

/**
 * Deriva o "base" do cupom (sem o sufixo OFF) a partir do nome da
 * location. Combina palavras até atingir pelo menos 5 chars; trunca
 * em 16 pra não estourar.
 *
 * Exemplos:
 *   "3T Financial Solution"      → "3TFINANCIAL"   → "3TFINANCIALOFF"
 *   "3 T Financial Solution"     → "3TFINANCIAL"   → "3TFINANCIALOFF"
 *   "Adriano Buzolin Cruz"       → "ADRIANO"       → "ADRIANOOFF"
 *   "A Forja Financial"          → "AFORJA"        → "AFORJAOFF"
 *   "Spark Leads"                → "SPARK"         → "SPARKOFF"
 *   "3t"                         → "3T"            → "3TOFF"
 */
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

async function fetchLocationMeta(locationId) {
  const pit = process.env.GHL_AGENCY_PIT;
  if (!pit) return null;
  try {
    const r = await fetch(
      `https://services.leadconnectorhq.com/locations/${locationId}`,
      {
        headers: {
          Authorization: `Bearer ${pit}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
      },
    );
    if (!r.ok) return null;
    const data = await r.json();
    const loc = data?.location || data;
    return {
      name: loc?.name || null,
      companyId: loc?.companyId || null,
    };
  } catch {
    return null;
  }
}

async function ensureStripeCoupon(locationId, locationName) {
  const base =
    deriveCouponBase(locationName) ||
    `LOC${(locationId || "").slice(0, 6).toUpperCase()}`;
  const stripe = stripeClient();
  try {
    // Busca coupon existente por metadata (idempotência cross-deploys)
    const list = await stripe.coupons.list({ limit: 100 }).catch(() => ({ data: [] }));
    let coupon = list.data?.find(
      (c) => c.metadata?.location_id === locationId && c.metadata?.role === "indicado",
    );
    if (!coupon) {
      coupon = await stripe.coupons.create({
        amount_off: INDICADO_DISCOUNT_USD * 100,
        currency: "usd",
        duration: "once",
        name: `Indicação — ${locationName || locationId}`,
        metadata: {
          location_id: locationId,
          role: "indicado",
          source: "spark-referral-hub",
        },
      });
    }

    // Promotion Code: tenta `${base}OFF`. Em colisão, adiciona sufixo
    // de 4 chars do locationId ANTES do OFF (ex: "3TFINANCIALOFF" colide
    // → "3TFINANCIALBK5ROFF").
    let promo;
    let attempt = `${base}OFF`;
    for (let i = 0; i < 3; i++) {
      try {
        promo = await stripe.promotionCodes.create({
          coupon: coupon.id,
          code: attempt,
          metadata: { location_id: locationId },
        });
        break;
      } catch (err) {
        if (
          err?.code === "resource_already_exists" ||
          /already/i.test(err?.message || "")
        ) {
          const suf = (locationId || "")
            .slice(0, 4)
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
          attempt = `${base}${suf}${i || ""}OFF`;
          continue;
        }
        throw err;
      }
    }
    if (!promo) throw new Error("promo_code_collision_unresolved");

    return {
      couponCode: promo.code,
      stripeCouponId: coupon.id,
      stripePromotionId: promo.id,
    };
  } catch (err) {
    console.warn("[provision] stripe coupon skipped:", err?.message || err);
    return null;
  }
}

/**
 * Idempotente. Retorna a installation existente ou cria uma nova
 * (provision_source='agency_pit') usando o PIT da agency.
 */
export async function ensureInstallation(locationId, hint = {}) {
  if (!locationId) throw new Error("locationId required");

  const { data: existing, error: readErr } = await db()
    .from("installations")
    .select(
      "location_id, location_name, company_id, coupon_code, " +
        "stripe_coupon_id, stripe_promotion_id, provision_source, status",
    )
    .eq("location_id", locationId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (existing) return existing;

  // Não existe — provisiona via PIT
  let locationName = hint.locationName || null;
  let companyId = hint.companyId || null;
  if (!locationName || !companyId) {
    const meta = await fetchLocationMeta(locationId);
    if (meta) {
      locationName = locationName || meta.name;
      companyId = companyId || meta.companyId;
    }
  }

  const couponData = await ensureStripeCoupon(locationId, locationName);

  const { data: created, error: insertErr } = await db()
    .from("installations")
    .insert({
      location_id: locationId,
      location_name: locationName,
      company_id: companyId,
      provision_source: "agency_pit",
      coupon_code: couponData?.couponCode || null,
      stripe_coupon_id: couponData?.stripeCouponId || null,
      stripe_promotion_id: couponData?.stripePromotionId || null,
      status: "active",
      last_sync_at: new Date().toISOString(),
    })
    .select(
      "location_id, location_name, company_id, coupon_code, " +
        "stripe_coupon_id, stripe_promotion_id, provision_source, status",
    )
    .single();

  if (insertErr) {
    // Race possível se duas requests chegaram juntas. Re-lê.
    if (
      insertErr.code === "23505" ||
      /duplicate/i.test(insertErr.message || "")
    ) {
      const { data: row } = await db()
        .from("installations")
        .select(
          "location_id, location_name, company_id, coupon_code, " +
            "stripe_coupon_id, stripe_promotion_id, provision_source, status",
        )
        .eq("location_id", locationId)
        .maybeSingle();
      if (row) return row;
    }
    throw insertErr;
  }

  console.info(
    "[provision] new installation:",
    locationId,
    locationName || "(no name)",
    couponData ? `coupon=${couponData.couponCode}` : "(no coupon)",
  );
  return created;
}

export { fetchLocationMeta };
