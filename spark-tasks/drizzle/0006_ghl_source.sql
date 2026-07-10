-- Spark Tasks — migration 0006: GHL native task origin + external id.
-- (Applied to production via Supabase MCP; kept here as the audit record.)

begin;

alter table spark_tasks.tasks
  add column if not exists source text not null default 'native',
  add column if not exists external_id text;

alter table spark_tasks.tasks
  drop constraint if exists tasks_source_check;
alter table spark_tasks.tasks
  add constraint tasks_source_check check (source in ('native','ghl'));

create unique index if not exists tasks_ext_unique
  on spark_tasks.tasks (location_id, external_id)
  where external_id is not null;

commit;
