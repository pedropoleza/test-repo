import { tiers, discountModel } from "../config/tiers.js";

/*
 * Auto-qualify logic. Per user direction ("seria um auto qualify mesmo
 * para os clientes visualizarem"), qualification is computed client-side
 * from the customer's MRR and surfaced directly in the UI — no admin
 * review gate.
 */

export function qualify(mrr) {
  const sorted = [...tiers].sort((a, b) => a.thresholdMRR - b.thresholdMRR);

  let current = sorted[0];
  for (const tier of sorted) {
    if (mrr >= tier.thresholdMRR) current = tier;
  }

  const currentIndex = sorted.findIndex((t) => t.id === current.id);
  const next = sorted[currentIndex + 1] ?? null;

  const progressToNext = next
    ? Math.min(
        1,
        (mrr - current.thresholdMRR) /
          (next.thresholdMRR - current.thresholdMRR),
      )
    : 1;

  const cappedDiscount = Math.min(current.discountPct, discountModel.capPct);

  return {
    current,
    next,
    progressToNext,
    cappedDiscount,
    durationInMonths: discountModel.durationInMonths,
    states: sorted.map((t) => ({
      ...t,
      state:
        t.id === current.id
          ? "current"
          : mrr >= t.thresholdMRR
            ? "qualified"
            : "locked",
    })),
  };
}
