/**
 * Automated tenant-isolation test (plan Stage 1 gate).
 *
 * Proves, at the APP layer (same scoping the tRPC middleware applies) and the
 * DB layer (attempting to bypass RLS), that a session scoped to location A
 * cannot read or write location B's rows.
 *
 * Requires a real DATABASE_URL with the 0000/0001 migrations applied and the
 * `spark_tasks_app` role present. Skips (does not fail) when DATABASE_URL is
 * unset, so CI without a DB stays green while local/staging runs enforce it.
 *
 *   DATABASE_URL=... pnpm test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const LOC_A = "test_loc_A";
const LOC_B = "test_loc_B";

run("tenant isolation (RLS)", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, prepare: false });
    // Seed one board per location (privileged connection).
    await sql`select set_config('app.location_id', ${LOC_A}, false)`;
    await sql`insert into spark_tasks.boards (location_id, name) values (${LOC_A}, 'A')`;
    await sql`select set_config('app.location_id', ${LOC_B}, false)`;
    await sql`insert into spark_tasks.boards (location_id, name) values (${LOC_B}, 'B')`;
    await sql`select set_config('app.location_id', '', false)`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from spark_tasks.boards where location_id in (${LOC_A}, ${LOC_B})`;
    await sql.end();
  });

  it("scoped to A, reads only A's rows", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`set local role spark_tasks_app`;
      await tx`select set_config('app.location_id', ${LOC_A}, true)`;
      return tx`select location_id from spark_tasks.boards`;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.location_id === LOC_A)).toBe(true);
  });

  it("scoped to A, cannot see B even when querying B explicitly", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`set local role spark_tasks_app`;
      await tx`select set_config('app.location_id', ${LOC_A}, true)`;
      return tx`select 1 from spark_tasks.boards where location_id = ${LOC_B}`;
    });
    expect(rows.length).toBe(0);
  });

  it("scoped to A, cannot insert a row for B (WITH CHECK)", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role spark_tasks_app`;
        await tx`select set_config('app.location_id', ${LOC_A}, true)`;
        await tx`insert into spark_tasks.boards (location_id, name) values (${LOC_B}, 'smuggled')`;
      }),
    ).rejects.toThrow();
  });
});
