-- Spark Tasks — migration 0010: multi-install token store.
-- One row per install (per-location for subaccount installs; per-agency for a
-- Company install) instead of one row per agency. Fixes "Users unavailable"
-- across subaccounts (a Location token only works for its own subaccount, and
-- the old company_id PK let installs overwrite each other).
-- (Applied to production via Supabase MCP; kept here as the audit record.)

begin;

alter table spark_tasks.ghl_installations
  add column if not exists id uuid default gen_random_uuid();
update spark_tasks.ghl_installations set id = gen_random_uuid() where id is null;
alter table spark_tasks.ghl_installations alter column id set not null;

alter table spark_tasks.ghl_installations drop constraint if exists ghl_installations_pkey;
alter table spark_tasks.ghl_installations add primary key (id);

create unique index if not exists ghl_install_location_uniq
  on spark_tasks.ghl_installations (location_id) where location_id is not null;
create unique index if not exists ghl_install_company_uniq
  on spark_tasks.ghl_installations (company_id) where location_id is null;

commit;
