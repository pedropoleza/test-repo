import { defineConfig } from "drizzle-kit";

// Env is validated in src/env.ts; drizzle-kit runs outside Next so read directly.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for drizzle-kit");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["spark_tasks"],
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
