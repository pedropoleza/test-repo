/**
 * GET /api/crm-notify — read-only notification feed for the CRM-wide notifier
 * (the /crm-notify.js script pasted into GHL's Custom JS).
 *
 * Auth: the long-lived st_notify cookie (set by the SSO handshake; path-pinned
 * to this endpoint). CORS reflects only trusted GHL / white-label origins with
 * credentials, so the script can call us from any CRM page.
 */
import { NextResponse } from "next/server";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { notifications } from "~/server/db/schema";
import { verifyNotifyToken, NOTIFY_COOKIE } from "~/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN_PATTERNS = [
  /\.gohighlevel\.com$/,
  /\.leadconnectorhq\.com$/,
  /\.msgsndr\.com$/,
  /\.sparkleads\.pro$/,
];

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  try {
    const host = new URL(origin).hostname;
    const ok =
      ORIGIN_PATTERNS.some((p) => p.test(host)) ||
      host === "gohighlevel.com" ||
      host === "sparkleads.pro";
    if (!ok) return {};
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    };
  } catch {
    return {};
  }
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export async function GET(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"));
  const token = readCookie(req.headers.get("cookie"), NOTIFY_COOKIE);
  const identity = verifyNotifyToken(token);
  if (!identity) {
    return NextResponse.json({ error: "no_identity" }, { status: 401, headers: cors });
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;
  // Default window: only very recent items, so a fresh browser isn't flooded.
  const cutoff =
    since && !isNaN(since.getTime())
      ? since
      : new Date(Date.now() - 5 * 60_000);

  const rows = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.location_id', ${identity.locationId}, true)`,
    );
    return tx
      .select({
        id: notifications.id,
        title: notifications.title,
        body: notifications.body,
        taskId: notifications.taskId,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, identity.userId),
          isNull(notifications.readAt),
          gt(notifications.createdAt, cutoff),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(5);
  });

  return NextResponse.json(
    { notifications: rows, serverTime: new Date().toISOString() },
    { headers: { ...cors, "Cache-Control": "no-store" } },
  );
}
