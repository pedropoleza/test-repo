# Decisões — Spark Referral Hub V1

Registro vivo das decisões de produto que afetam código. Cada entrada
deve ser preenchida com **resposta · data · responsável** antes de o
trabalho da Etapa correspondente começar. Revisar a cada 90 dias.

## Resumo final (state-of-the-world)

| ID | Decisão | Implementado |
|----|---------|--------------|
| D1 | Janela 30d começa em `first_payment_at` (b) | ✅ `api/cron/qualify.js` |
| D2 | Refund retroativo desqualifica imediato (a) | ✅ `api/webhooks/stripe.js` |
| D5 | Indicado ganha `$50 amount_off / once / usd` (a) | ✅ `lib/server/stripe-coupon.js:INDICADO_DISCOUNT_USD=50` |
| D7 | Provider de cron: Vercel Cron (a) | ✅ `vercel.json` |
| D8 | Mapeamento: `metadata.location_id` + backfill por email (a) | ✅ `lib/server/d8-resolver.js` |

| ID | Decisão | Status |
|----|---------|--------|
| D3 | Estado canônico vive em `referrals` no Supabase | ✅ implementado |
| D4 | Re-tentativa de webhook: idempotência via PK (source,event_id) | ✅ implementado |
| D6 | Detecção de fraude: manual em V1 | ✅ status='fraud' setado manualmente |
| D9 | Notificações por email: backend é stub em V1 | ⏳ provider não configurado |
| D10 | Workspace Engine acopla ao CRM por `tenant_id` sem FK | ✅ implementado |

---

## D1 — Quando começam os 30 dias da qualificação?

**Pergunta.** A janela de 30 dias antes de uma indicação virar `qualified`
começa a contar a partir de qual evento?

**Opções.**
- **(a)** criação da subaccount no GHL
- **(b)** primeiro pagamento confirmado no Stripe
- **(c)** primeiro uso do cupom no checkout

**Recomendação.** **(b)** — alinha "qualificada" com dinheiro real entrando
na operação. Se o cliente fechar e cancelar antes do primeiro pagamento, a
indicação nunca conta.

**Resposta.** _________________
**Data.** _________________
**Responsável.** _________________

---

## D2 — Refund após o tier ter subido — desqualifica retroativamente?

**Pergunta.** Cliente subiu de Intermediário para Avançado por causa da
indicação X; 2 meses depois o cliente referido pede refund. O que acontece
com o tier do indicador?

**Opções.**
- **(a)** desqualifica imediatamente, recalcula tier, remove desconto mensal extra
- **(b)** mantém tier por 7 dias (grace period); só desqualifica se o refund persistir
- **(c)** não desqualifica; trata como "histórico" e mantém o tier

