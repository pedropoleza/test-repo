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
| `GET /` | Custom Page (Cofre) |
| `POST /api/session` | Handshake SSO do iframe → sessão + locationId |
| `GET /api/documents` | Taxonomia + documentos da location (auth pela sessão) |
| `GET /api/oauth/callback` | OAuth do app (captura token na instalação) |
| `POST /api/webhooks/ghl` | Webhook (INSTALL/UNINSTALL/mídia) |
| `GET /api/cron/harvest` | Poll incremental da Media Library (a cada 5 min) |

## Estado

- ✅ Custom Page (SSO) + UI de pastas por contato + PT/EN
- ✅ OAuth, webhook, harvester (poll da media grava `pending`)
- 🚧 Download + storage seguro dos arquivos = **D2** (definir provider)
- 🚧 Resolução de dono por conversa/WhatsApp = **D1**
