-- Spark Tasks — migration 0014: task types (structured fields + note templates).
-- Adds a per-task type marker and a JSON bag of structured, labeled fields used
-- by the "Cotação" task type. Both are additive with constant defaults
-- (metadata-only, no table rewrite). Table-level grants already cover new
-- columns, so no GRANT is needed (same as 0004/0007).

begin;

alter table spark_tasks.tasks
  add column if not exists task_type text;

alter table spark_tasks.tasks
  add column if not exists custom_fields jsonb not null default '[]'::jsonb;

commit;