**Recomendação.** **(a)** — simples, justo e consistente com a regra
escrita no documento original ("cancelamento, reembolso ou fraude removem
da contagem"). Comunicação transparente na UI mitiga atrito.

**Resposta.** _________________
**Data.** _________________
**Responsável.** _________________

---

## D3 — Onde mora o estado canônico da indicação?

**Pergunta.** Quem é a fonte da verdade sobre o status (pending / paid /
qualified / refunded / fraud / canceled) de cada indicação?

**Opções.**
- **(a)** DB próprio (Supabase / Postgres da Spark)
- **(b)** Custom Field no contact da location no GHL
- **(c)** metadata em customer/subscription do Stripe

**Recomendação.** **(a)** — único que não depende de uptime/contrato dos
outros sistemas e permite queries livres (cron, dashboards, exports).
GHL e Stripe são fontes de _evento_; nosso DB é fonte de _estado_.

**Resposta.** _________________
**Data.** _________________
**Responsável.** _________________

---

## D4 — Conflito entre GHL e Stripe — quem ganha?

**Pergunta.** Webhook do GHL diz "subscription canceled" mas no Stripe a
subscription continua `active`. Como nossa contagem reage?

**Opções.**
- **(a)** Stripe vence em pagamento; GHL vence em existência da subaccount
- **(b)** GHL sempre vence (operacional dele é a verdade do cliente)
- **(c)** marcar como `needs_review` e parar até intervenção humana

**Recomendação.** **(a)** — separação clara: Stripe é a verdade financeira
(quem está pagando), GHL é a verdade operacional (que existe). Conflito
aparente costuma ser timing diferente entre os dois.

**Resposta.** _________________
**Data.** _________________
**Responsável.** _________________

---

## D5 — Quanto o **indicado** ganha quando digita o cupom no checkout?

**Pergunta.** Promotion Code no Stripe precisa estar atrelado a um Coupon
com desconto > 0. Quando o indicado digita `SPARKLEADSOFF` no checkout,
qual desconto ele recebe?

**Opções.**
- **(a)** desconto fixo simbólico — ex.: $20 once, em todas as locations
- **(b)** mesmo benefício do nível atual do indicador (variável)
- **(c)** sem desconto pro indicado — usar campo `metadata.referral_code`
  (não usar Promotion Code do Stripe)

**Recomendação.** **(a) $20 fixo** — previsível, simples de comunicar,
suficiente como incentivo. O indicador é quem ganha de verdade, conforme
a tabela de tiers.

**Resposta.** _________________
**Data.** _________________
**Responsável.** _________________

**Bloqueia.** A criação automática de Coupon + Promotion Code na rota
OAuth callback (Etapa 1 / 3).

---

## D6 — Detecção de fraude — automática ou manual em V1?

**Pergunta.** Como bloquear/marcar indicações suspeitas (mesmo IP, email
descartável, mesmo cartão, padrão de cancelamento)?

**Opções.**
- **(a)** apenas manual — admin Spark marca via SQL/script; sem UI
- **(b)** regras automáticas leves (mesmo IP em janela de 24h →
  `needs_review`) + override manual
- **(c)** stack completo de fraud (Stripe Radar para clientes, regras
  customizadas para agência)

**Recomendação.** **(a) manual em V1**. Volume baixo justifica simplicidade.
Detecção automática vira backlog V2.

**Resposta.** _________________
**Data.** _________________
**Responsável.** _________________

---

## D7 — Provider do cron diário

**Pergunta.** Onde rodar o `/api/cron/qualify` 1x ao dia?

**Opções.**
- **(a)** Vercel Cron — no mesmo painel; hobby plan permite 1x/dia,
  Pro plan permite minute-level
- **(b)** Upstash QStash — fila/cron managed externo, fácil retry e
  deadletter
- **(c)** GitHub Actions — workflow agendado; visibilidade dentro do PR

**Recomendação.** **(a) Vercel Cron**. Mesmo deploy, mesmo log, zero
infra extra. Migrar pra (b) só se precisar de retries inteligentes.

**Resposta.** _________________
**Data.** _________________
**Responsável.** _________________

---

## D8 — Mapeamento location ↔ Stripe customer

**Pergunta.** Como descobrimos qual `customer_id` no Stripe corresponde
a cada `locationId` do GHL pra aplicar o desconto?

**Opções.**
- **(a)** `customer.metadata.location_id` no Stripe (set quando o
  customer é criado pela Spark)
- **(b)** match por email do owner da location
- **(c)** mapa manual (tabela `location_id ↔ stripe_customer_id`
  preenchida via admin)

**Recomendação.** **(a)** — à prova de bala, é a forma profissional.
Se os customers atuais ainda não têm essa metadata, precisamos de um
script de backfill 1x.

**Resposta.** _________________
**Data.** _________________
**Responsável.** _________________

---

## D10 — Como o Workspace Engine se acopla ao resto do produto?

**Pergunta.** O novo módulo Workspace (páginas, blocos, databases) precisa
saber a que sub-account pertence. Como amarrar isso ao modelo de tenant
que já existe (`installations.location_id`)?

**Opções.**
- **(a)** `workspaces.tenant_id text` sem foreign key, guardando o `locationId`
- **(b)** `workspaces.location_id` com FK para `installations(location_id)`
- **(c)** schema Postgres separado por tenant

**Recomendação.** **(a)**. O Workspace é hoje uma aba/URL separada, com
banco e ciclo de vida próprios; a integração com o CRM é a Phase 4. Sem FK,
o módulo pode ser migrado, testado e até extraído sem travar a tabela
`installations`, e uma location ainda não instalada não impede a criação de
workspace. O custo é não ter integridade referencial no banco — aceitável
porque o `tenant_id` vem sempre do JWT do SSO, nunca de entrada do usuário.
Quando a Phase 4 ligar páginas a contatos e oportunidades, as FKs entram
nas tabelas de relação, que é onde elas de fato importam.

**Resposta.** (a) — `tenant_id` sem FK.
**Data.** 2026-08-31.
**Responsável.** Implementado em `db/migrations/0002_workspace_engine.sql`.

---

## Itens próximos a serem registrados (V1.5/V2)

- Política de retry e dead-letter para webhooks
- Política de retenção de eventos em `ghl_events` / `stripe_events`
- SLA do cron (atraso aceitável)
- Versionamento da tabela de tiers
- Estratégia de comunicação ao usuário em caso de desqualificação

---

> Convenção do documento: cada decisão tem ID estável (D1, D2, …).
> Mudanças posteriores criam D1.v2 etc. Preserva-se o histórico.
