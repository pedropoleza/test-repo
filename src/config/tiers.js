/*
 * Tier + discount configuration.
 *
 * PENDING USER INPUT — replace placeholder values once confirmed:
 *   1. `discountModel` — user said "Aguarde mais detalhes disso".
 *      Current placeholder: Stripe-style "repeating" coupon, 3 months, 50% cap.
 *   2. `tiers[].thresholdMRR` and `tiers[].discountPct` —
 *      user said "Aguarde". Numbers below are working defaults.
 *
 * Everything that consumes this file reads from the exported objects only,
 * so swapping values here is a one-edit change.
 */

export const discountModel = {
  // TODO(user): confirm — "A com repeating 3 meses, cap 50%" is the working assumption.
  type: "repeating",
  durationInMonths: 3,
  capPct: 50,
};

export const tiers = [
  // TODO(user): confirm tier names, MRR thresholds, and discount %.
  { id: "starter",  name: "Starter",  thresholdMRR:    0, discountPct:  0 },
  { id: "growth",   name: "Growth",   thresholdMRR:  500, discountPct: 10 },
  { id: "scale",    name: "Scale",    thresholdMRR: 2000, discountPct: 25 },
  { id: "elite",    name: "Elite",    thresholdMRR: 5000, discountPct: 40 },
  { id: "partner",  name: "Partner",  thresholdMRR: 10000, discountPct: 50 },
];
