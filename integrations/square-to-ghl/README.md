# Integração Square → n8n → GoHighLevel (confirmação de pagamento)

Quando um pagamento é **concluído** no Square, o n8n valida, filtra, garante
idempotência, enriquece (se necessário) e repassa um JSON limpo ao **Inbound
Webhook** do GHL, que faz o match por e-mail/telefone e aplica a tag
**"Pagamento concluído - Square"**.

```
Square (Payment Link) → webhook payment.updated → n8n (self-hosted) → Inbound Webhook GHL
```

Arquivo do workflow pronto para importar: [`n8n-workflow.json`](./n8n-workflow.json)

---

## ⚠️ AÇÃO DE SEGURANÇA IMEDIATA

No chat desta tarefa foram colados os **segredos de PRODUÇÃO** da aplicação
Square (Production Application ID e **Production Application secret**). Trate-os
como **comprometidos** e **rotacione** o *Application secret* no Square Developer
Dashboard (Credentials → regenerate). Esses valores **não** são usados por esta
integração e **não** estão neste repositório. O workflow usa apenas:

- **Square Access Token (produção)** — para enriquecimento via Square API.
- **Square Webhook Signature Key** — para validar o HMAC.

Nenhum dos dois deve ser colado em chat nem hardcoded. Eles entram como
**variáveis de ambiente / credenciais do n8n** (ver abaixo).

---

## 1) Variáveis de ambiente do n8n

Defina no host do n8n (ex.: `docker-compose.yml`, arquivo `.env`, ou systemd):

| Variável | Descrição | Exemplo |
|---|---|---|
| `SQUARE_SIGNATURE_KEY` | Signature Key da *subscription* de webhook do Square | `wbhk_xxx...` |
| `SQUARE_NOTIFICATION_URL` | URL **EXATA** registrada no Square (o HMAC depende disso) | `https://n8n.sparkleads.pro/webhook/square-payment` |
| `SQUARE_ACCESS_TOKEN` | Access Token de produção (enriquecimento via API) | `EAAA...` |
| `GHL_INBOUND_WEBHOOK_URL` | URL do trigger Inbound Webhook do workflow no GHL | `https://services.leadconnectorhq.com/hooks/qz19EgcgJfyjdVg8krSz/webhook-trigger/NW1kxy9XpPFB88pv9HdN` |

> **Notificação de erro (WhatsApp): adiada.** Conforme combinado, os envios de
> alerta foram removidos do workflow por enquanto. Quando quiser reativar, me
> diga o provedor e eu adiciono o nó + as variáveis `WHATSAPP_*`.

Exemplo (docker-compose, serviço n8n):

```yaml
environment:
  - SQUARE_SIGNATURE_KEY=${SQUARE_SIGNATURE_KEY}
  - SQUARE_NOTIFICATION_URL=https://n8n.sparkleads.pro/webhook/square-payment
  - SQUARE_ACCESS_TOKEN=${SQUARE_ACCESS_TOKEN}
  - GHL_INBOUND_WEBHOOK_URL=https://services.leadconnectorhq.com/hooks/qz19EgcgJfyjdVg8krSz/webhook-trigger/NW1kxy9XpPFB88pv9HdN
```

> Os valores sensíveis devem estar no `.env` (fora do versionamento), não no YAML.

**Alternativa mais segura para o Access Token:** em vez de `$env.SQUARE_ACCESS_TOKEN`
no header, crie uma credencial **Header Auth** no n8n
(`Authorization: Bearer <token>`) e selecione-a nos nós HTTP do Square.

### ⏳ Valores que ainda preciso de você

Como combinado, o workflow **não tem URLs/segredos hardcoded** — ele lê das
variáveis acima. Para entrar no ar você só precisa preencher:

1. `SQUARE_NOTIFICATION_URL` ← ✅ **fornecido**: `https://n8n.sparkleads.pro/webhook/square-payment`
2. `GHL_INBOUND_WEBHOOK_URL` ← ✅ **fornecido** (já registrado acima)

> **Notificação de WhatsApp:** adiada a pedido. Quando quiser reativar, informe o
> provedor (Meta WhatsApp Cloud API, Twilio, Evolution API, ou outro endpoint
> HTTP) e eu readiciono o nó de alerta + variáveis `WHATSAPP_*`.

---

## 2) Idempotência — delegada ao GHL (sem banco externo)

**Não há store externa de idempotência.** O n8n não usa mais Supabase/Postgres.
A deduplicação fica a cargo do próprio GHL, porque para este caso de uso ela é
natural:

- **Contato:** a action **Create/Update Contact** do GHL faz **upsert por
  e-mail/telefone** → não cria contato duplicado se já existir.
- **Tag:** **Add Tag** é idempotente → reaplicar uma tag que já existe é no-op.

Logo, se o Square reenviar o mesmo `payment.updated`, o estado final no GHL é o
mesmo (contato atualizado + tag presente).

> ⚠️ **Atenção a efeitos colaterais não-idempotentes no workflow do GHL.** Se você
> adicionar ações que **não** são naturais a reprocessar (ex.: *enviar e-mail/SMS
> de confirmação*, *mover oportunidade de estágio*, *incrementar contador*,
> *disparar Slack*), um reenvio do Square faria essas ações **duas vezes**. Se
> esse for o caso, reative uma trava de idempotência (posso readicionar o nó de
> store por `event_id`/`payment_id` quando quiser).

---

## 3) Importar o workflow no n8n

