/**
 * Admin diagnostic: resolve the GHL token for a location and make one real GHL
 * call, reporting success/failure WITHOUT leaking the token. Gated by the
 * shared webhook secret (Bearer). Use ?loc=<locationId>.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getLocationToken } from "~/server/ghl/oauth";
import { getLocationUsers } from "~/server/ghl/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.DIAG_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization") === `Bearer ${secret}`;
  const key = req.nextUrl.searchParams.get("key") === secret;
  return bearer || key;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loc = req.nextUrl.searchParams.get("loc");
  if (!loc) return NextResponse.json({ error: "missing_loc" }, { status: 400 });

  const out: Record<string, unknown> = { loc };
  try {
    const token = await getLocationToken(loc);
    out.tokenOk = true;
    out.tokenPrefix = token.slice(0, 6); // non-secret prefix only
  } catch (e) {
    out.tokenOk = false;
    out.tokenError = e instanceof Error ? e.message.slice(0, 300) : "unknown";
  }
  try {
    const users = await getLocationUsers(loc);
    out.usersOk = true;
    out.userCount = users.length;
  } catch (e) {
    out.usersOk = false;
    out.usersError = e instanceof Error ? e.message.slice(0, 300) : "unknown";
  }
  return NextResponse.json(out);
}
