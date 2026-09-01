-- 0005_crm_lists.sql
-- Listas de CRM salvas: "todo mundo que está nesta pipeline/estágio".
--
-- A lista NÃO guarda os registros, só a pergunta. Quem responde é o CRM,
-- a cada abertura — congelar a resposta faria a lista envelhecer e virar
-- um relatório velho com cara de aba viva.
--
-- `filters` é jsonb, e não colunas pipeline_id/stage_id, porque a mesma
-- estrutura vai receber filtro por tag e por responsável sem migration.
-- O que importa hoje é { pipelineId, pipelineName, stageId, stageName }.
--
-- `seed_key` é a idempotência das listas que nascem prontas (Apólices):
-- o unique index garante que semear duas vezes não cria duas abas — a
-- mesma doutrina do §47, já usada na ficha do contato.

create table if not exists workspace_crm_lists (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  icon_value   text,
  kind         text not null default 'opportunities'
                 check (kind in ('opportunities', 'contacts')),
  filters      jsonb not null default '{}'::jsonb,
  seed_key     text,
  position     text not null,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_workspace_crm_lists
  on workspace_crm_lists(workspace_id, position);
create unique index if not exists uq_workspace_crm_lists_seed
  on workspace_crm_lists(workspace_id, seed_key)
  where seed_key is not null;

drop trigger if exists trg_workspace_crm_lists_updated on workspace_crm_lists;
create trigger trg_workspace_crm_lists_updated before update on workspace_crm_lists
  for each row execute function set_updated_at();

alter table workspace_crm_lists enable row level security;
