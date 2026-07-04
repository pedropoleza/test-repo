/**
 * POST /api/sso/handshake  (plan §4.1, §7)
 *
 * Body: { encryptedData: string } — the GHL `REQUEST_USER_DATA_RESPONSE`
 * payload the iframe received via postMessage. We decrypt it with GHL_SSO_KEY,
 * extract locationId + userId, and open a signed httpOnly session. The client
 * never chooses the location — it comes from this decrypted payload only.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { decodeSsoPayload } from "~/server/ghl/sso";
import { createSessionToken, SESSION_COOKIE } from "~/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ encryptedData: z.string().min(1) });

export async function POST(req: Request) {
  let encryptedData: string;
  try {
    ({ encryptedData } = bodySchema.parse(await req.json()));
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let identity;
  try {
    identity = decodeSsoPayload(encryptedData);
  } catch {
    // Do not echo the payload or the specific crypto error to the client.
    return NextResponse.json({ error: "invalid_sso" }, { status: 401 });
  }

  const { token, maxAge } = createSessionToken({
    locationId: identity.locationId,
    userId: identity.userId,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    // The app renders inside a cross-site GHL iframe, so the session cookie
    // must be SameSite=None to be sent at all.
    sameSite: "none",
    path: "/",
    maxAge,
  });
  return res;
}
