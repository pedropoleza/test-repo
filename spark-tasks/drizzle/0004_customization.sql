-- Spark Tasks — migration 0004: column customization + card fill style.
-- (Applied to production via Supabase MCP; kept here as the audit record.)

begin;

alter table spark_tasks.boards
  add column if not exists column_config jsonb not null default '{}'::jsonb;

alter table spark_tasks.tasks
  add column if not exists card_style text not null default 'strip';

alter table spark_tasks.tasks
  drop constraint if exists tasks_card_style_check;
alter table spark_tasks.tasks
  add constraint tasks_card_style_check
  check (card_style in ('strip','filled'));

commit;
