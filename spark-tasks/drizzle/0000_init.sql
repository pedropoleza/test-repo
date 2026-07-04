-- Spark Tasks V1 — initial migration
-- Postgres schema: spark_tasks  (plan §5). RLS enabled + FORCED on every table.
--
-- Isolation model (plan §2):
--   * Every table has location_id text NOT NULL.
--   * Policies compare location_id to current_setting('app.location_id').
--   * The request sets that GUC via SET LOCAL inside a transaction.
--   * The app connects and then does `SET LOCAL role spark_tasks_app` so the
--     active role is a NON-superuser without BYPASSRLS — otherwise a superuser
--     (or Supabase service_role) would silently bypass every policy and the
--     "backstop" would be a no-op. FORCE ROW LEVEL SECURITY covers the case
--     where the app role also owns the tables.
--
-- Apply with: psql "$DATABASE_URL" -f drizzle/0000_init.sql
-- (or via the Drizzle/Supabase migration flow — see docs/STAGE-0.md)

begin;

create schema if not exists spark_tasks;

-- ---------------------------------------------------------------------------
-- Non-login application role. The app authenticates to Postgres with its own
-- credentials, then downgrades to this role per-request. NOLOGIN because it is
-- only ever reached via SET ROLE, never a direct connection.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'spark_tasks_app') then
    create role spark_tasks_app nologin;
  end if;
end
$$;

grant usage on schema spark_tasks to spark_tasks_app;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists spark_tasks.boards (
  id          uuid primary key default gen_random_uuid(),
  location_id text not null,
  name        text not null default 'Tarefas',
  created_at  timestamptz not null default now()
);

create table if not exists spark_tasks.tasks (
  id          uuid primary key default gen_random_uuid(),
  location_id text not null,
  board_id    uuid not null references spark_tasks.boards(id) on delete cascade,
  title       text not null,
  note        text,
  status      text not null default 'todo',
  color       text not null default 'gray',
  due_date    timestamptz,
  contact_id  text,
  position    integer not null default 0,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tasks_status_check check (status in ('todo','doing','waiting','done')),
  constraint tasks_color_check  check (color  in ('gray','blue','amber','green','red','purple'))
);

create table if not exists spark_tasks.task_assignees (
  task_id     uuid not null references spark_tasks.tasks(id) on delete cascade,
  user_id     text not null,
  location_id text not null,
  primary key (task_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists boards_location_idx
  on spark_tasks.boards (location_id);
create index if not exists tasks_location_idx
  on spark_tasks.tasks (location_id);
create index if not exists tasks_board_status_position_idx
  on spark_tasks.tasks (board_id, status, position);
create index if not exists tasks_contact_idx
  on spark_tasks.tasks (contact_id);
create index if not exists task_assignees_location_idx
  on spark_tasks.task_assignees (location_id);
create index if not exists task_assignees_user_idx
  on spark_tasks.task_assignees (user_id);

-- ---------------------------------------------------------------------------
-- Privileges for the app role
-- ---------------------------------------------------------------------------
grant select, insert, update, delete
  on all tables in schema spark_tasks to spark_tasks_app;
alter default privileges in schema spark_tasks
  grant select, insert, update, delete on tables to spark_tasks_app;

-- ---------------------------------------------------------------------------
-- Row-Level Security: enable + FORCE, one tenant-isolation policy per table.
-- ---------------------------------------------------------------------------
alter table spark_tasks.boards          enable row level security;
alter table spark_tasks.tasks           enable row level security;
alter table spark_tasks.task_assignees  enable row level security;

alter table spark_tasks.boards          force row level security;
alter table spark_tasks.tasks           force row level security;
alter table spark_tasks.task_assignees  force row level security;

drop policy if exists tenant_isolation on spark_tasks.boards;
create policy tenant_isolation on spark_tasks.boards
  using      (location_id = current_setting('app.location_id', true))
  with check (location_id = current_setting('app.location_id', true));

drop policy if exists tenant_isolation on spark_tasks.tasks;
create policy tenant_isolation on spark_tasks.tasks
  using      (location_id = current_setting('app.location_id', true))
  with check (location_id = current_setting('app.location_id', true));

drop policy if exists tenant_isolation on spark_tasks.task_assignees;
create policy tenant_isolation on spark_tasks.task_assignees
  using      (location_id = current_setting('app.location_id', true))
  with check (location_id = current_setting('app.location_id', true));

commit;
