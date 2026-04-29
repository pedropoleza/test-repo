import {
  levels,
  returnPerReferralUsd,
  premiumMultiplier,
} from "../config/tiers.js";

/*
 * Conta apenas indicações qualificadas — fecharam e pagaram, sem
 * cancelamento/reembolso/fraude.
 */
export function countQualifiedReferrals(referrals = []) {
  return referrals.filter(
    (r) => r.status === "qualified" && !r.refunded && !r.fraud,
  ).length;
}

function pickLevel(qualifiedCount) {
  const sorted = [...levels].sort(
    (a, b) => a.minQualifiedReferrals - b.minQualifiedReferrals,
  );
  let current = sorted[0];
  for (const level of sorted) {
    if (qualifiedCount >= level.minQualifiedReferrals) current = level;
  }
  return { current, sorted };
}

function estimateReturn(qualifiedCount, premium) {
  const factor = premium ? premiumMultiplier : 1;
  return {
    starter: qualifiedCount * returnPerReferralUsd.starter * factor,
    medio: qualifiedCount * returnPerReferralUsd.medio * factor,
    growth: qualifiedCount * returnPerReferralUsd.growth * factor,
    multiplier: factor,
  };
}

export function qualify(referrals = []) {
  const qualifiedCount = countQualifiedReferrals(referrals);
  const { current, sorted } = pickLevel(qualifiedCount);

  const currentIndex = sorted.findIndex((l) => l.id === current.id);
  const next = sorted[currentIndex + 1] ?? null;

  const progressToNext = next
    ? Math.min(
        1,
        (qualifiedCount - current.minQualifiedReferrals) /
          (next.minQualifiedReferrals - current.minQualifiedReferrals),
      )
    : 1;

  const referralsToNext = next
    ? Math.max(0, next.minQualifiedReferrals - qualifiedCount)
    : 0;

  return {
    qualifiedCount,
    level: current,
    next,
    referralsToNext,
    progressToNext,
    discountOnceUsd: current.discountOnceUsd,
    discountMonthlyUsd: current.discountMonthlyUsd,
    estimatedReturn: estimateReturn(qualifiedCount, current.premium),
    rows: sorted.map((level) => ({
      ...level,
      state:
        level.id === current.id
          ? "current"
          : qualifiedCount >= level.minQualifiedReferrals
            ? "qualified"
            : "locked",
    })),
  };
}
