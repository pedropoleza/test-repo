/**
 * Decrypts the GHL iframe SSO payload (plan §4.1).
 *
 * GHL embeds Custom Page apps in an iframe and, on receiving a
 * `REQUEST_USER_DATA` postMessage, replies with `REQUEST_USER_DATA_RESPONSE`
 * whose payload is AES-256-CBC encrypted with the agency "Shared Secret Key"
 * (our GHL_SSO_KEY), using crypto-js's default `Salted__` + EVP_BytesToKey/MD5
 * format, base64-encoded.
 *
 * Ported from spark-referral-hub lib/server/ghl-decrypt.js (Node built-ins
 * only — no crypto-js dependency).
 */
import { createDecipheriv, createHash } from "node:crypto";
import { z } from "zod";
import { env } from "~/env";

function evpKDF(passphrase: string, salt: Buffer, keyLen = 32, ivLen = 16) {
  const passSalt = Buffer.concat([Buffer.from(passphrase, "utf8"), salt]);
  const blocks: Buffer[] = [];
  let prev = Buffer.alloc(0);
  let total = 0;
  while (total < keyLen + ivLen) {
    prev = createHash("md5")
      .update(Buffer.concat([prev, passSalt]))
      .digest();
    blocks.push(prev);
    total += prev.length;
  }
  const combined = Buffer.concat(blocks).subarray(0, keyLen + ivLen);
  return {
    key: combined.subarray(0, keyLen),
    iv: combined.subarray(keyLen, keyLen + ivLen),
  };
}

function decryptCryptoJS(ciphertextB64: string, passphrase: string): string {
  if (!ciphertextB64 || typeof ciphertextB64 !== "string") {
    throw new Error("missing_ciphertext");
  }
  const buf = Buffer.from(ciphertextB64, "base64");
  if (buf.length < 16 || buf.subarray(0, 8).toString("utf8") !== "Salted__") {
    throw new Error("not_crypto_js_format");
  }
  const salt = buf.subarray(8, 16);
  const ct = buf.subarray(16);
  const { key, iv } = evpKDF(passphrase, salt);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * The subset of the GHL SSO payload we rely on. GHL sends `activeLocation`
 * when the user is inside a sub-account (location) context; `type` is
 * 'location' or 'agency'. V1 requires a location context.
 */
const ssoPayloadSchema = z.object({
  userId: z.string().min(1),
  companyId: z.string().min(1).optional(),
  role: z.string().optional(),
  type: z.string().optional(),
  userName: z.string().optional(),
  email: z.string().optional(),
  activeLocation: z.string().optional(),
  locationId: z.string().optional(),
});

export type SsoIdentity = {
  locationId: string;
  userId: string;
  role?: string;
};

/**
 * Decrypt + validate an SSO payload into an identity. Throws on any invalid
 * payload or when no location context is present (V1 is location-scoped).
 */
export function decodeSsoPayload(encryptedB64: string): SsoIdentity {
  const json = decryptCryptoJS(encryptedB64, env.GHL_SSO_KEY);
  const parsed = ssoPayloadSchema.parse(JSON.parse(json));
  const locationId = parsed.locationId ?? parsed.activeLocation;
  if (!locationId) {
    throw new Error("sso_no_location_context");
  }
  return { locationId, userId: parsed.userId, role: parsed.role };
}
