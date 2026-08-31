import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const globalForDb = globalThis as unknown as {
  client?: ReturnType<typeof postgres>;
};
// Supabase pooler (Supavisor, transaction mode): TLS required, no prepared
// statements. `ssl: "require"` tolerates the pooler's certificate chain.
const client =
  globalForDb.client ?? postgres(url, { prepare: false, ssl: "require" });
if (process.env.NODE_ENV !== "production") globalForDb.client = client;

export const db = drizzle(client, { schema });
