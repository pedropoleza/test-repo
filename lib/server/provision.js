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
import { ensureIndicadoCoupon } from "./stripe-coupon.js";

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
        "stripe_coupon_id, stripe_promotion_id, provision_source, status",
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
