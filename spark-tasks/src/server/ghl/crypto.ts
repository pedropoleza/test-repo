/**
 * AES-256-GCM helpers for encrypting GHL tokens at rest (plan §2 rule 4).
 *
 * Key: ENCRYPTION_KEY — base64 of 32 bytes.
 * Ciphertext format: base64( iv(12) || ciphertext || authTag(16) ).
 *
 * Ported from the existing SparkLeads project (spark-referral-hub
 * lib/server/crypto.js) so both apps share the same on-disk format.
 * Tokens must NEVER be logged or returned to the client.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "~/env";

function getKey(): Buffer {
  const buf = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (buf.length !== 32) {
    // env.ts already validates this, but guard anyway.
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  }
  return buf;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decryptToken(ciphertextB64: string): string {
  const buf = Buffer.from(ciphertextB64, "base64");
  if (buf.length < 28) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
