# Cofre de Documentos (Document Vault)

Nota de estrutura — viva. Espelha automaticamente todo documento salvo na nuvem
do contato no GHL ("Add to documents") para storage próprio da Spark, organizado
por **contato + serviço + tipo**, com checklist de pendências e portal bilíngue.

Resolve a dor da Samantha (arquivos espalhados) e vira produto vendável pro nicho
de imigração. Mesma pegada do Referral Hub — reaproveita o design system e boa
parte da base server-side.

## O que já existe pra reaproveitar (deste repo)

| Peça | Onde | Uso no Cofre |
|------|------|--------------|
| Tokens visuais (cores/fontes/raios) | `src/styles/tokens.css` | Cara do Cofre (`vault.html`) |
| Componentes (appbar, tabs, card, tbl, badge, empty-state, toast, filtros, toggle) | `src/styles/components.css` | Layout e terminologia |
| Tokens GHL por location | tabela `installations` (0001) | Harvester autentica por location |
| Resolver de token (OAuth refresh / PIT) | `lib/server/ghl-token.js` → `getLocationAccessToken()` | Chamadas à API do GHL |
| Cripto em repouso AES-256-GCM | `lib/server/crypto.js` → `encrypt/decrypt` | `ghl_url_enc`, storage keys |
| Auditoria | `lib/server/audit.js` → `audit()` / tabela `audit_log` | Log de acesso/download |
| Cron protegido | `api/cron/*` (`x-vercel-cron` / `CRON_SECRET`) | Poll incremental |
| Supabase service client | `lib/server/db.js` → `db()` | Toda persistência |

## Fontes de captura (todas confirmadas na API)

| Fonte | Endpoint | Ligado ao contato? |
|-------|----------|--------------------|
| Nuvem de mídia (o "Add to documents") | `GET /medias/files` (sortável por `createdAt`) | **a confirmar — ver D1** |
| Anexo de conversa (WhatsApp) | `GET /conversations/{id}/messages` | Sim (via `conversationId → contactId`) |
| Campo `FILE_UPLOAD` (formulário) | `GET /contacts/{id}` (valor = URL) | Sim (nativo) |

A conversa é o **fallback garantido** de dono do documento; a media library é o
gatilho do "Add to documents".

## Fluxo de sincronização (poll incremental)

O GHL não tem webhook de "documento adicionado", então o coração é polling:

1. Cron dispara (`/api/cron/vault-harvest`) a cada 1–5 min (ver D3).
2. Para cada location ativa: lê `vault_sync_state.last_cursor` por fonte.
3. Busca só o que veio depois (`createdAt > last_cursor`).
4. Resolve o dono (contato) — nativo, ou fallback por conversa.
5. Infere serviço + tipo (ver D6), baixa, criptografa e sobe no bucket seguro.
6. Grava `vault_documents` (idempotente por `location_id, source, source_ref`),
   avança o cursor, atualiza o motor de pendências.

Se um dia aparecer webhook de mídia, sobe pra instantâneo sem mudar o resto.

## Taxonomia (o "doc_checklist_template")

Semeada em `db/migrations/0002_document_vault.sql` (`vault_services` +
`vault_doc_types`), global e sobrescrevível por location:

- **Passaporte:** passaporte antigo, foto, comprovante, protocolo
- **Empresa:** ID, comprovante de endereço, 4 registros (NJ / IRS / Taxation / Corecore)
- **Registration:** título do veículo, ID, seguro
- **Seguro de vida:** ID, aplicação, ilustração, beneficiários
- **Tradução:** documento origem, documento traduzido
- **Jurídico:** boletim/ocorrência, documentos do caso

É isto que alimenta o "o que falta" (aba **Pendências**).

## Segurança (crítico — documentos de imigrante)

Não é opcional: passaportes, SSN/ITIN, IDs, docs federais.

- Criptografia em repouso no nosso storage + **URLs assinadas de curta duração**.
- Controle de acesso por departamento espelhando as permissões do GHL
  (`vault_access_grants`) — a Nicole não vê doc de empresa da Ana.
- **Audit log de todo acesso/download** (reusa `audit()` → `audit_log`).
- Retenção e expurgo definidos (LGPD/privacidade) — ver D5.
- **Nunca logar URL de documento em claro** — só `ghl_url_enc` (AES-256-GCM).

## API (nós) vs App (Spark)

- 🤖 **API:** harvester (poll + download + metadados), resolução de contato,
  inferência de tipo, motor de checklist, captura de anexos de WhatsApp.
- 🏗️ **App Spark:** storage seguro, interface do Cofre (`vault.html`), portal
  bilíngue (cliente vê/baixa/envia) e painel de pendências.

## Modelo de dados

**Separação real:** schema dedicado `document_vault` no projeto Supabase
**Sparkleads OS** (`nsqwgjbgcdqyzozyaltz`), isolado do Referral e dos demais apps.
Migration `db/migrations/0002_document_vault.sql` (self-contained) — já aplicada.

- `document_vault.installations` — tokens OAuth do app do Cofre (próprios)
- `document_vault.services` — catálogo de serviços (seed global + override por location)
- `document_vault.doc_types` — tipos esperados por serviço (o checklist template)
- `document_vault.documents` — um registro por documento espelhado (idempotente)
- `document_vault.sync_state` — cursor do poll incremental por location + fonte
- `document_vault.access_grants` — acesso por departamento (espelha GHL)
- `document_vault.webhook_events` — idempotência dos webhooks do app
- `document_vault.audit_log` — auditoria própria de acesso/download

