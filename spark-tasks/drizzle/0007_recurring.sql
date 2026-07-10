-- Spark Tasks — migration 0007: recurring flag for source tasks.
-- (Applied to production via Supabase MCP; kept here as the audit record.)

begin;

alter table spark_tasks.tasks
  add column if not exists recurring boolean not null default false;

commit;
