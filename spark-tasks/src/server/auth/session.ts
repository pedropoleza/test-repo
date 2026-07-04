/**
 * Signed, httpOnly session for the iframe (plan §4.1).
 *
 * The cookie carries only { location_id, user_id }, HMAC-SHA256 signed with
 * SESSION_SECRET. Short TTL; the front re-handshakes on expiry. The front
 * NEVER sends location_id — it always comes from this cookie server-side.
 *
 * Format: base64url(payloadJson) + "." + base64url(hmac). Constant-time verify.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "~/env";

export const SESSION_COOKIE = "st_session";
const TTL_SECONDS = 30 * 60; // 30 min; re-handshake on expiry.

export type Session = {
  locationId: string;
  userId: string;
};

type SessionPayload = Session & { exp: number };

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payloadB64: string): string {
  return b64url(
    createHmac("sha256", env.SESSION_SECRET).update(payloadB64).digest(),
  );
}

export function createSessionToken(session: Session): {
  token: string;
  maxAge: number;
} {
  const exp = Math.floor(nowSeconds()) + TTL_SECONDS;
  const payload: SessionPayload = { ...session, exp };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return { token: `${payloadB64}.${sign(payloadB64)}`, maxAge: TTL_SECONDS };
}

export function verifySessionToken(token: string | undefined): Session | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < nowSeconds()) {
      return null;
    }
    if (!payload.locationId || !payload.userId) return null;
    return { locationId: payload.locationId, userId: payload.userId };
  } catch {
    return null;
  }
}

// Wrapped so it's easy to see the one place we read wall-clock time.
function nowSeconds(): number {
  return Date.now() / 1000;
}
