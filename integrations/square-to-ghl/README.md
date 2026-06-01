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
| `SQUARE_NOTIFICATION_URL` | URL **EXATA** registrada no Square (o HMAC depende disso) | `https://n8n.SEUDOMINIO.com/webhook/square-payment` |
| `SQUARE_ACCESS_TOKEN` | Access Token de produção (enriquecimento via API) | `EAAA...` |
| `GHL_INBOUND_WEBHOOK_URL` | URL do trigger Inbound Webhook do workflow no GHL | `https://services.leadconnectorhq.com/hooks/qz19EgcgJfyjdVg8krSz/webhook-trigger/NW1kxy9XpPFB88pv9HdN` |

> **Notificação de erro (WhatsApp): adiada.** Conforme combinado, os envios de
> alerta foram removidos do workflow por enquanto. Quando quiser reativar, me
> diga o provedor e eu adiciono o nó + as variáveis `WHATSAPP_*`.

Exemplo (docker-compose, serviço n8n):

```yaml
environment:
  - SQUARE_SIGNATURE_KEY=${SQUARE_SIGNATURE_KEY}
  - SQUARE_NOTIFICATION_URL=https://n8n.SEUDOMINIO.com/webhook/square-payment
  - SQUARE_ACCESS_TOKEN=${SQUARE_ACCESS_TOKEN}
  - GHL_INBOUND_WEBHOOK_URL=https://services.leadconnectorhq.com/hooks/qz19EgcgJfyjdVg8krSz/webhook-trigger/NW1kxy9XpPFB88pv9HdN
```

> Os valores sensíveis devem estar no `.env` (fora do versionamento), não no YAML.

**Alternativa mais segura para o Access Token:** em vez de `$env.SQUARE_ACCESS_TOKEN`
no header, crie uma credencial **Header Auth** no n8n
(`Authorization: Bearer <token>`) e selecione-a nos nós HTTP do Square. Idem para
o WhatsApp e o Postgres (já usa credencial).

### ⏳ Valores que ainda preciso de você

Como combinado, o workflow **não tem URLs/segredos hardcoded** — ele lê das
variáveis acima. Para entrar no ar você só precisa preencher:

1. `SQUARE_NOTIFICATION_URL` ← seu **URL_PUBLICA_N8N** + `/webhook/square-payment` _(pendente)_
2. `GHL_INBOUND_WEBHOOK_URL` ← ✅ **fornecido** (já registrado acima)

> **Notificação de WhatsApp:** adiada a pedido. Quando quiser reativar, informe o
> provedor (Meta WhatsApp Cloud API, Twilio, Evolution API, ou outro endpoint
> HTTP) e eu readiciono o nó de alerta + variáveis `WHATSAPP_*`.

---

## 2) Tabela de idempotência (Supabase Postgres — JÁ CRIADA)

A idempotência é **persistente** (sobrevive a restart) usando uma tabela com
**PK em `event_id`**. As tabelas já foram criadas no projeto Supabase
**`spark-referral-hub`** (`mumdhdiliejulkblwhuw`), em um **schema isolado
`square_ghl`** (não exposto via API, RLS ligado), sem interferir no schema `public`:

- `square_ghl.processed_events` — idempotência (PK `event_id`).
- `square_ghl.payment_forward_log` — auditoria opcional, **sem PII**.

DDL aplicada (referência):

```sql
create schema if not exists square_ghl;

create table if not exists square_ghl.processed_events (
  event_id     text primary key,           -- PK garante a idempotência
  payment_id   text,
  processed_at timestamptz not null default now()
);
alter table square_ghl.processed_events enable row level security;
```

No nó **"Idempotência (INSERT ON CONFLICT)"**, crie/selecione uma credencial
**Postgres do n8n apontando para o Supabase** (host do projeto, porta `5432`
direta ou `6543` pooler, database `postgres`, user/senha do banco) e substitua
`REPLACE_WITH_POSTGRES_CREDENTIAL_ID`. O nó já insere em
`square_ghl.processed_events`. Funcionamento:

- Evento novo → `INSERT ... RETURNING` devolve 1 linha → fluxo segue.
- Reenvio/duplicado → `ON CONFLICT DO NOTHING` → 0 linhas → o nó não emite itens
  e o fluxo **para naturalmente** (a tag não é reaplicada).

---

## 3) Importar o workflow no n8n

1. n8n → **Workflows** → menu **⋮** → **Import from File** → selecione `n8n-workflow.json`.
2. Abra o nó **"Idempotência (INSERT ON CONFLICT)"** e selecione a credencial Postgres.
3. (Opcional) Troque os `$env` do Access Token por uma credencial **Header Auth**.
4. Confira as variáveis de ambiente (seção 1) e **reinicie** o n8n para carregá-las.
5. Em **Settings** do workflow, defina este mesmo workflow (ou um dedicado) como
   **Error Workflow** se quiser que o `Error Trigger` capture erros de outros fluxos
   também — para erros deste fluxo, o `Error Trigger` interno já funciona.
6. **Ative** o workflow (toggle no topo).

---

## 4) Passo a passo MANUAL (cliques que VOCÊ executa)

### A. Square Developer Dashboard
1. Acesse o **Developer Dashboard** → sua aplicação (PRODUÇÃO).
2. **Webhooks → Subscriptions → Add endpoint**:
   - **Notification URL** = `https://SEUDOMINIO/webhook/square-payment`
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
3. **Match do contato:** adicione uma ação de busca/condição usando o campo
   **`email`** do payload como chave (e **`phone`** como fallback). No GHL, o
   trigger Inbound Webhook + "If/Else" permite ramificar:
   - **Contato encontrado** → **Add Tag** = `Pagamento concluído - Square`.
     - (Opcional) **Remove Tag** de pendência (ex.: `Pagamento pendente`).
     - (Opcional) **Update Opportunity** → estágio "Pago".
   - **Contato NÃO encontrado** → **(política escolhida: apenas notificar)** →
     enviar notificação interna ao time para revisão manual. **Não** criar contato.
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
- ✅ **Idempotência persistente** por `event_id` (UNIQUE no Postgres).
- ✅ **Resposta 2xx imediata** ao Square (nó "Responder 200") antes do processamento.

---

## 7) Plano de teste em produção (com cautela)

1. **Pagamento real de valor mínimo** pelo Payment Link (`https://square.link/u/27jVIA45`).
2. No n8n, confira a execução: webhook recebido e **assinatura válida** (IF segue pelo `true`).
3. No GHL, confirme a tag **"Pagamento concluído - Square"** no contato correto (match por e-mail).
4. **Reenvie o mesmo evento** pelo Square Dashboard (Webhooks → evento → Resend).
   - Esperado: idempotência detecta `event_id` repetido → **não duplica** a tag.
5. **E-mail inexistente no GHL:** simule um pagamento/contato cujo e-mail não esteja
   no GHL. Esperado (política escolhida): **apenas notifica para revisão manual**,
   sem criar contato novo.
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
  → Idempotência (INSERT ON CONFLICT)   (duplicado ⇒ para)
  → Normalizar payload
  → IF e-mail presente? ── false ─→ GET payment → GET customer → Consolidar contato ─┐
       │ true                                                                          │
  → Montar JSON limpo  ←───────────────────────────────────────────────────────────┘
  → POST → Inbound Webhook GHL
```
