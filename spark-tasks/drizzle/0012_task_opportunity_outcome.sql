-- Call-list disposition: relate a task to its GHL opportunity and record the
-- call outcome, so completing a call task can move the opportunity across
-- pipeline stages and (optionally) spawn a follow-up call.
ALTER TABLE spark_tasks.tasks
  ADD COLUMN IF NOT EXISTS opportunity_id text,
  ADD COLUMN IF NOT EXISTS call_outcome text;
