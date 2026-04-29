import { tiers, discountModel } from "../config/tiers.js";

/*
 * Auto-qualify por número de indicados ATIVOS.
 *
 * Regras:
 *   - Apenas indicados ativos contam (ver `countActiveReferrals`).
 *   - O desconto resultante vale somente para o próximo mês de cobrança.
 *   - Se um indicado se torna inativo antes do faturamento do próximo
 *     mês, o tier deve ser recalculado — esta função é pura, então
 *     basta chamá-la novamente.
 */

export function countActiveReferrals(referrals = []) {
  return referrals.filter((r) => r.active).length;
}

export function qualify(referrals = []) {
  const activeCount = countActiveReferrals(referrals);
  const sorted = [...tiers].sort(
    (a, b) => a.minActiveReferrals - b.minActiveReferrals,
  );

  let current = sorted[0];
  for (const tier of sorted) {
    if (activeCount >= tier.minActiveReferrals) current = tier;
  }

  const currentIndex = sorted.findIndex((t) => t.id === current.id);
  const next = sorted[currentIndex + 1] ?? null;

  const progressToNext = next
    ? Math.min(
        1,
        (activeCount - current.minActiveReferrals) /
          (next.minActiveReferrals - current.minActiveReferrals),
      )
    : 1;

  return {
    activeCount,
    current,
    next,
    progressToNext,
    discountPct: current.discountPct,
    appliesTo: nextBillingMonthLabel(),
    durationInMonths: discountModel.durationInMonths,
    states: sorted.map((t) => ({
      ...t,
      state:
        t.id === current.id
          ? "current"
          : activeCount >= t.minActiveReferrals
            ? "qualified"
            : "locked",
    })),
  };
}

function nextBillingMonthLabel(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
