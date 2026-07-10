-- Spark Tasks — migration 0009: installation token type (Company vs Location).
-- (Applied to production via Supabase MCP; kept here as the audit record.)

begin;

alter table spark_tasks.ghl_installations
  add column if not exists user_type text,
  add column if not exists location_id text;

commit;
