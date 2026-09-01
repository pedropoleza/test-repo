-- 0004_tasks.sql
-- Tarefas vindas do Spark Tasks (webhook).
--
-- O Spark Tasks é a fonte da verdade das tarefas; aqui guardamos uma
-- réplica para poder listar, filtrar, ordenar e agrupar como qualquer
-- outra tabela, sem depender de uma chamada externa a cada abertura.
--
-- IDEMPOTÊNCIA: o unique index em (workspace_id, source, source_external_id)
-- é o que permite reentregar o mesmo evento sem duplicar — a mesma
-- doutrina do import de contatos (§47). Reentrega é regra, não exceção:
-- webhook sem confirmação reenvia.
--
-- ORDEM: `source_updated_at` guarda o instante do evento na origem, não
-- o da chegada. Entregas fora de ordem são normais em webhook, e sem
-- isso um evento antigo sobrescreveria um novo.

create table if not exists workspace_tasks (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  source             text not null default 'spark_tasks',
  source_external_id text not null,

  title              text not null default '',
  status             text not null default 'open'
                       check (status in ('open', 'done')),
  due_date           date,
  assignee           text,
  -- Id do contato no CRM, quando a tarefa está ligada a alguém. Sem
  -- foreign key: o contato não mora neste banco (decisão D10).
  contact_id         text,
  url                text,

  -- Payload cru do evento: campos que ainda não modelamos continuam
  -- disponíveis sem exigir migration para cada novo campo da origem.
  payload            jsonb not null default '{}'::jsonb,

  source_updated_at  timestamptz,
  received_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists uq_workspace_tasks_external
  on workspace_tasks(workspace_id, source, source_external_id);
create index if not exists idx_workspace_tasks_status
  on workspace_tasks(workspace_id, status, due_date);
create index if not exists idx_workspace_tasks_contact
  on workspace_tasks(workspace_id, contact_id)
  where contact_id is not null;

drop trigger if exists trg_workspace_tasks_updated on workspace_tasks;
create trigger trg_workspace_tasks_updated before update on workspace_tasks
  for each row execute function set_updated_at();

-- RLS: mesma postura das demais tabelas — tudo bloqueado, acesso só
-- pela service_role nas API routes, que aplicam o filtro de tenant.
alter table workspace_tasks enable row level security;
