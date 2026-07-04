-- Spark Tasks V1 — migration 0002: idempotency flag for the D7 write-back.
-- Set once the "task completed" note/tag was written to the linked GHL
-- contact, so retries and repeated done-transitions never duplicate work.
--
-- Apply with: psql "$DATABASE_URL" -f drizzle/0002_writeback.sql

begin;

alter table spark_tasks.tasks
  add column if not exists completed_writeback_at timestamptz;

commit;
