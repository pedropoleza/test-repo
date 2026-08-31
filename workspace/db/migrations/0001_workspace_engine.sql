-- 0002_workspace_engine.sql
-- Workspace Engine — Phase 0 (foundation) + Phase 1 (page engine).
--
-- Domínio NOVO e independente. Convive com installations/referrals sem
-- tocá-las. O acoplamento com o CRM (locations, contatos, oportunidades)
-- é feito por `tenant_id` (= GHL locationId) SEM foreign key, para que o
-- módulo possa ser desenvolvido, migrado e testado isoladamente nesta
-- primeira fase (ver D10 em docs/decisions.md).
--
-- Fases posteriores adicionam migrations próprias:
--   0003 → database engine (databases/fields/records/views)
--   0004 → CRM relations
--   0005 → external integrations + notion mappings
--
-- Ordenação de irmãos usa FRACTIONAL INDEXING (string base62). Nunca
-- usar índice absoluto: reordenar um item não pode reescrever a lista.

create extension if not exists pgcrypto;

-- =========================================================================
-- workspaces
-- Raiz do domínio. Um workspace por tenant (slug 'default'); o slug já
-- existe para permitir múltiplos workspaces por tenant sem migration.
-- =========================================================================
create table if not exists workspaces (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null,                       -- GHL locationId
  slug         text not null default 'default',
  name         text not null default 'Workspace',
  icon_type    text check (icon_type in ('emoji', 'url')),
  icon_value   text,
  settings     jsonb not null default '{}'::jsonb,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_workspaces_tenant_slug
  on workspaces(tenant_id, slug);

-- =========================================================================
-- workspace_pages
-- Página é a unidade central: página, subpágina e (na Phase 3) o record
-- de uma database são todos a mesma entidade.
-- =========================================================================
create table if not exists workspace_pages (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  parent_page_id     uuid references workspace_pages(id) on delete cascade,
  title              text not null default '',
  icon_type          text check (icon_type in ('emoji', 'url')),
  icon_value         text,
  cover_type         text check (cover_type in ('image', 'color', 'gradient')),
  cover_value        text,
  cover_position_y   numeric not null default 50,
  cover_height       integer not null default 220,
  layout_width       text not null default 'normal'
                       check (layout_width in ('normal', 'full', 'compact')),
  visibility         text not null default 'private'
                       check (visibility in ('private', 'shared')),
  position           text not null,
  properties         jsonb not null default '{}'::jsonb,
  -- Origem: 'native' hoje; 'notion' na Phase 5. source_external_id é a
  -- chave de idempotência do import (§47) — reimportar NUNCA duplica.
  source             text not null default 'native',
  source_external_id text,
  is_archived        boolean not null default false,
  archived_at        timestamptz,
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_workspace_pages_tree
  on workspace_pages(workspace_id, parent_page_id, position)
  where is_archived = false;
create index if not exists idx_workspace_pages_parent
  on workspace_pages(parent_page_id);
create index if not exists idx_workspace_pages_updated
  on workspace_pages(workspace_id, updated_at desc);
create index if not exists idx_workspace_pages_archived
  on workspace_pages(workspace_id, archived_at desc)
  where is_archived = true;
create unique index if not exists uq_workspace_pages_external
  on workspace_pages(workspace_id, source, source_external_id)
  where source_external_id is not null;

-- =========================================================================
-- workspace_page_tabs
-- Abas de uma página (§14). Toda página tem pelo menos a aba implícita
-- (tab_id null nos blocks). Tabs explícitas chegam na Phase 2 — a tabela
-- existe desde já para o editor não precisar de migration de dados.
-- =========================================================================
create table if not exists workspace_page_tabs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  page_id      uuid not null references workspace_pages(id) on delete cascade,
  title        text not null default 'Overview',
  icon_type    text check (icon_type in ('emoji', 'url')),
  icon_value   text,
  kind         text not null default 'blocks'
                 check (kind in ('blocks', 'database_view', 'embed')),
  config       jsonb not null default '{}'::jsonb,
  position     text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_workspace_page_tabs_page
  on workspace_page_tabs(page_id, position);

-- =========================================================================
-- workspace_blocks
-- Conteúdo block-based. `content` é JSON (rich text, spans, config) —
-- não normalizamos formatação em colunas (§68). `plain_text` é o espelho
-- textual usado pela busca (Phase 2) e mantido pela API.
-- =========================================================================
create table if not exists workspace_blocks (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  page_id            uuid not null references workspace_pages(id) on delete cascade,
  tab_id             uuid references workspace_page_tabs(id) on delete cascade,
  parent_block_id    uuid references workspace_blocks(id) on delete cascade,
  type               text not null,
  content            jsonb not null default '{}'::jsonb,
  props              jsonb not null default '{}'::jsonb,
  plain_text         text not null default '',
  position           text not null,
  source             text not null default 'native',
  source_external_id text,
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_workspace_blocks_page
  on workspace_blocks(page_id, parent_block_id, position);
create index if not exists idx_workspace_blocks_workspace
  on workspace_blocks(workspace_id);
create index if not exists idx_workspace_blocks_updated
  on workspace_blocks(workspace_id, updated_at desc);
create unique index if not exists uq_workspace_blocks_external
  on workspace_blocks(workspace_id, source, source_external_id)
  where source_external_id is not null;

-- =========================================================================
-- workspace_favorites (§30)
-- =========================================================================
create table if not exists workspace_favorites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_key     text not null,                       -- userId do GHL, ou 'tenant'
  target_type  text not null default 'page'
                 check (target_type in ('page', 'database', 'view')),
  target_id    uuid not null,
  position     text not null,
  created_at   timestamptz not null default now()
);
create unique index if not exists uq_workspace_favorites
  on workspace_favorites(workspace_id, user_key, target_type, target_id);
create index if not exists idx_workspace_favorites_user
  on workspace_favorites(workspace_id, user_key, position);

-- =========================================================================
-- workspace_recent_items (§31)
-- Recentes não podem depender de updated_at — abrir não é editar.
-- =========================================================================
create table if not exists workspace_recent_items (
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  user_key       text not null,
  target_type    text not null default 'page',
  target_id      uuid not null,
  last_visited_at timestamptz not null default now(),
  visit_count    integer not null default 1,
  primary key (workspace_id, user_key, target_type, target_id)
);
create index if not exists idx_workspace_recent_user
  on workspace_recent_items(workspace_id, user_key, last_visited_at desc);

-- =========================================================================
-- workspace_revisions (§35)
-- Log incremental de operações — nunca snapshot da página inteira por
-- tecla digitada. Snapshots completos entram na Phase 7.
-- =========================================================================
create table if not exists workspace_revisions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  page_id      uuid references workspace_pages(id) on delete cascade,
  entity_type  text not null,                       -- page | block | tab
  entity_id    uuid,
  operation    text not null,                       -- create | update | move | delete | restore
  actor        text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_workspace_revisions_page
  on workspace_revisions(page_id, created_at desc);
create index if not exists idx_workspace_revisions_workspace
  on workspace_revisions(workspace_id, created_at desc);

-- =========================================================================
-- workspace_files (§53)
-- Arquivos ficam em storage próprio. `source_url` guarda a origem
-- (ex.: URL temporária do Notion) apenas para auditoria — nunca é
-- usada para servir o arquivo.
-- =========================================================================
create table if not exists workspace_files (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  storage_key        text not null,
  public_url         text,
  mime_type          text,
  byte_size          bigint,
  original_name      text,
  source             text not null default 'upload',
  source_external_id text,
  source_url         text,
  created_by         text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_workspace_files_workspace
  on workspace_files(workspace_id, created_at desc);

-- =========================================================================
-- updated_at triggers (reusa public.set_updated_at de 0001)
-- =========================================================================
drop trigger if exists trg_workspaces_updated on workspaces;
create trigger trg_workspaces_updated before update on workspaces
  for each row execute function set_updated_at();

drop trigger if exists trg_workspace_pages_updated on workspace_pages;
create trigger trg_workspace_pages_updated before update on workspace_pages
  for each row execute function set_updated_at();

drop trigger if exists trg_workspace_page_tabs_updated on workspace_page_tabs;
create trigger trg_workspace_page_tabs_updated before update on workspace_page_tabs
  for each row execute function set_updated_at();

drop trigger if exists trg_workspace_blocks_updated on workspace_blocks;
create trigger trg_workspace_blocks_updated before update on workspace_blocks
  for each row execute function set_updated_at();

-- =========================================================================
-- RLS — mesma postura de 0001: tudo bloqueado, acesso só via service_role
-- nas API routes, que aplicam o filtro de tenant.
-- =========================================================================
alter table workspaces            enable row level security;
alter table workspace_pages       enable row level security;
alter table workspace_page_tabs   enable row level security;
alter table workspace_blocks      enable row level security;
alter table workspace_favorites   enable row level security;
alter table workspace_recent_items enable row level security;
alter table workspace_revisions   enable row level security;
alter table workspace_files       enable row level security;