## Mapa de endpoints (a construir)

| Endpoint | Método | Função |
|----------|--------|--------|
| `/api/cron/vault-harvest` | GET | Poll incremental das 3 fontes → espelha |
| `/api/vault/documents` | GET | Lista por contato / serviço / tipo (filtros da UI) |
| `/api/vault/documents/[id]/link` | POST | Gera URL assinada curta + grava audit |
| `/api/vault/checklist` | GET | "O que falta" por contato/serviço |
| `/api/webhooks/ghl-media` | POST | (se existir) sobe o poll para instantâneo |
| `/api/vault/upload` | POST | Portal: cliente envia documento (V2) |

## App GHL — configuração (Marketplace)

O Cofre é um **app GHL separado** do Referral Hub (Client ID próprio), com
endpoints, banco (schema `document_vault`) e chave de cripto próprios.

**URLs pra colar no app** (domínio de produção `test-repo-ebon-nine.vercel.app`):

| Campo no app | Valor |
|--------------|-------|
| Redirect URL (OAuth) | `https://test-repo-ebon-nine.vercel.app/api/oauth/vault/callback` |
| Webhook URL | `https://test-repo-ebon-nine.vercel.app/api/webhooks/ghl-vault` |

**Scopes mínimos** (leitura):

| Scope | Fonte / uso |
|-------|-------------|
| `files.readonly` | Media Library — o "Add to documents" (gatilho principal) |
| `conversations.readonly` | Achar a conversa do contato (fallback de dono) |
| `conversations/message.readonly` | Anexos de WhatsApp |
| `contacts.readonly` | Resolver contato + campo `FILE_UPLOAD` do formulário |
| `locations.readonly` | Nome/dados da location na instalação |

**Env vars na Vercel** (segredos NUNCA vão pro repo):

| Env var | O que é |
|---------|---------|
| `VAULT_GHL_CLIENT_ID` | Client ID do app do Cofre |
| `VAULT_GHL_CLIENT_SECRET` | Client Secret do app do Cofre |
| `VAULT_GHL_SHARED_SECRET` | Shared Secret Key (descriptografa o contexto SSO do iframe) |
| `VAULT_GHL_WEBHOOK_PUBLIC_KEY` | (opcional) PEM público do GHL p/ validar assinatura do webhook |
| `VAULT_SUPABASE_URL` | `https://nsqwgjbgcdqyzozyaltz.supabase.co` (Sparkleads OS) |
| `VAULT_SUPABASE_SERVICE_ROLE_KEY` | service role key do Sparkleads OS (copiar do dashboard) |
| `VAULT_TOKEN_ENCRYPTION_KEY` | chave AES-256 PRÓPRIA do Cofre (base64 de 32 bytes) |
| `PUBLIC_BASE_URL` | `https://test-repo-ebon-nine.vercel.app` (já existe) |
| `JWT_SIGNING_KEY` | chave do JWT de sessão (já existe no Hub) |

Gerar a chave própria:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

**Passo no Supabase:** expor o schema em Sparkleads OS → Settings → API →
**Exposed schemas** → adicionar `document_vault` (senão o PostgREST recusa as queries).

O Client Secret e a Shared Key foram expostos em chat durante o setup — **rotacionar
no Marketplace** após configurar.

## Fases de build

- **PoC (só API):** poll da media de 1 conta → espelha num bucket → mostra os
  registros. Prova o sync. Bloqueada por D1 (validação do contactId).
- **V1:** resolução de contato automática + taxonomia + checklist + acesso por
  departamento + Cofre interno (`vault.html`).
- **V2:** portal bilíngue (upload/download pelo cliente) + OCR/auto-classificação
  + e-sign.

## Decisões pendentes (bloqueiam código)

Cada uma precisa de **resposta · data · responsável** antes da Etapa correspondente.

| ID | Pergunta | Por que importa |
|----|----------|-----------------|
| D1 | O objeto de media do "Add to documents" carrega `contactId`? | Decide **poll puro** vs. **complementar com conversa**. Precisa rodar numa conta com docs reais. Bloqueia a PoC. |
| D2 | Provider de storage seguro + esquema de cripto em repouso (Supabase Storage / S3 / Vercel Blob)? | Define onde e como o documento é guardado e a assinatura das URLs. |
| D3 | Intervalo do poll (1–5 min) e orçamento de rate limit da API GHL? | Afeta o cron e o custo. |
| D4 | Fonte da verdade das permissões por departamento (roles do GHL? mapa manual?) | Define como popular `vault_access_grants`. |
| D5 | Política de retenção e expurgo (LGPD) — quanto tempo, como apagar? | Compliance com dado sensível de imigrante. |
| D6 | Inferência de tipo — por nome de arquivo, por pasta, por contexto, ou atribuição manual? | Define o quão automático é o "o que falta". |
| D7 | Multi-location na V1 ou 1 conta só (como a PoC)? | Afeta escopo do harvester e do cron. |

### Sobre D1 (validação do contactId)

A validação exige rodar numa conta com documentos reais + WhatsApp ativo. Isso é
tarefa do 👤 Time (envolve credencial de conta GHL) — **não passa por aqui**.
Quando o Time rodar e responder D1, o harvester (Etapa PoC) sai do papel.
