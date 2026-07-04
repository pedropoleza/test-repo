-- RLS tenant-isolation smoke test (plan Stage 0 gate).
-- Run AFTER 0000_init.sql:   psql "$DATABASE_URL" -f drizzle/verify_rls.sql
--
-- Proves that, running as the non-superuser app role, a session scoped to
-- location A cannot see or write location B's rows. Wrapped in a transaction
-- that ROLLS BACK, so it leaves no data behind. Any assertion failure aborts
-- with an exception.

begin;

-- Seed one board per location while still privileged (RLS not yet in effect
-- for the connection owner isn't guaranteed, so set a scope for the inserts).
select set_config('app.location_id', 'loc_A', true);
insert into spark_tasks.boards (location_id, name) values ('loc_A', 'A board');
select set_config('app.location_id', 'loc_B', true);
insert into spark_tasks.boards (location_id, name) values ('loc_B', 'B board');

-- Now act as the app role, scoped to location A.
set local role spark_tasks_app;
select set_config('app.location_id', 'loc_A', true);

do $$
declare
  visible_a int;
  visible_b int;
  leaked    int;
begin
  select count(*) into visible_a from spark_tasks.boards where location_id = 'loc_A';
  select count(*) into visible_b from spark_tasks.boards where location_id = 'loc_B';
  -- Total rows the session can see at all (RLS should hide everything != loc_A).
  select count(*) into leaked from spark_tasks.boards where location_id <> 'loc_A';

  if visible_a < 1 then
    raise exception 'FAIL: location A cannot see its own board (RLS too strict)';
  end if;
  if visible_b <> 0 or leaked <> 0 then
    raise exception 'FAIL: cross-tenant read — session scoped to loc_A sees % foreign row(s)', leaked;
  end if;
  raise notice 'OK read-isolation: A sees % own row(s), 0 foreign rows', visible_a;
end
$$;

-- WITH CHECK must block inserting a row for another location.
do $$
begin
  begin
    insert into spark_tasks.boards (location_id, name) values ('loc_B', 'smuggled');
    raise exception 'FAIL: write-isolation — inserted a loc_B row while scoped to loc_A';
  exception when insufficient_privilege or check_violation then
    raise notice 'OK write-isolation: cross-tenant insert rejected';
  end;
end
$$;

reset role;
rollback;
