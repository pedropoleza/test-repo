/*
 * Dados de exemplo para validação visual.
 *
 * Em produção, esta lista virá da API (GHL / backend) e não deve ser
 * editada manualmente. Cada item traz:
 *   - subaccountAddedAt: data em que a subaccount do indicado foi criada
 *   - couponIssued: se o cupom do indicador já foi emitido
 *   - cancelled/refunded/fraud: invalidações (opcional)
 *
 * O dataset abaixo está calibrado para a data do prototype (final de
 * abril/2026): 5 qualificadas (libera nível Intermediário com $30/mês),
 * 2 aguardando o ciclo de 30 dias e 1 aguardando emissão de cupom.
 */
export const sampleReferrals = [
  {
    name: "Auto Center São Paulo",
    subaccountAddedAt: "2026-01-15",
    couponIssued: true,
  },
  {
    name: "Motoro Orlando",
    subaccountAddedAt: "2026-02-10",
    couponIssued: true,
  },
  {
    name: "Drive Miami",
    subaccountAddedAt: "2026-03-05",
    couponIssued: true,
  },
  {
    name: "RioCar Premium",
    subaccountAddedAt: "2026-03-20",
    couponIssued: true,
  },
  {
    name: "GarageOne",
    subaccountAddedAt: "2026-03-29",
    couponIssued: true,
  },
  {
    name: "AutoElite",
    subaccountAddedAt: "2026-04-15",
    couponIssued: true,
  },
  {
    name: "FastWheels",
    subaccountAddedAt: "2026-04-20",
    couponIssued: false,
  },
  {
    name: "OldDealer (cancelada)",
    subaccountAddedAt: "2026-02-01",
    couponIssued: true,
    cancelled: true,
  },
];
