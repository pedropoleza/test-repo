-- 0002_database_engine.sql
-- Workspace Engine — Phase 3 (database engine).
--
-- Arquitetura do §16: DATABASE → FIELDS → RECORDS → VIEWS. A view nunca
-- duplica registro; ela é só configuração de exibição sobre a mesma fonte.
--
-- DECISÃO CENTRAL: um registro É uma página (§18).
-- Em vez de uma tabela `workspace_database_records` separada, damos a
-- `workspace_pages` uma coluna `database_id`. Uma página com database_id
-- preenchido é um registro daquela database; os valores das propriedades
-- vão no `properties jsonb` que a página já tem, e o corpo do registro é
-- o mesmo editor de blocos. Abrir um registro como página completa passa
-- a ser consequência do modelo, não uma feature extra.

-- =========================================================================
-- workspace_databases
-- =========================================================================
create table if not exists workspace_databases (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  -- Página que hospeda a database (inline, como no Notion). Nula = database
  -- de nível superior, prevista para a Phase 4.
  page_id            uuid references workspace_pages(id) on delete cascade,
  title              text not null default 'Nova tabela',
  icon_type          text check (icon_type in ('emoji', 'url')),
  icon_value         text,
  description        text,
  source             text not null default 'native',
  source_external_id text,
  created_by         text,
  updated_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_workspace_databases_workspace
  on workspace_databases(workspace_id);
create index if not exists idx_workspace_databases_page
  on workspace_databases(page_id);
-- Idempotência de import (§47), igual a páginas e blocos.
create unique index if not exists uq_workspace_databases_external
  on workspace_databases(workspace_id, source, source_external_id)
  where source_external_id is not null;

-- =========================================================================
-- workspace_database_fields
-- `key` é a chave estável usada dentro de workspace_pages.properties.
-- Renomear um campo muda `name`, nunca `key` — os dados não se movem.
-- =========================================================================
create table if not exists workspace_database_fields (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  database_id  uuid not null references workspace_databases(id) on delete cascade,
  key          text not null,
  name         text not null default 'Campo',
  type         text not null default 'text',
  config       jsonb not null default '{}'::jsonb,
  is_primary   boolean not null default false,
  position     text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_workspace_database_fields_key
  on workspace_database_fields(database_id, key);
create index if not exists idx_workspace_database_fields_db
  on workspace_database_fields(database_id, position);

-- =========================================================================
-- workspace_database_views
-- Cada view guarda a própria configuração (§19). Nenhuma delas copia dados.
-- =========================================================================
create table if not exists workspace_database_views (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  database_id    uuid not null references workspace_databases(id) on delete cascade,
  name           text not null default 'Tabela',
  type           text not null default 'table'
                   check (type in ('table', 'board', 'list', 'gallery')),
  filters        jsonb not null default '{"op":"and","conditions":[]}'::jsonb,
  sorts          jsonb not null default '[]'::jsonb,
  group_by       text,
  visible_fields jsonb,                                  -- null = todos
  field_order    jsonb not null default '[]'::jsonb,
  layout         jsonb not null default '{}'::jsonb,
  position       text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_workspace_database_views_db
  on workspace_database_views(database_id, position);

-- =========================================================================
-- Registros: páginas com database_id
-- =========================================================================
alter table workspace_pages
  add column if not exists database_id uuid references workspace_databases(id) on delete cascade;

create index if not exists idx_workspace_pages_database
  on workspace_pages(database_id, position)
  where database_id is not null;

-- A árvore da sidebar precisa ignorar registros, senão uma tabela com 500
-- linhas vira 500 itens na navegação.
create index if not exists idx_workspace_pages_tree_no_records
  on workspace_pages(workspace_id, parent_page_id, position)
  where is_archived = false and database_id is null;

-- =========================================================================
-- updated_at triggers
-- =========================================================================
drop trigger if exists trg_workspace_databases_updated on workspace_databases;
create trigger trg_workspace_databases_updated before update on workspace_databases
  for each row execute function set_updated_at();

drop trigger if exists trg_workspace_database_fields_updated on workspace_database_fields;
create trigger trg_workspace_database_fields_updated before update on workspace_database_fields
  for each row execute function set_updated_at();

drop trigger if exists trg_workspace_database_views_updated on workspace_database_views;
create trigger trg_workspace_database_views_updated before update on workspace_database_views
  for each row execute function set_updated_at();

-- =========================================================================
-- RLS — mesma postura: bloqueado, acesso só via service role
-- =========================================================================
alter table workspace_databases       enable row level security;
alter table workspace_database_fields enable row level security;
alter table workspace_database_views  enable row level security;
