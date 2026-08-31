# Runbook — Spark Workspace

Projeto **separado** do Spark Referral Hub: deploy, domínio, variáveis de
ambiente e tabelas próprias. Vive em `workspace/` no repositório
`pedropoleza/test-repo`, com Root Directory apontando para essa pasta.

O único elo com o Hub é o `JWT_SIGNING_KEY`: precisa ser **o mesmo valor**
nos dois projetos, senão o JWT emitido pelo SSO do GHL não valida aqui.

## Variáveis de ambiente

| Variável | Para quê | Obrigatória |
|---|---|---|
| `SUPABASE_URL` | projeto Supabase que guarda o workspace | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | acesso server-side (bypassa RLS) | sim |
| `JWT_SIGNING_KEY` | valida o JWT do SSO — mesmo valor do Hub | sim |
| `ADMIN_URL_SECRET` | acesso de suporte via `?k=` | opcional |

`SUPABASE_URL` pode apontar para o mesmo projeto do Hub ou para um
dedicado — o código não muda. As tabelas têm prefixo `workspace_` e não
colidem com as do Hub.

## Setup (uma vez, por ambiente)

1. **Migration.** Rodar `db/migrations/0001_workspace_engine.sql` no SQL
   Editor do Supabase. Idempotente (`create table if not exists`).

2. **Bucket de arquivos.** Storage → New bucket:
   - nome: `workspace-files`
   - público: **sim** (leitura); escrita continua só pelo service role

   Sem o bucket, upload de capa e imagem responde `502
   storage_unavailable`. O resto funciona, inclusive capa por
   URL/cor/gradiente.

## Acesso

- **Usuário final:** o SSO do GHL entrega o JWT — `/?session=<jwt>`. A
  sessão vai para `sessionStorage` e some da barra de endereço.
- **Suporte / operador:** `/?k=$ADMIN_URL_SECRET&tenantId=<locationId>`.
  Entra como `owner` daquele tenant.

Sem credencial a tela mostra "Sessão necessária" — não existe login
próprio, por desenho.

## Endpoints

```
GET    /api/bootstrap            workspace + árvore + favoritos + recentes
GET    /api/pages?id=<uuid>      página + blocos + breadcrumbs
POST   /api/pages                cria (?action= duplicate|move|archive|restore|favorite|visit)
PATCH  /api/pages?id=<uuid>      título, ícone, capa, largura, visibilidade
DELETE /api/pages?id=<uuid>      exclusão definitiva (exige papel admin)
GET    /api/blocks?pageId=<uuid> blocos da página
POST   /api/blocks               cria (?action= move|duplicate)
PATCH  /api/blocks?action=bulk   autosave do editor
DELETE /api/blocks?id=<uuid>     remove
POST   /api/files                upload (JSON: name, mimeType, dataUrl)
```

## Troubleshooting

**"Não foi possível carregar o workspace" com `db_error`.**
A migration não foi aplicada nesse ambiente. Ver Setup, item 1.

**Tela de "Sessão necessária" mesmo vindo do GHL.**
`JWT_SIGNING_KEY` diferente do Hub. Os dois projetos precisam do mesmo
valor.

**Editor preso em "Sem salvar".**
O autosave repete com backoff (1s → 30s) e não descarta o que foi
digitado. Se o erro for 401/403, a sessão do SSO expirou — recarregar com
`?session=` novo resolve. Fora isso, checar logs por `workspace.*`.

**Upload falhando com `storage_unavailable`.**
Bucket `workspace-files` ausente ou privado. Ver Setup, item 2.

**Página sumiu.**
Foi para a lixeira — arquivar leva a subárvore inteira. Sidebar → Lixeira
→ Restaurar. Arquivar nunca apaga; só `DELETE /api/pages`, restrito a
papel admin, apaga de verdade.

## Testes

```bash
npm test    # node --test: fracdex, schema de blocos, rich text, fluxos
```

Os fluxos rodam contra um fake in-memory do Supabase
(`test/helpers/fake-db.js`), sem rede e sem banco.
