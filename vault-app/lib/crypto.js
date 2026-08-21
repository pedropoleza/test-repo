/**
 * Criptografia em repouso DEDICADA do Cofre (AES-256-GCM).
 *
 * Separação real: usa uma chave PRÓPRIA (TOKEN_ENCRYPTION_KEY), distinta
 * da chave do Referral Hub — o deploy do Referral não decripta os tokens/URLs
 * do Cofre e vice-versa. Documentos de imigrante exigem esse isolamento.
 *
 * Chave: base64 de 32 bytes.
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Formato: base64( iv(12) || ciphertext || authTag(16) ).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_ENV = "TOKEN_ENCRYPTION_KEY";

function getKey() {
  const k = process.env[KEY_ENV];
  if (!k) throw new Error(`${KEY_ENV} not set`);
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to 32 bytes (got ${buf.length})`);
  }
  return buf;
}

export function encrypt(plaintext) {
  if (typeof plaintext !== "string") throw new Error("plaintext must be string");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decrypt(ciphertextB64) {
  const buf = Buffer.from(ciphertextB64, "base64");
  if (buf.length < 28) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
