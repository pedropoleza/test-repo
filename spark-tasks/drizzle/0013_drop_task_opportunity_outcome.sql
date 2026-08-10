-- Remove the call-list disposition columns (feature fully removed).
ALTER TABLE spark_tasks.tasks
  DROP COLUMN IF EXISTS opportunity_id,
  DROP COLUMN IF EXISTS call_outcome;
