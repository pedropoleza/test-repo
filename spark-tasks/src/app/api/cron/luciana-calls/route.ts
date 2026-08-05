/**
 * Daily call-list cron.
 *
 * Triggered by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on the project,
 * so we require it. The same endpoint can be invoked manually with that header
 * (or `?dry=1` to preview without writing — reserved for future use).
 *
 * Generates the configured call lists (currently Luciana / VENDAS →
 * "LIGAÇÕES LUCIANA") and returns a per-location summary.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CALL_LISTS } from "~/server/config";
import { runAllCallLists } from "~/server/ghl/call-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret is configured, only allow Vercel's own cron invocations,
  // which carry this header. Never leave the endpoint fully open in prod.
  if (!secret) return req.headers.get("x-vercel-cron") != null;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const maxRaw = req.nextUrl.searchParams.get("max");
  const maxOverride = maxRaw ? Number(maxRaw) : undefined;
  const results = await runAllCallLists(CALL_LISTS, {
    dryRun,
    maxOverride: Number.isFinite(maxOverride) ? maxOverride : undefined,
  });
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, dryRun, results }, { status: ok ? 200 : 207 });
}

// Allow POST too (some schedulers prefer it).
export const POST = GET;
