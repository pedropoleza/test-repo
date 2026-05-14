# Runbook — Spark Referral Hub

Procedimentos operacionais pra debug, manutenção e onboarding.

## URLs

- Frontend (hub): https://test-repo-ebon-nine.vercel.app/
- Stripe Dashboard: https://dashboard.stripe.com (live mode)
- Supabase project: `mumdhdiliejulkblwhuw`

## Endpoints administrativos

Todos exigem `x-cron-secret: $CRON_SECRET` (timing-safe compare).
`CRON_SECRET` está em `Vercel → Project → Environment Variables`.

### Diagnóstico de uma location específica

```bash
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://test-repo-ebon-nine.vercel.app/api/diagnostics/full?locationId=<id>"
```

Retorna: installation row + últimos 5 referrals + by-status counts +
últimos 10 tier_history events + dados do customer Stripe + coupon
do indicado com `times_redeemed`. **Primeiro lugar pra olhar quando
algo dá errado pra uma location.**

### Estado geral do Stripe

```bash
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://test-repo-ebon-nine.vercel.app/api/diagnostics/stripe" | jq
```

Lista: account currency, top 50 promotion codes (active), top 50
coupons, products + prices, payment links.

### Recomputar tier manualmente

Se uma indicação foi promovida pra qualified e não disparou o
recompute (ou pra forçar reaplicação após mudança de regra):

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  "https://test-repo-ebon-nine.vercel.app/api/admin/recompute-tier?locationId=<id>"
```

### Provisionar mais locations (caso o cron diário não tenha rodado)

```bash
# Auto-detecta as faltantes (até 30 por chamada)
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  "https://test-repo-ebon-nine.vercel.app/api/cron/sync-locations?batch=30"
```

### Recriar TODOS os cupons indicado (após mudar valor do desconto)

⚠️ Operação destrutiva: arquiva 254 promotion codes + deleta 254 rows.

```bash
# 1) Cleanup
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  "https://test-repo-ebon-nine.vercel.app/api/admin/cleanup-pit-installations"

# 2) Resync (em batches de 30; loop pra cobrir 255)
for offset in 0 30 60 90 120 150 180 210 240; do
  curl -X POST -H "x-cron-secret: $CRON_SECRET" \
    "https://test-repo-ebon-nine.vercel.app/api/admin/resync-locations?limit=30&offset=$offset"
  sleep 2
done
```

### Reparar cupons faltantes (rows com coupon_code=null)

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  "https://test-repo-ebon-nine.vercel.app/api/admin/repair-missing-coupons"
```

## Crons

- `0 3 * * *` (03:00 UTC) — `/api/cron/qualify`: promove `paid → qualified` após 30 dias do first_payment_at, recomputa tier de cada indicador afetado.
- `30 4 * * *` (04:30 UTC) — `/api/cron/sync-locations`: lista todas as locations da agency, provisiona as que faltam (cupom + Promotion Code Stripe).

## Cenários de troubleshooting

### "Cliente digitou cupom no checkout e Stripe disse 'invalid'"

1. Confirma se o cupom existe e é o `code` esperado:
   ```sql
   SELECT location_id, location_name, coupon_code
   FROM installations
   WHERE coupon_code = 'XXXOFF';
   ```
2. Confirma no Stripe (diagnostics/full pela location_id) que
   `indicado_coupon.valid = true`.
3. Se valid mas Stripe rejeita: o Payment Link / Checkout precisa de
   `allow_promotion_codes: true`.
4. Currency mismatch: nosso cupom é em `usd`. Se o plano é em outra
   moeda, Stripe não aplica. Coupon mode `amount_off` é currency-bound.

### "Indicação não apareceu no hub"

1. Roda diagnostics/full pra location do indicador:
   ```bash
   curl -H "x-cron-secret: $CRON_SECRET" \
     "https://.../api/diagnostics/full?locationId=<indicador>"
   ```
2. Olha `referrals.total` e `referrals.by_status`.
3. Se 0: o webhook Stripe não criou ou não bateu. Veja:
   - Stripe Dashboard → Webhooks → /api/webhooks/stripe → últimas
     entregas. Se 4xx: falha de signature ou processamento.
   - DB: `select * from webhook_events where source='stripe' order by received_at desc limit 5;`
4. Se row existe com `coupon_used` mas indicador errado: o cupom usado
   no checkout não bateu com nenhum `installations.coupon_code`. Veja
   `webhook_events.payload.discount.coupon.id` e procure.

### "Indicador qualificou mas o desconto não foi aplicado na assinatura"

1. `diagnostics/full?locationId=<indicador>` → `stripe.customer_id` é null?
   → D8 não resolveu. Ver email da location no GHL vs email do customer
   no Stripe (precisa bater).
2. Se customer_id existe mas `stripe.subscriptions[].discount` é null:
   - Stripe pode ter rejeitado. Logs do Vercel `[tier-discount]`.
   - Rodar `recompute-tier` manual pra reaplicar.

### "Quero testar sem cobrar de verdade"

Stripe Test Mode é separado do live. Requer nova restricted key
test-mode e novo webhook secret test-mode. Adicionar como `STRIPE_*`
em **Vercel Preview env** (não touch production) e fazer deploy de
branch específica.

## Manutenção do CRON_SECRET

Rotacionar a cada 90 dias ou se houver incidente:

```bash
NEW=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
vercel env rm CRON_SECRET production --yes
vercel env add CRON_SECRET production --value "$NEW" --yes
# Repete pra development; redeploy
```

## Locations e cupons

- 255 sub-accounts em produção
- Todas têm cupom único `<NAME>OFF` (ex: `SPARKOFF`, `MOTOROOFF`)
- Cada cupom dá **$50 off / once / usd** na primeira invoice

Pra mudar o valor:
1. Edita `INDICADO_DISCOUNT_USD` em `lib/server/stripe-coupon.js`
2. Deploy
3. Roda cleanup + resync (ver "Recriar TODOS os cupons indicado")

## Decisões pendentes

Ver `docs/decisions.md`. Working assumptions:
- D1=b: clock 30d começa em first_payment_at
- D2=a: refund retroativo desqualifica
- D5=a: $50 amount_off / once pro indicado
- D7=a: Vercel Cron
- D8=a: customer.metadata.location_id + backfill por email
