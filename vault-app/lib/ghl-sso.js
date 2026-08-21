/**
 * Decrypts GHL iframe SSO payloads.
 *
 * GHL embeds Custom Page apps in an iframe and, on receiving a
 * `REQUEST_USER_DATA` postMessage from the iframe, replies with a
 * `REQUEST_USER_DATA_RESPONSE` whose `payload` is encrypted with the
 * agency-level "Shared Secret Key" (same value we store as
 * GHL_WEBHOOK_SECRET). The encryption format is the default produced
 * by crypto-js: AES-256-CBC with EVP_BytesToKey/MD5 key derivation
 * and an "Salted__" + 8-byte salt prefix, base64-encoded.
 *
 * This file replicates that decryption using only Node's built-ins
 * so we don't take a dependency on crypto-js on the server.
 */
import { createDecipheriv, createHash } from "node:crypto";

function evpKDF(passphrase, salt, keyLen = 32, ivLen = 16) {
  const passSalt = Buffer.concat([Buffer.from(passphrase, "utf8"), salt]);
  const blocks = [];
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

export function decryptCryptoJS(ciphertextB64, passphrase) {
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