1. n8n → **Workflows** → menu **⋮** → **Import from File** → selecione `n8n-workflow.json` (ou cole o JSON com Ctrl+V no editor).
2. (Opcional) Troque os `$env` do Access Token por uma credencial **Header Auth**.
3. Confira as variáveis de ambiente (seção 1) e **reinicie** o n8n para carregá-las.
4. **Ative** o workflow (toggle no topo).

> Não há mais nó de banco/idempotência para configurar — a deduplicação é feita no GHL (seção 2).

---

## 4) Passo a passo MANUAL (cliques que VOCÊ executa)

### A. Square Developer Dashboard
1. Acesse o **Developer Dashboard** → sua aplicação (PRODUÇÃO).
2. **Webhooks → Subscriptions → Add endpoint**:
   - **Notification URL** = `https://n8n.sparkleads.pro/webhook/square-payment`
     (deve ser **idêntica** a `SQUARE_NOTIFICATION_URL`).
   - **API version** = recente (ex.: `2025-01-23`).
   - **Events** = marque **apenas** `payment.updated`.
3. Salve e **copie a Signature Key** → coloque em `SQUARE_SIGNATURE_KEY`.
4. (Recomendado) Use **"Send test event"** depois de tudo configurado.

### B. GoHighLevel (Location `qz19EgcgJfyjdVg8krSz`)
1. **Automation → Workflows → Create Workflow** (em branco).
2. **Add Trigger → Inbound Webhook** → **copie a URL** → coloque em `GHL_INBOUND_WEBHOOK_URL`.
   - Dica: clique em **"Test"/"Capture"** e dispare um evento do n8n para o GHL
     aprender o schema (os campos do JSon limpo aparecem para mapear).
3. **Contato + tag (upsert):** logo após o trigger, adicione a ação
   **Create/Update Contact** mapeando **`email`** (chave de match) e **`phone`**
   (fallback) a partir do payload. Essa ação faz **upsert**: se o contato já
   existe, atualiza; se não existe, cria — sem duplicar.
   - Em seguida, **Add Tag** = `Pagamento concluído - Square`.
     - (Opcional) **Remove Tag** de pendência (ex.: `Pagamento pendente`).
     - (Opcional) **Update Opportunity** → estágio "Pago".
   > Como Create/Update Contact é upsert e Add Tag é idempotente, não é preciso
   > tratar "match não encontrado" separadamente nem usar store de idempotência.
4. Referencie os campos recebidos no GHL como `{{inboundWebhookRequest.email}}`,
   `{{inboundWebhookRequest.phone}}`, `{{inboundWebhookRequest.payment_id}}`, etc.
   (o nome exato do token aparece após o "Capture").
5. **Publique** o workflow.

---

## 5) Schema do JSON limpo enviado ao GHL

```json
{
  "event": "square_payment_completed",
  "payment_status": "COMPLETED",
  "payment_provider": "Square",
  "payment_id": "...",
  "order_id": "...",
  "amount": "199.00",
  "currency": "USD",
  "receipt_url": "...",
  "email": "...",
  "phone": "...",
  "paid_at": "...",
  "last_square_event_id": "..."
}
```

> `amount_money.amount` vem em **centavos** no Square; o workflow divide por 100
> antes de enviar (`amount`).

---

## 6) Segurança aplicada

- ✅ Access Token e Signature Key como **variáveis de ambiente / credenciais** do n8n (nunca hardcoded).
- ✅ Validação HMAC-SHA256 com **comparação em tempo constante** (`crypto.timingSafeEqual`).
- ✅ HMAC sobre o **raw body** (não o JSON parseado) + `notification_url` exata.
- ✅ **HTTPS obrigatório** (Square e GHL exigem; o domínio do n8n deve ter TLS).
- ✅ **Não logamos** o body completo com PII; as notificações usam apenas metadados.
- ✅ **Idempotência** delegada ao GHL (upsert de contato + Add Tag idempotente).
- ✅ **Resposta 2xx imediata** ao Square (nó "Responder 200") antes do processamento.

---

## 7) Plano de teste em produção (com cautela)

1. **Pagamento real de valor mínimo** pelo Payment Link (`https://square.link/u/27jVIA45`).
2. No n8n, confira a execução: webhook recebido e **assinatura válida** (IF segue pelo `true`).
3. No GHL, confirme a tag **"Pagamento concluído - Square"** no contato correto (match por e-mail).
4. **Reenvie o mesmo evento** pelo Square Dashboard (Webhooks → evento → Resend).
   - Esperado: o GHL faz upsert do mesmo contato e a tag continua única →
     **sem duplicar** contato nem tag.
5. **E-mail inexistente no GHL:** simule um pagamento cujo e-mail não esteja no GHL.
   Esperado: a action **Create/Update Contact** **cria** o contato e aplica a tag.
6. _(Notificação de erro adiada — sem etapa de WhatsApp por enquanto.)_

---

## Resumo do fluxo do workflow

```
Webhook (POST /square-payment, Raw Body ON)
  → Responder 200 (imediato)
  → Validar assinatura HMAC
  → IF assinatura válida?  ── false ─→ (para)   [TODO: notificação de erro]
       │ true
  → IF type == payment.updated
  → IF status == COMPLETED
  → IF amount > 0
  → Normalizar payload
  → IF e-mail presente? ── false ─→ GET payment → GET customer → Consolidar contato ─┐
       │ true                                                                          │
  → Montar JSON limpo  ←───────────────────────────────────────────────────────────┘
  → POST → Inbound Webhook GHL   (GHL: Create/Update Contact [upsert] → Add Tag)
```
