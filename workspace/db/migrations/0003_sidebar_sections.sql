-- 0003_sidebar_sections.sql
-- Seções da sidebar definidas pelo usuário.
--
-- Antes a navegação era fixa em "Privado" e "Compartilhado", derivadas de
-- `workspace_pages.visibility`. Isso misturava DUAS coisas diferentes:
-- organização (onde eu quero ver isto) e permissão (quem pode ver isto).
--
-- Agora seção é organização pura, e `visibility` continua sendo permissão.
-- Um time pode ter "Operações", "Vendas", "Financeiro" — e uma página
-- compartilhada pode viver em qualquer uma delas.

create table if not exists workspace_sections (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null default 'Nova seção',
  icon_type    text check (icon_type in ('emoji', 'url')),
  icon_value   text,
  position     text not null,
  -- Seção padrão: recebe páginas sem seção e não pode ser excluída, para
  -- nunca existir página órfã sem lugar na navegação.
  is_default   boolean not null default false,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_workspace_sections_workspace
  on workspace_sections(workspace_id, position);
create unique index if not exists uq_workspace_sections_default
  on workspace_sections(workspace_id)
  where is_default = true;

-- Página aponta para a seção. ON DELETE SET NULL: apagar a seção nunca
-- apaga conteúdo — as páginas caem na seção padrão.
alter table workspace_pages
  add column if not exists section_id uuid references workspace_sections(id) on delete set null;

create index if not exists idx_workspace_pages_section
  on workspace_pages(workspace_id, section_id, position)
  where is_archived = false and database_id is null;

drop trigger if exists trg_workspace_sections_updated on workspace_sections;
create trigger trg_workspace_sections_updated before update on workspace_sections
  for each row execute function set_updated_at();

alter table workspace_sections enable row level security;

-- =========================================================================
-- Migração de dados: preserva exatamente o que a navegação mostra hoje.
-- Cada workspace ganha "Privado" (padrão) e "Compartilhado", e as páginas
-- de raiz vão para a seção correspondente à sua visibility.
-- =========================================================================
insert into workspace_sections (workspace_id, name, position, is_default)
select w.id, 'Privado', 'V', true
from workspaces w
where not exists (
  select 1 from workspace_sections s where s.workspace_id = w.id and s.is_default
);

insert into workspace_sections (workspace_id, name, position, is_default)
select w.id, 'Compartilhado', 'k', false
from workspaces w
where not exists (
  select 1 from workspace_sections s
  where s.workspace_id = w.id and s.name = 'Compartilhado'
);

update workspace_pages p
set section_id = s.id
from workspace_sections s
where p.section_id is null
  and p.parent_page_id is null
  and p.database_id is null
  and s.workspace_id = p.workspace_id
  and s.name = case when p.visibility = 'shared' then 'Compartilhado' else 'Privado' end;
