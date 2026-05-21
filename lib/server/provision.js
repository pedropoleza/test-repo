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
 * o cupom do INDICADO (via lib/server/stripe-coupon.js), e insere a row.
 */
import { db } from "./db.js";
import {
  ensureIndicadoCoupon,
  ensureLocationPlanCoupons,
} from "./stripe-coupon.js";

/**
 * Carrega { starter, growth, scale } => coupon_id dos planos.
 * Esses são os cupons COMPARTILHADOS (INDICACAO_*) com applies_to product.
 */
async function loadPlanCouponIds() {
  try {
    const { data, error } = await db()
      .from("plan_config")
      .select("tier, coupon_id");
    if (error || !data) return null;
    const out = {};
    for (const row of data) {
      if (row.coupon_id) out[row.tier] = row.coupon_id;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
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
      email: loc?.email || null,
    };
  } catch {
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
        "stripe_coupon_id, stripe_promotion_id, payment_link_id, " +
        "payment_link_url, plan_coupons, provision_source, status",
    )
    .eq("location_id", locationId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (existing) return existing;

  let locationName = hint.locationName || null;
  let companyId = hint.companyId || null;
  if (!locationName || !companyId) {
    const meta = await fetchLocationMeta(locationId);
    if (meta) {
      locationName = locationName || meta.name;
      companyId = companyId || meta.companyId;
    }
  }

  const couponData = await ensureIndicadoCoupon(locationId, locationName);

  // Per-plan promotion codes (SPARKOFFSTARTER/GROWTH/SCALE): cada um aponta
  // pro cupom compartilhado do tier (com applies_to product) e carrega
  // metadata.indicador_location = essa location. Usar o code registra
  // a indicação automaticamente.
  let planCoupons = null;
  try {
    const planCouponIds = await loadPlanCouponIds();
    if (planCouponIds) {
      planCoupons = await ensureLocationPlanCoupons(
        locationId,
        locationName,
        planCouponIds,
      );
    }
  } catch (err) {
    console.warn("[provision] plan coupons skipped:", err?.message || err);
  }

  // Nota: per-location Payment Link foi removido (Stripe não aceita
  // `discounts:[]` em Payment Links). Auto-apply do desconto agora é
  // feito via /api/r/[cupom] que cria Checkout Session on-demand.

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
      plan_coupons: planCoupons && Object.keys(planCoupons).length ? planCoupons : null,
      status: "active",
      last_sync_at: new Date().toISOString(),
    })
    .select(
      "location_id, location_name, company_id, coupon_code, " +
        "stripe_coupon_id, stripe_promotion_id, payment_link_id, " +
        "payment_link_url, plan_coupons, provision_source, status",
    )
    .single();

  if (insertErr) {
    if (
      insertErr.code === "23505" ||
      /duplicate/i.test(insertErr.message || "")
    ) {
      const { data: row } = await db()
        .from("installations")
        .select(
          "location_id, location_name, company_id, coupon_code, " +
            "stripe_coupon_id, stripe_promotion_id, payment_link_id, " +
            "payment_link_url, plan_coupons, provision_source, status",
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
