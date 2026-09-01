/**
 * One-time (re-runnable) backfill of existing tasks to the Spark Workspace.
 *
 * Pushes every active task of the configured mirror locations to the Workspace
 * inbound webhook. Idempotent on the Workspace side (upsert by id, ordered by
 * updatedAt), so it's safe to run more than once.
 *
 * Gated by the shared webhook secret:  Authorization: Bearer <secret>
 */
import { NextResponse, type NextRequest } from "next/server";
import { backfillWorkspace, mirrorLocations } from "~/server/ghl/workspace-mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.WORKSPACE_WEBHOOK_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const locations = mirrorLocations();
  if (locations.length === 0) {
    return NextResponse.json({ error: "no_mirror_locations" }, { status: 400 });
  }
  const results: Record<string, unknown> = {};
  for (const loc of locations) {
    results[loc] = await backfillWorkspace(loc);
  }
  return NextResponse.json({ ok: true, results });
}

export const POST = run;
export const GET = run;
