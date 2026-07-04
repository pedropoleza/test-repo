-- Spark Tasks — migration 0005: custom stages per board + notifications.
-- (Applied to production via Supabase MCP; kept here as the audit record.)

begin;

-- Stages become data per board (ordered). Existing boards get the defaults.
alter table spark_tasks.boards
  add column if not exists stages jsonb not null default
    '[{"id":"todo","name":"To Do","color":"gray"},
      {"id":"doing","name":"In Progress","color":"blue"},
      {"id":"waiting","name":"Waiting","color":"amber"},
      {"id":"done","name":"Done","color":"green","isDone":true}]'::jsonb;

-- task.status now holds a stage id (custom ids allowed).
alter table spark_tasks.tasks drop constraint if exists tasks_status_check;

create table if not exists spark_tasks.notifications (
  id          uuid primary key default gen_random_uuid(),
  location_id text not null,
  user_id     text not null,
  type        text not null,
  task_id     uuid references spark_tasks.tasks(id) on delete cascade,
  title       text not null,
  body        text,
  actor_id    text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on spark_tasks.notifications (location_id, user_id, created_at desc);

grant select, insert, update, delete on spark_tasks.notifications to spark_tasks_app;
grant select, insert, update, delete on spark_tasks.notifications to spark_tasks_login;

alter table spark_tasks.notifications enable row level security;
alter table spark_tasks.notifications force row level security;

drop policy if exists tenant_isolation on spark_tasks.notifications;
create policy tenant_isolation on spark_tasks.notifications
  using      (location_id = current_setting('app.location_id', true))
  with check (location_id = current_setting('app.location_id', true));

commit;
