/**
 * Scheduled job: proactively refresh GHL install tokens before they expire.
 *
 * Why: a token that reaches its near-expiry window during a live board load is
 * what triggers the cross-instance refresh race (many lambdas each trying to
 * spend GHL's single-use rotating refresh token at once). Refreshing ahead of
 * time on a schedule keeps tokens comfortably fresh so the live path almost
 * never has to refresh — and when it does, it's still serialized by the DB
 * advisory lock in oauth.ts. Pure defense-in-depth; safe to run concurrently.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET
 * is configured. We also accept `?key=` for manual runs. No secret set => 401.
 */
import { NextResponse, type NextRequest } from "next/server";
import { refreshExpiringInstalls } from "~/server/ghl/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization") === `Bearer ${secret}`;
  const key = req.nextUrl.searchParams.get("key") === secret;
  return bearer || key;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Refresh anything expiring within the next ~7h; the schedule runs every 6h,
  // so every token is renewed before it can lapse, with a safe overlap.
  const minutesParam = Number(req.nextUrl.searchParams.get("window"));
  const windowMs =
    Number.isFinite(minutesParam) && minutesParam > 0
      ? minutesParam * 60_000
      : 7 * 60 * 60_000;
  const summary = await refreshExpiringInstalls(windowMs);
  return NextResponse.json({ ok: true, ...summary });
}
