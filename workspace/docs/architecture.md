# Workspace Engine — Architecture Assessment & Plano

Documento de referência do módulo Workspace (Notion-like) e do futuro
Notion Connector. Escrito antes da implementação; atualizado a cada fase.

Estado: **Phase 0 e Phase 1 implementadas.** Fases 2–7 planejadas abaixo.

---

## A. Current Architecture Assessment

O que já existe no repositório (Spark Referral Hub):

| Camada | Tecnologia | Observação |
|---|---|---|
| Frontend | HTML estático + ES modules vanilla | `index.html`, `admin.html`, `checkout.html`; sem build step, sem framework |
| Backend | Vercel Serverless Functions (Node ≥20, ESM) | `api/**/*.js`, um `export default handler(req, res)` por rota |
| Banco | Supabase / Postgres | acesso só pelo servidor com `SERVICE_ROLE_KEY`; RLS ligada sem policies |
| Migrations | SQL versionado em `db/migrations` | `0001_init.sql` |
| Auth | SSO do GoHighLevel → JWT HS256 curto | `api/auth/ghl-context.js` emite; `lib/server/jwt.js` assina/valida |
| Auth admin | `ADMIN_URL_SECRET` (header/cookie/query), compare timing-safe | `api/admin/referrals.js` |
| Tenancy | `location_id` (sub-account do GHL) | tabela `installations` |
| Design system | tokens CSS próprios (paleta GHL) | `src/styles/tokens.css` + `components.css` |
| Storage | ainda não usado | Supabase Storage disponível no mesmo projeto |
| Observabilidade | logger JSON estruturado + `audit_log` | `lib/server/log.js`, `lib/server/audit.js` |
| Segredos | AES-256-GCM em repouso | `lib/server/crypto.js` |
| Cron | Vercel Cron | `vercel.json` |

Decisões relevantes já registradas: D3 (estado canônico no nosso banco,
sistemas externos são fonte de *evento*) e D4 (resolução de conflito entre
fontes). O Notion Connector segue exatamente essa mesma doutrina.

**Conflitos de nomenclatura identificados.** `components.css` já usa
`.card`, `.tab`, `.page`, `.panel`. Todo o CSS do módulo usa prefixo `ws-`.
No banco, todas as tabelas novas usam prefixo `workspace_`.

**O que foi reaproveitado, e não reconstruído:** autenticação (JWT do SSO),
padrão de rota serverless, cliente Supabase, logger, tokens de design,
convenção de migrations, mecanismo de admin key.

**O que foi criado do zero, por não existir equivalente:** domínio de
páginas/blocos, ordenação fracionária, editor, sidebar em árvore.

---

## B. Proposed Workspace Architecture

Nesta primeira etapa o Workspace é um **projeto Vercel separado**, com
domínio, variáveis de ambiente, banco e componentes próprios. Vive em
`workspace/` no mesmo repositório, com Root Directory apontando para essa
pasta. A comunicação com o Hub de Indicações e com as entidades do CRM é a
segunda etapa (Phase 4).

```
Browser  /  (index.html + src/**)   ← domínio próprio do Workspace
                │
                │  x-spark-session (JWT do SSO já existente)
                ▼
         /api/*                  ← rotas finas, sem regra de negócio
                │
                ▼
        lib/server/*             ← contexto, repositórios, ordenação
                │
                ▼
        Supabase / Postgres      ← workspace_* (migration 0002)
```

E, a partir da Phase 5, o Notion entra **de lado**, nunca no meio:

```
NOTION → Connector/Importer → Normalization → NOSSO BANCO → Workspace Engine → nossa UI
```

Depois de importado, o conteúdo é local: a página renderiza, edita e
funciona com o Notion offline, desconectado ou removido.

**Multi-tenancy.** `tenant_id` = `locationId` do GHL, extraído **sempre do
token**, nunca do body ou da query. Toda leitura passa por
`workspace_id`; não existe caminho que recupere página, bloco ou arquivo
só por id (§63). O teste `outro tenant não enxerga a página nem pelo id`
trava esse comportamento.

**Permissões.** Papéis `owner > admin > editor > commenter > viewer`,
derivados do papel do GHL (`type: agency` → owner, `role: admin` → admin,
demais → editor). Escrita exige `editor`; exclusão definitiva exige
`admin`. Permissão por página é Phase 7.

---

## C. Data Model

Migration `db/migrations/0001_workspace_engine.sql`:

| Tabela | Papel |
|---|---|
| `workspaces` | raiz do domínio, uma por tenant (`unique(tenant_id, slug)`) |
| `workspace_pages` | página, subpágina e (Phase 3) record de database — mesma entidade |
| `workspace_page_tabs` | abas de uma página (§14); UI na Phase 2 |
| `workspace_blocks` | conteúdo block-based, hierárquico |
| `workspace_favorites` | favoritos por usuário |
| `workspace_recent_items` | recentes com sinal próprio, não `updated_at` (§31) |
| `workspace_revisions` | histórico incremental por operação (§35) |
| `workspace_files` | arquivos em storage próprio (§53) |

