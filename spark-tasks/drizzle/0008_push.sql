-- Spark Tasks — migration 0008: web push subscriptions (per user/browser).
-- (Applied to production via Supabase MCP; kept here as the audit record.)

begin;

create table if not exists spark_tasks.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  location_id  text not null,
  user_id      text not null,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subs_recipient_idx
  on spark_tasks.push_subscriptions (location_id, user_id);

grant select, insert, update, delete on spark_tasks.push_subscriptions to spark_tasks_app;
grant select, insert, update, delete on spark_tasks.push_subscriptions to spark_tasks_login;

alter table spark_tasks.push_subscriptions enable row level security;
alter table spark_tasks.push_subscriptions force row level security;

drop policy if exists tenant_isolation on spark_tasks.push_subscriptions;
create policy tenant_isolation on spark_tasks.push_subscriptions
  using      (location_id = current_setting('app.location_id', true))
  with check (location_id = current_setting('app.location_id', true));

commit;
