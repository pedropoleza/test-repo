import {
  levels,
  returnPerReferralUsd,
  premiumMultiplier,
} from "../config/tiers.js";

/*
 * Regra de qualificação automática:
 *   1. A subaccount do indicado foi criada (subaccountAddedAt presente).
 *   2. Já passou pelo menos `qualifyingDays` dias (default 30) desde
 *      a criação da subaccount.
 *   3. O cupom do indicador foi emitido (couponIssued === true).
 *   4. A indicação não foi invalidada (cancelled / refunded / fraud).
 *
 * O sistema não exige input do usuário: dado o array de referrals, o
 * nível, descontos e retorno são todos derivados — basta re-render a
 * cada ciclo (ou a cada visualização).
 */

export const QUALIFYING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function isInvalidated(referral) {
  return Boolean(referral.cancelled || referral.refunded || referral.fraud);
}

export function qualificationDate(referral, qualifyingDays = QUALIFYING_DAYS) {
  if (!referral.subaccountAddedAt) return null;
  const added = toDate(referral.subaccountAddedAt);
  return new Date(added.getTime() + qualifyingDays * DAY_MS);
}

export function referralStatus(referral, now = new Date(), qualifyingDays = QUALIFYING_DAYS) {
  if (isInvalidated(referral)) return "invalidated";
  if (!referral.subaccountAddedAt) return "awaiting-subaccount";

  const ageDays = Math.floor(
    (now.getTime() - toDate(referral.subaccountAddedAt).getTime()) / DAY_MS,
  );
  const aged = ageDays >= qualifyingDays;
  const couponIssued = Boolean(referral.couponIssued);

  if (aged && couponIssued) return "qualified";
  if (!aged && !couponIssued) return "awaiting-both";
  if (!aged) return "awaiting-time";
  return "awaiting-coupon";
}

export function daysUntilQualified(
  referral,
  now = new Date(),
  qualifyingDays = QUALIFYING_DAYS,
) {
  if (!referral.subaccountAddedAt) return null;
  const target = qualificationDate(referral, qualifyingDays);
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY_MS));
}

export function countQualifiedReferrals(referrals = [], now = new Date()) {
  return referrals.filter((r) => referralStatus(r, now) === "qualified").length;
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

export function qualify(referrals = [], now = new Date()) {
  const annotated = referrals.map((r) => ({
    ...r,
    status: referralStatus(r, now),
    qualifiesOn: qualificationDate(r),
    daysUntilQualified: daysUntilQualified(r, now),
  }));
  const qualifiedCount = annotated.filter((r) => r.status === "qualified").length;
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
    referrals: annotated,
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