Fases seguintes ganham migrations próprias: `0002` database engine,
`0003` CRM relations, `0004` integrations + object mappings.

**Ordenação — fractional indexing.** `position` é uma string base62 cuja
ordem lexicográfica é a ordem de exibição. Reordenar é um `UPDATE` de uma
linha, independente do tamanho da lista (§11). Implementação e testes:
`lib/server/workspace/fracdex.js`, `test/fracdex.test.js`.

**Híbrido relacional + JSON (§68).** Relacional para hierarquia, ordem e
tenancy; JSON para rich text, configuração e metadados de layout. Rich
text é `[{ s, m?, href?, mention? }]` — sem colunas de formatação.

**Idempotência do import (§47).** `source` + `source_external_id` com
unique index parcial em `workspace_pages` e `workspace_blocks`, desde já.
Reimportar a mesma página do Notion vai atualizar, nunca duplicar.

---

## D. Component Architecture

```
src/workspace/
├── app.js                 shell, roteamento (?p=), orquestração
├── session.js             captura e guarda o JWT do SSO
├── api.js                 único ponto de fetch do módulo
├── store.js               estado + assinantes + helpers de árvore
├── sidebar.js             árvore, favoritos, lixeira, drag & drop
├── page-header.js         breadcrumbs, capa, ícone, título
├── cover.js               capas: galeria, cor, gradiente, URL, upload
├── icon-picker.js         emoji + ícone por URL
├── shared/blocks.js       registro de tipos + normalização (browser e servidor)
├── editor/
│   ├── editor.js          controller: eventos, autosave, operações
│   ├── render.js          JSON → DOM
│   ├── richtext.js        DOM ↔ rich JSON, caret, split
│   ├── slash-menu.js      comandos "/"
│   ├── block-menu.js      ações do bloco
│   ├── formatting.js      toolbar de seleção
│   └── dnd.js             arrastar e soltar (blocos e sidebar)
└── ui/
    ├── menu.js            menu ancorado + modal com foco preso
    └── toast.js
```

Nenhum componente concentra o módulo (§82): o maior arquivo é o
controller do editor, e ele delega renderização, menus e DnD.

`shared/blocks.js` é importado pelos dois lados — mesmo padrão de
`src/config/tiers.js`, que `api/admin/referrals.js` já importa. Uma fonte
única de schema evita o editor salvar algo que a API rejeita.

---

## E. Notion Integration Architecture (Phases 5–6, ainda não implementada)

Desenhada agora para que nada da Phase 0/1 precise ser refeito:

- **Adapter (§66).** `ExternalWorkspaceProvider` com `connect`,
  `listResources`, `getPage`, `getBlocks`, `getDatabase`, `getRecords`,
  `downloadFile`, `sync`. `NotionProvider` é a primeira implementação;
  Drive/Confluence/Coda entram sem tocar no Workspace Engine.
- **Cliente único (§65).** Todo acesso à API do Notion passa por um
  client central com fila, backoff, tratamento de 429, timeout, paginação
  e log sem segredos. Nenhum `fetch` para o Notion espalhado no código.
- **Tokens (§64).** Só no backend, criptografados em repouso com o
  `lib/server/crypto.js` que já existe, nunca em resposta de API, log ou
  error tracking.
- **Mapeamento (§46).** `external_integrations` e
  `external_object_mappings`; a chave de idempotência já existe nas
  tabelas de página e bloco.
- **Blocos não suportados (§52).** Já implementado: tipo desconhecido vira
  `unsupported` preservando `originalType` e `originalPayload`. A
  importação nunca falha inteira por causa de um bloco.
- **Sync (§43).** Primeira direção: Notion → App. Two-way só depois de
  conflito, permissões e compatibilidade de bloco maduros.
- **Conflito (§57).** `external_last_edited_at`, `local_last_edited_at`,
  `last_synced_at`, `content_hash`; mudança dos dois lados nunca
  sobrescreve em silêncio.
- **Webhook (§54–55).** Sinal de mudança, não payload de verdade:
  valida assinatura, enfileira job, busca o objeto atual pela API.

**Antes de implementar a Phase 5, consultar a documentação oficial vigente
da API do Notion** (§90) — OAuth, search, pages, blocks, data sources,
paginação, uploads, rate limits, webhooks — e registrar aqui o que a UI do
Notion oferece mas a API não expõe. Nada de importação "perfeita"
inventada onde a API não fornece dados (§52, §64 do prompt de produto).

---

## F. Implementation Phases

