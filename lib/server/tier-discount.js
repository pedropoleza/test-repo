/**
 * Aplica/revoga descontos do INDICADOR conforme tier atual.
 *
 * Fluxo:
 *   recomputeTier(locationId) →
 *     1. Conta qualifieds da location
 *     2. Determina o tier (via tabela em src/config/tiers.js, importada
 *        no runtime do Node ESM — funciona)
 *     3. Se tier mudou (vs installations.current_tier_id):
 *        - Cria/atualiza tier_history row
 *        - Apply: cria coupons indicador-once + indicador-recurring
 *          (se discount > 0), aplica via subscription.discount no
 *          customer Stripe
 *        - Revoke: se o tier caiu pra "none" ou diminuiu, remove
 *          discounts da subscription
 *     4. Persiste tier_once_coupon_id, tier_recurring_coupon_id,
 *        current_tier_id, tier_applied_at em installations
 *
 * Idempotência: se chamamos múltiplas vezes seguidas com mesmo tier,
 * é noop.
 *
 * D5 = $20→$50 (já trocado); descontos do indicador vêm de tiers.js.
 */
import { db } from "./db.js";
import { stripeClient, ensureIndicadorCoupon } from "./stripe-coupon.js";
import { resolveStripeCustomerId } from "./d8-resolver.js";
import { levels as TIERS } from "../../src/config/tiers.js";
import { log } from "./log.js";
import { sendTierUp } from "./email.js";

function levelForCount(count) {
  // levels é ordenado ascendente pelo minQualifiedReferrals
  let pick = TIERS[0];
  for (const l of TIERS) {
    if (count >= l.minQualifiedReferrals) pick = l;
  }
  return pick;
}

async function countQualified(locationId) {
  const { count, error } = await db()
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("indicador_location", locationId)
    .eq("status", "qualified");
  if (error) throw error;
  return count || 0;
}

/**
 * Recomputa o tier de um indicador e aplica/revoga descontos na assinatura.
 * Idempotente. Loga em tier_history se houve transição.
 */
export async function recomputeTier(locationId, { reason } = {}) {
  if (!locationId) return { skipped: "no_location" };

  // 1) Conta qualifieds + determina novo tier
  const qualified = await countQualified(locationId);
  const newTier = levelForCount(qualified);

  // 2) Estado atual em installations
  const { data: row, error } = await db()
    .from("installations")
    .select(
      "location_id, current_tier_id, tier_once_coupon_id, " +
        "tier_recurring_coupon_id, stripe_customer_id, location_name",
    )
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { skipped: "no_installation" };

  if (row.current_tier_id === newTier.id) {
    return { skipped: "same_tier", tier: newTier.id, qualified };
  }

  console.info(
    "[tier-discount] transition:",
    locationId,
    row.current_tier_id || "(none)",
    "→",
    newTier.id,
    `(${qualified} qualified)`,
  );

  // 3) Log na tier_history
  try {
    await db().from("tier_history").insert({
      location_id: locationId,
      from_tier: row.current_tier_id,
      to_tier: newTier.id,
      qualified_count: qualified,
      reason: reason || null,
    });
  } catch (err) {
    console.warn("[tier-discount] history insert failed:", err.message);
  }

  // 4) Resolve stripe_customer_id (D8)
  const customerId = await resolveStripeCustomerId(locationId);
  if (!customerId) {
    // Não consegue aplicar discount, mas marca o tier mesmo assim
    await db()
      .from("installations")
      .update({
        current_tier_id: newTier.id,
        tier_applied_at: null,
      })
      .eq("location_id", locationId);
    return {
      transition: { from: row.current_tier_id, to: newTier.id },
      qualified,
      warning: "no_stripe_customer_mapped",
    };
  }

  // 5) Resolve subscription ativa do customer (1ª opção)
  const stripe = stripeClient();
  let subscription;
  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    subscription = subs.data?.[0];
  } catch (err) {
    console.warn("[tier-discount] sub list failed:", err.message);
  }

  // 6) Cria coupons necessários
  let onceCouponId = null;
  let recurringCouponId = null;
  if (newTier.discountOnceUsd > 0) {
    const once = await ensureIndicadorCoupon({
      locationId,
      tierId: newTier.id,
      kind: "once",
      amountUsd: newTier.discountOnceUsd,
    });
    onceCouponId = once.id;
  }
  if (newTier.discountMonthlyUsd > 0) {
    const rec = await ensureIndicadorCoupon({
      locationId,
      tierId: newTier.id,
      kind: "recurring",
      amountUsd: newTier.discountMonthlyUsd,
    });
    recurringCouponId = rec.id;
  }

  // 7) Aplica (ou revoga, se tier=none) na subscription
  if (subscription) {
    try {
      // Estratégia: aplica o coupon "once" se existir, senão o "recurring".
      // Stripe só permite 1 discount por subscription. Em V2 podemos
      // separar usando customer.discount + subscription.discount.
      const couponToApply = onceCouponId || recurringCouponId || null;
      if (couponToApply) {
        await stripe.subscriptions.update(subscription.id, {
          coupon: couponToApply,
        });
      } else {
        // Tier none → remove discount
        await stripe.subscriptions.deleteDiscount(subscription.id).catch(() => {});
      }
    } catch (err) {
      console.error("[tier-discount] apply failed:", err.message);
    }
  }

  // 8) Persiste estado
  await db()
    .from("installations")
    .update({
      current_tier_id: newTier.id,
      tier_once_coupon_id: onceCouponId,
      tier_recurring_coupon_id: recurringCouponId,
      tier_applied_at: subscription ? new Date().toISOString() : null,
    })
    .eq("location_id", locationId);

  log.info("tier.transition", {
    location_id: locationId,
    from: row.current_tier_id,
    to: newTier.id,
    qualified,
    once_amount_usd: newTier.discountOnceUsd,
    recurring_amount_usd: newTier.discountMonthlyUsd,
    sub_id: subscription?.id || null,
    reason,
  });

  // Email best-effort: notifica indicador quando sobe.
  // (Falha não bloqueia.)
  try {
    const fromIdx = TIERS.findIndex((t) => t.id === row.current_tier_id);
    const toIdx = TIERS.findIndex((t) => t.id === newTier.id);
    if (toIdx > fromIdx && newTier.id !== "none") {
      const meta = await db()
        .from("installations")
        .select("location_name")
        .eq("location_id", locationId)
        .maybeSingle();
      // Email do dono da location — não está no banco ainda, fica TODO.
      // sendTierUp(ownerEmail, { tierName: newTier.name, ... })
      log.info("email.queue.tier_up", {
        location_id: locationId,
        tier: newTier.id,
        // to: pendente — capturar email do owner via PIT
      });
    }
  } catch (err) {
    log.warn("tier.email_notify_failed", { error: err.message });
  }

  return {
    transition: { from: row.current_tier_id, to: newTier.id },
    qualified,
    coupons: { once: onceCouponId, recurring: recurringCouponId },
    subscription_updated: !!subscription,
  };
}
