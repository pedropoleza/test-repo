/**
 * Postgres connection + Drizzle client.
 *
 * The connection uses the app role, and every request scopes itself with
 * `SET LOCAL role spark_tasks_app` + `SET LOCAL app.location_id = <session>`
 * inside a transaction (see the tRPC middleware in Stage 1). That combination
 * is what makes RLS a real backstop even if application code has a bug.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

// Reuse the connection across HMR reloads in dev.
const conn =
  globalForDb.conn ??
  postgres(env.DATABASE_URL, {
    // Supabase pooler + serverless: keep the pool small.
    max: 5,
    prepare: false,
  });

if (env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
export { schema };
