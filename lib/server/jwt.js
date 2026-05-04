/**
 * JWT HS256 mínimo para o token curto que o GHL passa ao iframe.
 *
 * Chave: JWT_SIGNING_KEY na Vercel — base64 de 32+ bytes.
 * Geração:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Padrão: payload curto contendo locationId, userId, role e iat/exp.
 * TTL default 10 min; renovado pelo iframe a cada chamada de /api/tier.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const KEY_ENV = "JWT_SIGNING_KEY";

function getKey() {
  const k = process.env[KEY_ENV];
  if (!k) throw new Error(`${KEY_ENV} not set`);
  return Buffer.from(k, "base64");
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

export function sign(payload, { ttlSeconds = 600 } = {}) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = b64url(createHmac("sha256", getKey()).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

export function verify(token) {
  if (!token || typeof token !== "string") throw new Error("missing_token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const [h, p, sig] = parts;
  const expected = b64url(createHmac("sha256", getKey()).update(`${h}.${p}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("bad_signature");
  }
  const payload = JSON.parse(b64urlDecode(p).toString("utf8"));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error("expired");
  }
  return payload;
}
