-- Spark Tasks — migration 0003: priority, labels, checklist, archive, comments.
-- Apply with: psql "$DATABASE_URL" -f drizzle/0003_features.sql

begin;

alter table spark_tasks.tasks
  add column if not exists priority text not null default 'none',
  add column if not exists labels jsonb not null default '[]'::jsonb,
  add column if not exists checklist jsonb not null default '[]'::jsonb,
  add column if not exists archived_at timestamptz;

alter table spark_tasks.tasks
  drop constraint if exists tasks_priority_check;
alter table spark_tasks.tasks
  add constraint tasks_priority_check
  check (priority in ('none','low','medium','high','urgent'));

create table if not exists spark_tasks.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references spark_tasks.tasks(id) on delete cascade,
  location_id text not null,
  author_id   text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists task_comments_task_idx
  on spark_tasks.task_comments (task_id, created_at);
create index if not exists task_comments_location_idx
  on spark_tasks.task_comments (location_id);

grant select, insert, update, delete
  on spark_tasks.task_comments to spark_tasks_app;
grant select, insert, update, delete
  on spark_tasks.task_comments to spark_tasks_login;

alter table spark_tasks.task_comments enable row level security;
alter table spark_tasks.task_comments force row level security;

drop policy if exists tenant_isolation on spark_tasks.task_comments;
create policy tenant_isolation on spark_tasks.task_comments
  using      (location_id = current_setting('app.location_id', true))
  with check (location_id = current_setting('app.location_id', true));

commit;
