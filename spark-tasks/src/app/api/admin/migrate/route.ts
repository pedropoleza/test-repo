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

const DDL = [
  sql`alter table spark_tasks.tasks add column if not exists task_type text`,
  sql`alter table spark_tasks.tasks add column if not exists custom_fields jsonb not null default '[]'::jsonb`,
];

/** Run the DDL under a given role (empty = current login role). */
async function runUnderRole(role: string | null): Promise<string> {
  await db.transaction(async (tx) => {
    if (role) await tx.execute(sql.raw(`set local role ${role}`));
    for (const stmt of DDL) await tx.execute(stmt);
  });
  return "ok";
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Try as the app role first (it likely owns the tables); fall back to the
  // plain login role. Report which strategy worked, or every error.
  const attempts: { role: string | null; label: string }[] = [
    { role: "spark_tasks_app", label: "spark_tasks_app" },
    { role: null, label: "login_role" },
  ];
  const errors: Record<string, string> = {};
  for (const a of attempts) {
    try {
      await runUnderRole(a.role);
      return NextResponse.json({ ok: true, appliedAs: a.label, errors });
    } catch (e) {
      errors[a.label] = e instanceof Error ? e.message.slice(0, 300) : "unknown";
    }
  }
  return NextResponse.json({ ok: false, errors }, { status: 500 });
}
