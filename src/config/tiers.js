/*
 * Tier + discount configuration.
 *
 * Decisões confirmadas pelo usuário:
 *   - Apenas 3 planos: Starter, Growth, Scale.
 *   - Qualificação depende de INDICADOS ATIVOS na plataforma —
 *     se um indicado deixa a plataforma, ele para de contar.
 *   - Desconto só é aplicado no PRÓXIMO MÊS (validade de 1 ciclo,
 *     não-acumulativo, não-retroativo).
 *
 * PENDENTE — confirmar com o usuário:
 *   - Percentuais de desconto e thresholds de indicados ativos por tier.
 *     Os valores abaixo são working defaults.
 */

export const discountModel = {
  type: "next-month-only",
  durationInMonths: 1,
  cumulative: false,
  // O desconto exige que os indicados continuem ativos no momento
  // do faturamento do próximo mês. Reavaliado todo ciclo.
  requiresActiveReferrals: true,
};

export const tiers = [
  // TODO(user): confirmar thresholds e % conforme tabela final.
  { id: "starter", name: "Starter", minActiveReferrals: 0, discountPct:  0 },
  { id: "growth",  name: "Growth",  minActiveReferrals: 3, discountPct: 10 },
  { id: "scale",   name: "Scale",   minActiveReferrals: 7, discountPct: 25 },
];
