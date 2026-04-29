/*
 * Programa de indicações — tabela de níveis.
 *
 * Regras (especificação do usuário):
 *   - Apenas indicações QUALIFICADAS contam (indicado fechou e pagou).
 *     Pendentes, em negociação ou não convertidas não contam.
 *   - Cancelamento, reembolso ou fraude removem a indicação da contagem.
 *   - Sempre que a contagem muda, o sistema recalcula nível e benefícios.
 *   - "Desconto único" = bonificação pontual; teto de $100.
 *   - "Desconto mensal" = recorrente enquanto o cliente mantiver o nível;
 *     só começa a partir de 5 indicações qualificadas.
 *   - O nível máximo (Muito Avançado) aplica multiplicador 1.2x sobre o
 *     retorno estimado (Starter, Médio e Growth).
 *
 * Retorno base por indicação:
 *   Starter = 60 USD ; Médio = 120 USD ; Growth = 250 USD.
 */

export const returnPerReferralUsd = {
  starter: 60,
  medio: 120,
  growth: 250,
};

export const premiumMultiplier = 1.2;

export const levels = [
  {
    id: "none",
    name: "Sem nível",
    minQualifiedReferrals: 0,
    discountOnceUsd: 0,
    discountMonthlyUsd: 0,
    premium: false,
  },
  {
    id: "iniciante",
    name: "Iniciante",
    minQualifiedReferrals: 1,
    discountOnceUsd: 30,
    discountMonthlyUsd: 0,
    premium: false,
  },
  {
    id: "basico",
    name: "Básico",
    minQualifiedReferrals: 3,
    discountOnceUsd: 70,
    discountMonthlyUsd: 0,
    premium: false,
  },
  {
    id: "intermediario",
    name: "Intermediário",
    minQualifiedReferrals: 5,
    discountOnceUsd: 100,
    discountMonthlyUsd: 30,
    premium: false,
  },
  {
    id: "avancado",
    name: "Avançado",
    minQualifiedReferrals: 8,
    discountOnceUsd: 100,
    discountMonthlyUsd: 50,
    premium: false,
  },
  {
    id: "muito-avancado",
    name: "Muito Avançado",
    minQualifiedReferrals: 10,
    discountOnceUsd: 100,
    discountMonthlyUsd: 100,
    premium: true,
  },
];
