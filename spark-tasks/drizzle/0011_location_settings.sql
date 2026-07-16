-- Spark Tasks — migration 0011: per-location settings.
-- ghl_sync_enabled: when false, GHL native tasks are NOT pulled into the board
-- and existing GHL-sourced cards are hidden (internal tasks fully separated).
-- (Applied to production via Supabase MCP; kept here as the audit record.)

begin;

create table if not exists spark_tasks.location_settings (
  location_id      text primary key,
  ghl_sync_enabled boolean not null default true,
  updated_at       timestamptz not null default now()
);

grant select, insert, update, delete on spark_tasks.location_settings to spark_tasks_app;
grant select, insert, update, delete on spark_tasks.location_settings to spark_tasks_login;

alter table spark_tasks.location_settings enable row level security;
alter table spark_tasks.location_settings force row level security;

drop policy if exists tenant_isolation on spark_tasks.location_settings;
create policy tenant_isolation on spark_tasks.location_settings
  using      (location_id = current_setting('app.location_id', true))
  with check (location_id = current_setting('app.location_id', true));

commit;
