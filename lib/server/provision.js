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
import { ensureIndicadoCoupon, ensureLocationPaymentLink } from "./stripe-coupon.js";

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
        "payment_link_url, provision_source, status",
    )
    .eq("location_id", locationId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (existing) {
    // Reconcilia: se já tem coupon mas falta payment_link, cria agora.
    if (
      existing.stripe_coupon_id &&
      !existing.payment_link_url &&
      process.env.STRIPE_PRICE_MONTHLY
    ) {
      try {
        const link = await ensureLocationPaymentLink({
          couponId: existing.stripe_coupon_id,
          locationId,
          locationName: existing.location_name,
          existingLinkId: existing.payment_link_id,
        });
        if (link) {
          const { data: upd } = await db()
            .from("installations")
            .update({
              payment_link_id: link.id,
              payment_link_url: link.url,
              last_sync_at: new Date().toISOString(),
            })
            .eq("location_id", locationId)
            .select(
              "location_id, location_name, company_id, coupon_code, " +
                "stripe_coupon_id, stripe_promotion_id, payment_link_id, " +
                "payment_link_url, provision_source, status",
            )
            .single();
          return upd || existing;
        }
      } catch (err) {
        console.warn("[provision] payment link reconcile failed:", err.message);
      }
    }
    return existing;
  }

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

  // Payment Link com cupom auto-aplicado (best-effort; degrada se Prices
  // não estiverem configurados ou Stripe falhar).
  let paymentLink = null;
  if (couponData?.stripeCouponId && process.env.STRIPE_PRICE_MONTHLY) {
    try {
      paymentLink = await ensureLocationPaymentLink({
        couponId: couponData.stripeCouponId,
        locationId,
        locationName,
        existingLinkId: null,
      });
    } catch (err) {
      console.warn("[provision] payment link skipped:", err.message);
    }
  }

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
      payment_link_id: paymentLink?.id || null,
      payment_link_url: paymentLink?.url || null,
      status: "active",
      last_sync_at: new Date().toISOString(),
    })
    .select(
      "location_id, location_name, company_id, coupon_code, " +
        "stripe_coupon_id, stripe_promotion_id, payment_link_id, " +
        "payment_link_url, provision_source, status",
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
            "payment_link_url, provision_source, status",
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