| Fase | Escopo | Status |
|---|---|---|
| 0 | Arquitetura, schema, rotas, permissões, shell, sidebar, page model | ✅ |
| 1 | Páginas, subpáginas, ícones, capas, breadcrumbs, editor, blocos básicos, slash menu, drag & drop, autosave | ✅ |
| 2 | Favoritos avançados, recentes na UI, busca global, Cmd+K, templates, sections, tabs | ⏳ |
| 3 | Database engine: properties, records, table/board/list/gallery/calendar, filtros, sorts, groups | ⏳ |
| 4 | Relações com CRM, entity blocks, linked views, páginas contextuais | ⏳ |
| 5 | Notion: OAuth, resource browser, import, conversão, mídia, mappings | ⏳ |
| 6 | Notion: webhooks, jobs, status, conflitos, logs | ⏳ |
| 7 | Timeline, charts, dashboards, forms, fórmulas, rollups, comentários, versões, colaboração | ⏳ |

Favoritos, recentes e lixeira já funcionam ponta a ponta na Phase 1 porque
a sidebar precisa deles; o que fica para a Phase 2 é a UI dedicada
(seção de recentes, reordenar favoritos) e a busca.

---

## G. Files

Projeto autônomo em `workspace/` (Root Directory do projeto Vercel):

```
workspace/
├── package.json  vercel.json  index.html  .gitignore
├── api/{bootstrap,pages,blocks,files}.js
├── lib/server/
│   ├── db.js  jwt.js  log.js            (cópias próprias: projeto separado)
│   └── context.js  pages.js  blocks.js  revisions.js
├── db/migrations/0001_workspace_engine.sql
├── src/
│   ├── styles/{tokens,workspace}.css
│   ├── shared/{blocks,fracdex}.js       (browser + servidor)
│   ├── app.js api.js session.js store.js sidebar.js
│   ├── page-header.js cover.js icon-picker.js
│   ├── editor/{editor,render,richtext,slash-menu,block-menu,formatting,dnd}.js
│   └── ui/{menu,toast}.js
├── test/{fracdex,richtext,blocks-schema,workspace-flows}.test.js
│   └── helpers/fake-db.js
└── docs/{architecture,runbook}.md
```

`db.js`, `jwt.js` e `log.js` são cópias das do Hub, e isso é intencional:
projetos Vercel separados não enxergam a pasta pai. A duplicação é o preço
da independência de deploy — são três arquivos pequenos e estáveis.
`JWT_SIGNING_KEY` precisa ser o mesmo nos dois projetos.

**No projeto do Hub**, a única mudança é documental: um ponteiro em
`docs/runbook.md` e a decisão D10 em `docs/decisions.md`. Nenhum código,
rota, tabela ou config do Hub foi alterado.

---

## Estado de cada requisito do brief nas fases 0–1

| Requisito | Situação |
|---|---|
| §5 Sidebar em árvore, arrastar, aninhar, favoritar, arquivar | feito |
| §6 Page engine: identidade, metadados, largura, breadcrumbs | feito (tabs e side panel na Phase 2) |
| §7 Capas: galeria, cor, gradiente, URL, upload, reposicionar, remover | feito |
| §8 Ícones: emoji, busca, recentes, URL, remover | feito (biblioteca de ícones SVG na Phase 2) |
| §9 Blocos | texto, listas, checklist, toggle, quote, callout, código, divisor, imagem, vídeo, arquivo, embed, bookmark, subpágina, unsupported. Colunas/sections/tabs/database: Phases 2–3 |
| §10 Slash commands | feito, listando só o que existe |
| §11 Drag & drop com posição persistente | feito, fractional indexing |
| §12 Menu do bloco | duplicar, transformar, cor, fundo, copiar link, excluir. "Mover para" na Phase 2 |
| §13 Formatação inline | negrito, itálico, sublinhado, tachado, código, link. Mentions na Phase 2 |
| §35 Histórico | revisions gravadas; UI na Phase 7 |
| §36 Autosave | debounce, otimista, indicador, retry com backoff |
| §37 Colaboração | estrutura compatível; sem multiplayer nesta fase |
| §63 Multi-tenancy | feito e coberto por teste |
| §72 Empty states | feito |
| §73 Teclado | Enter, Tab, Shift+Tab, setas, Backspace, Ctrl+B/I/U/E/K, Ctrl+D. Cmd+K global na Phase 2 |
| §74 Mobile | sidebar drawer, gutter sempre visível, modal como bottom sheet |
| §76 Acessibilidade | HTML semântico, foco visível, ARIA, Escape fecha, foco preso em modal |
| §77 Loading | skeletons |
| §78 Erros | dizem o que houve, o que foi preservado e como resolver |
| §83 Sem mocks | nenhum dado falso: tudo persiste no Postgres |

O que **não** foi entregue nesta etapa está listado como Phase 2+ acima —
não há tela, botão ou item de menu que finja funcionar.
