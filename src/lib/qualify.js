import {
  referralDiscountTable,
  discountModel,
} from "../config/tiers.js";

/*
 * Step function: dados N indicados ativos, retorna a maior linha da
 * tabela cuja `activeReferrals <= N`. Desconto vale só para o próximo
 * mês — basta chamar de novo no próximo ciclo.
 */

export function countActiveReferrals(referrals = []) {
  return referrals.filter((r) => r.active).length;
}

export function qualify(referrals = []) {
  const activeCount = countActiveReferrals(referrals);
  const sorted = [...referralDiscountTable].sort(
    (a, b) => a.activeReferrals - b.activeReferrals,
  );

  let current = sorted[0];
  for (const row of sorted) {
    if (activeCount >= row.activeReferrals) current = row;
  }

  const currentIndex = sorted.findIndex(
    (r) => r.activeReferrals === current.activeReferrals,
  );
  const next = sorted[currentIndex + 1] ?? null;

  const progressToNext = next
    ? Math.min(
        1,
        (activeCount - current.activeReferrals) /
          (next.activeReferrals - current.activeReferrals),
      )
    : 1;

  return {
    activeCount,
    current,
    next,
    progressToNext,
    discountUsd: current.discountUsd,
    currency: discountModel.currency,
    appliesTo: nextBillingMonthLabel(),
    rows: sorted.map((row) => ({
      ...row,
      state:
        row.activeReferrals === current.activeReferrals
          ? "current"
          : activeCount >= row.activeReferrals
            ? "qualified"
            : "locked",
    })),
  };
}

function nextBillingMonthLabel(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
