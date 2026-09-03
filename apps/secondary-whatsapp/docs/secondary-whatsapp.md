# Secondary WhatsApp — Conversation Provider Bridge

Permite que **uma mesma operação trabalhe com dois números de WhatsApp**, mesmo
que o GoHighLevel não deixe conectar dois números WhatsApp nativamente na mesma
subaccount.

A solução usa uma **segunda subaccount como WhatsApp Gateway** (Ghost), enquanto
toda a operação continua na subaccount principal (Main).

```
                      ┌───────────────────────────┐
                      │      MAIN SUBACCOUNT       │  ← OPERATIONAL LAYER
                      │ CRM / Contacts / Pipeline  │
                      │       Conversations        │
                      └────────────┬──────────────┘
                        Spark WhatsApp Provider
                             outbound webhook
                                   ▼
                      ┌───────────────────────────┐
                      │      SPARK BACKEND         │  ← BRIDGE LAYER (este app)
                      │ Routing · Contact Mapping  │
                      │ Message Mapping · Dedup     │
                      │ Attachments · Status Sync   │
                      └────────────┬──────────────┘
                              GHL API
                                   ▼
                      ┌───────────────────────────┐
                      │    GHOST SUBACCOUNT       │  ← TRANSPORT LAYER
                      │    WhatsApp Number #2     │
                      └────────────┬──────────────┘
                               WhatsApp → CUSTOMER
```

**Regra fundamental:** a Ghost é _transport layer_, a Main é _operational
layer_, este app é a _bridge layer_. **Nunca duplicar a operação entre as duas
contas.** Pro atendente, a Ghost é invisível.

---

## Estrutura de arquivos

```
api/whatsapp/
  ghost-inbound.js       POST  webhook InboundMessage (Ghost → Main)     §3–5
  provider-outbound.js   POST  Delivery URL do provider (Main → Ghost)   §6–7
  status.js              POST  status sync (Ghost → provider da Main)     §12
  settings.js            GET/PUT  config da instalação (tela Settings)    §13–14
  logs.js                GET   Message Logs                               §15
  test-connection.js     POST  botão "Test Connection"                    §14
  health.js              GET   prontidão de config

lib/whatsapp/
  phone.js               normalização E.164 (chave de matching)          §3D
  signature.js           validação Ed25519 do X-GHL-Signature (raw body) §16
  provider.js            resolve provider_installations + tokens          §13
  ghl-conversations.js   cliente GHL: resolveContact / inbound / outbound / status
  payload.js             extração tolerante dos campos do webhook
  bridge.js              contact mapping + message bridge + dedupe + loop guard §4,8,9,10
  logs.js                gravação dos Message Logs                        §15
  inbound.js             orquestração do fluxo inbound
  outbound.js            orquestração do fluxo outbound
  status.js              orquestração do status sync

db/migrations/0002_secondary_whatsapp.sql
  provider_installations, contact_channel_mapping, message_bridge, whatsapp_message_logs

whatsapp-settings.html   tela "Secondary WhatsApp" (§14)
whatsapp-logs.html       tela "Message Logs" (§15)
```

---

## Custom Conversation Provider (§2)

No Marketplace App, criar um Conversation Provider **adicional** (não substitui o
SMS existente):

| Campo | Valor |
| --- | --- |
| Provider Name | `Spark WhatsApp` |
| Type | `SMS` |
| Is this a Custom Conversation Provider | ✅ |
| Conversations Tab | `Always show this Conversation Provider` |
| Alias | `WhatsApp 2` (configurável por cliente) |
| Delivery URL | `https://SEU_DOMINIO/webhooks/ghl/provider/outbound` |

Tecnicamente é um Custom SMS Provider, mas representa o segundo WhatsApp na UX.
O atendente vê: `WhatsApp · Instagram · Facebook · SMS · Spark WhatsApp`.

---

## Fluxos

### Inbound — cliente → WhatsApp #2 → Main (§3–5)

1. Cliente manda mensagem pro WhatsApp #2 → entra na **Ghost account**.
2. Webhook `InboundMessage` → `POST /webhooks/ghl/ghost/inbound`.
3. **Assinatura Ed25519 validada sobre o body cru** (§16). Inválida → 401.
4. **Dedupe (§9):** `source_message_id = ghostMessageId` (UNIQUE). Já existe → ignora.
5. **Loop guard (§10):** se `ghostMessageId` já está no `message_bridge` (foi
   originado por nós), ignora — não vira loop.
6. Resolve o **mesmo cliente na Main** por `phone_normalized` (E.164). Se não
   existe, cria contato. Grava `contact_channel_mapping` (§4).
