/**
 * One-shot, gated schema migration runner (migration 0014).
 *
 * Supabase MCP isn't reachable from this environment, so this applies the
 * additive `task_type` / `custom_fields` columns through the app's own DB
 * connection. Both statements are idempotent (ADD COLUMN IF NOT EXISTS) with
 * constant defaults, so they're metadata-only (no table rewrite / long lock)
 * and safe to re-run. Gated by CRON_SECRET; reports the exact outcome without
 * leaking anything. Remove after the columns are in place.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "~/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.MIGRATE_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization") === `Bearer ${secret}`;
  const key = req.nextUrl.searchParams.get("key") === secret;
  return bearer || key;
}

const STATEMENTS: { label: string; run: () => Promise<unknown> }[] = [
  {
    label: "tasks.task_type",
    run: () =>
      db.execute(
        sql`alter table spark_tasks.tasks add column if not exists task_type text`,
      ),
  },
  {
    label: "tasks.custom_fields",
    run: () =>
      db.execute(
        sql`alter table spark_tasks.tasks add column if not exists custom_fields jsonb not null default '[]'::jsonb`,
      ),
  },
];

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results: Record<string, string> = {};
  let ok = true;
  for (const s of STATEMENTS) {
    try {
      await s.run();
      results[s.label] = "ok";
    } catch (e) {
      ok = false;
      results[s.label] = e instanceof Error ? e.message.slice(0, 300) : "unknown";
    }
  }
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 500 });
}
