-- Spark Tasks V1 — migration 0001: agency GHL OAuth installation store.
--
-- Agency-global infrastructure (plan §4.2), NOT tenant data:
--   * one row per company; holds the encrypted Company access/refresh token;
--   * touched only by server-side system code under the privileged connection;
--   * deliberately NOT granted to spark_tasks_app and NO tenant RLS policy,
--     so a location-scoped request can never reach agency credentials.
--
-- Apply with: psql "$DATABASE_URL" -f drizzle/0001_oauth.sql

begin;

create table if not exists spark_tasks.ghl_installations (
  company_id        text primary key,
  access_token_enc  text not null,
  refresh_token_enc text,
  expires_at        timestamptz,
  scopes            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- No grant to spark_tasks_app. RLS not enabled: the app role has zero
-- privileges here, and only the connection owner (system code) can read it.
revoke all on spark_tasks.ghl_installations from spark_tasks_app;

commit;