7. `POST /conversations/messages/inbound` na Main com `conversationProviderId` →
   a mensagem aparece no Conversations da Main **associada ao nosso provider**,
   nunca ao WhatsApp principal.

### Outbound — atendente na Main responde por "WhatsApp 2" (§6–7)

1. Atendente seleciona **WhatsApp 2** e envia. O GHL **não envia sozinho** —
   chama nossa Delivery URL: `POST /webhooks/ghl/provider/outbound`.
2. Assinatura validada (§16).
3. **Dedupe (§9):** `source_message_id = main messageId`.
4. **Registro ANTES da chamada externa (§10):** cria `message_bridge` com
   `origin = spark_bridge`.
5. Resolve o contato correspondente na **Ghost** (mapping → `ghost_contact_id`;
   senão cria).
6. `POST /conversations/messages` na Ghost com `type = WhatsApp`,
   `contactId = ghostContactId` → sai pelo WhatsApp real.
7. Guarda `ghost_message_id` no bridge — é o que o loop guard procura no eco.

### Status sync (§12)

`POST /webhooks/ghl/ghost/status` → acha o bridge por `ghost_message_id`,
mapeia `pending|sent|delivered|read|failed` e reflete no provider da Main.

> ⚠️ A API de status do provider exige o **token do próprio Marketplace App**
> (`GHL_APP_ACCESS_TOKEN`), não o token da location.

---

## Deduplicação & loop prevention

- `message_bridge.source_message_id` tem **UNIQUE constraint**. `claimSourceMessage()`
  faz um insert que serve de trava atômica: dois webhooks concorrentes com o
  mesmo id nunca são processados os dois.
- Toda mensagem enviada pela bridge é registrada com `origin = spark_bridge`
  **antes** da chamada externa. Quando o eco volta, `isBridgeOriginatedGhostMessage()`
  reconhece o `ghost_message_id` e descarta — quebra o loop
  `Ghost → Main → webhook → Ghost → …`.

---

## Attachments (§11)

`image · video · audio · document` são propagados como URLs nos dois sentidos
(`attachments[]` no inbound inject e no outbound send). Não tratamos só texto.

---

## Multi-tenant (§13)

Nada de `ghostLocationId` ou `providerId` hardcoded. Tudo vive em
`provider_installations`, resolvido em runtime por Main location, Ghost location
ou `conversationProviderId`. Cada cliente: `Main A ↔ Ghost A`, `Main B ↔ Ghost B`,
isoladamente.

---

## Variáveis de ambiente

| Env | Uso |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | banco (reusa lib/server/db.js) |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM dos tokens em repouso (base64 de 32 bytes) |
| `GHL_WEBHOOK_PUBLIC_KEY` | public key Ed25519 do GHL (PEM ou base64 DER) — §16 |
| `GHL_APP_ACCESS_TOKEN` | token do Marketplace App (status sync §12; fallback de tokens) |
| `GHL_API_BASE` | default `https://services.leadconnectorhq.com` |
| `GHL_API_VERSION` | default `2021-04-15` |
| `WA_DEFAULT_COUNTRY_CODE` | DDI default p/ E.164 quando o número vem sem `+` (default `1`) |
| `CRON_SECRET` | protege as rotas admin (settings, logs, test-connection) via `x-cron-secret` |
| `WA_SKIP_WEBHOOK_VERIFY` | `1` só em dev/sandbox — **nunca** em produção |

---

## Setup

1. **Migração:** aplicar `db/migrations/0002_secondary_whatsapp.sql` no projeto
   Supabase (via `mcp Supabase apply_migration` ou SQL editor).
2. **Provider:** criar o Custom Conversation Provider no Marketplace App com a
   Delivery URL acima; anotar o `conversationProviderId`.
3. **Instalação:** abrir `whatsapp-settings.html?main_location_id=<MAIN>` e
   preencher tenant, Main/Ghost location ids, provider id e (opcional) tokens.
4. **Webhooks na Ghost:** apontar `InboundMessage` e o status para
   `/webhooks/ghl/ghost/inbound` e `/webhooks/ghl/ghost/status`.
5. **Test Connection** confirma que Main e Ghost estão acessíveis.
6. **Logs:** `whatsapp-logs.html` mostra cada trânsito em tempo real.

---

## Notas de implementação

Os contratos exatos de campo da GHL Conversations API podem variar por versão;
os payloads em `lib/whatsapp/ghl-conversations.js` seguem a spec e ficam
centralizados para ajuste único contra o sandbox (base URL e Version são
configuráveis por env). A `parseGhostInbound`/`parseProviderOutbound` em
`payload.js` já leem múltiplos aliases de campo para tolerar variações de shape.
