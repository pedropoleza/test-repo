/*
 * Tabela de descontos por indicados ativos.
 *
 * Decisões confirmadas pelo usuário:
 *   - O desconto NÃO depende do plano. Qualquer plano participa.
 *   - Valor é fixo em USD, não percentual.
 *   - Step function: o cliente recebe o valor da maior linha cuja
 *     contagem de indicados ativos seja <= ao seu total de ativos.
 *   - Indicados inativos não contam.
 *   - Desconto vale apenas para o próximo mês de cobrança e é
 *     recalculado todo ciclo (não cumulativo, não retroativo).
 *
 * Valores confirmados (via planilha do usuário):
 *   1 indicação  →  USD 30
 *   3 indicações →  USD 70
 *   5 indicações →  USD 100
 *
 * TODO(user): completar as linhas restantes da planilha
 * (2, 4, 6, 7+ etc.) quando confirmadas.
 */

export const discountModel = {
  currency: "USD",
  durationInMonths: 1,
  cumulative: false,
  requiresActiveReferrals: true,
};

export const referralDiscountTable = [
  { activeReferrals: 0, discountUsd: 0 },
  { activeReferrals: 1, discountUsd: 30 },
  { activeReferrals: 3, discountUsd: 70 },
  { activeReferrals: 5, discountUsd: 100 },
];
