# Spark Document Vault (Cofre de Documentos)

App próprio da Spark que espelha os documentos salvos na nuvem do contato no GHL
("Add to documents") e organiza por **contato + serviço + tipo**, com checklist de
pendências. Roda como **Custom Page** dentro do GHL (iframe + SSO) e como app
standalone (modo demo fora do GHL).

Self-contained: é um **projeto Vercel separado** do Referral Hub, no mesmo repo.

## Deploy (Vercel)

Novo projeto Vercel apontando para este repositório, com:

- **Root Directory:** `vault-app`
- Framework preset: **Other** (static + Serverless Functions em `api/`)
- Deploy → gera o domínio (ex.: `spark-document-vault.vercel.app`)

O `index.html` na raiz é a **Custom Page**; as funções ficam em `api/`.

## Config do app no GHL Marketplace

Projeto Vercel: **spark-document-vault** · domínio de produção
`spark-document-vault.vercel.app` (deploy feito via API).

| Campo | Valor |
|-------|-------|
| Redirect URL (OAuth) | `https://spark-document-vault.vercel.app/api/oauth/callback` |
| Webhook URL | `https://spark-document-vault.vercel.app/api/webhooks/ghl` |
| Custom Page URL | `https://spark-document-vault.vercel.app/` |

**Scopes** (read-only): `files.readonly`, `conversations.readonly`,
`conversations/message.readonly`, `contacts.readonly`, `locations.readonly`.

## Env vars (no projeto Vercel do Cofre)

| Env var | O que é |
|---------|---------|
| `DATABASE_URL` | conexão pooler com o role `dv_app` (schema `document_vault` no Sparkleads OS) |
| `TOKEN_ENCRYPTION_KEY` | AES-256 (base64 de 32 bytes) — cripto em repouso |
| `GHL_CLIENT_ID` / `GHL_CLIENT_SECRET` | credenciais OAuth do app |
| `GHL_SHARED_SECRET` | Shared Secret Key — descriptografa o contexto SSO do iframe |
| `GHL_WEBHOOK_PUBLIC_KEY` | (opcional) PEM público do GHL p/ validar assinatura do webhook |
| `JWT_SIGNING_KEY` | assina o JWT curto da sessão (base64 de 32+ bytes) |
| `PUBLIC_BASE_URL` | `https://spark-document-vault.vercel.app` |
| `CRON_SECRET` | protege `/api/cron/harvest` fora do Vercel Cron |

Gerar chaves: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## Banco

Schema `document_vault` no projeto Supabase **Sparkleads OS**, acessado pelo role
dedicado `dv_app` (menor privilégio, só esse schema) via pooler. Migrations em
`db/migrations/` (já aplicadas). Não usa PostgREST nem service_role key.

## Endpoints

| Rota | Função |
|------|--------|
| `GET /` | Custom Page (Cofre) — grid de pastas + search + drag-drop + **Modelos** |
| `POST /api/session` | Handshake SSO do iframe → sessão + nome da subaccount |
| `GET /api/documents` | Documentos da location por contato (auth pela sessão) |
| `POST /api/upload` | Sobe um arquivo para a pasta do contato (bytea no banco) |
| `GET /api/file?id=` | Baixa/exibe um arquivo salvo (escopo por location) |
| `GET /api/contacts?q=` | Busca contatos reais do GHL (search do topo) |
| `GET /api/contact-data?id=` | Dados do contato + custom fields resolvidos p/ preencher modelos |
| `GET /api/pipelines` | Funis (setores) + funil/estágio de cada contato |
| `GET /api/oauth/callback` | OAuth do app (captura token na instalação) |
| `POST /api/webhooks/ghl` | INSTALL/UNINSTALL + **auto-captura de anexo de conversa** |
| `GET /api/cron/harvest` | Poll incremental da Media Library (a cada 5 min) |

## Estado

- ✅ Custom Page (SSO), nome da subaccount, UI de grid de pastas + search + drag-drop
- ✅ Upload manual → banco (bytea) + download com auditoria
- ✅ Segmentação por setor (pipelines) + badge de funil/estágio
- ✅ **Modelos** (aba "Modelos"): 7 contratos da Latino USA em HTML com merge
  fields (`{{contact.*}}`, `{{custom.*}}`, `{{today}}`). Seleciona modelo →
  busca contato → preenche automático → pré-visualiza → **Imprimir / Salvar PDF**
  (print do navegador, MVP). Arquivos em `templates/` + `templates/registry.json`.
- ✅ Auto-captura: webhook InboundMessage/OutboundMessage com anexo → grava na
  pasta do contato (`source='conversation'`, idempotente por messageId)
- ⏳ **Falta só validar** a auto-captura com um teste real (mensagem com anexo).
  O payload cru fica em `document_vault.webhook_events` para ajuste fino se o GHL
  usar outro nome de campo.
- 🚫 "Documents" nativo do contato (`/documents/*`) — serviço INTERNO do GHL, sem
  scope público (401 com OAuth). Não usado; cofre = storage próprio.
- 🚧 Storage de objeto + URL assinada (remove o limite de 10MB) = **D2**
