/**
 * Validação de webhooks do HighLevel (§16).
 *
 * O GHL assina os webhooks com Ed25519 e envia a assinatura no header
 * `x-wh-signature` (algumas integrações usam `x-ghl-signature`). A
 * verificação precisa ser feita sobre o BODY CRU (bytes exatos), ANTES
 * do JSON.parse — qualquer re-serialização quebra a assinatura.
 *
 * A public key do GHL é fixa e pública; deixamos configurável por env
 * (GHL_WEBHOOK_PUBLIC_KEY, PEM ou base64 DER) e caímos na chave publicada
 * pela LeadConnect como default.
 *
 * Retorna { valid, reason }. Rejeitar requisições com assinatura inválida.
 */
import { createPublicKey, verify as edVerify } from "node:crypto";

// A public key Ed25519 do HighLevel é publicada por eles e DEVE ser configurada
// em GHL_WEBHOOK_PUBLIC_KEY (PEM SPKI ou base64 DER). Não embutimos um default:
// uma chave errada embutida daria falsa sensação de segurança. Sem a env, a
// verificação falha fechada com motivo diagnóstico.
let _cachedKey = null;

function getPublicKey() {
  if (_cachedKey) return _cachedKey;
  const raw = process.env.GHL_WEBHOOK_PUBLIC_KEY;
  if (!raw) throw new Error("public_key_not_configured");
  try {
    if (raw.includes("BEGIN")) {
      _cachedKey = createPublicKey(raw);
    } else {
      // base64 de DER SPKI
      _cachedKey = createPublicKey({
        key: Buffer.from(raw, "base64"),
        format: "der",
        type: "spki",
      });
    }
  } catch (err) {
    _cachedKey = null;
    throw new Error(`invalid_ghl_public_key: ${err.message}`);
  }
  return _cachedKey;
}

/** Extrai a assinatura dos headers, tolerando variações de nome. */
export function extractSignature(headers = {}) {
  return (
    headers["x-wh-signature"] ||
    headers["x-ghl-signature"] ||
    headers["x-gohighlevel-signature"] ||
    null
  );
}

/**
 * @param {Buffer|string} rawBody  body CRU (bytes exatos recebidos)
 * @param {string} signatureB64    assinatura Ed25519 em base64
 * @returns {{valid: boolean, reason?: string}}
 */
export function verifyGhlSignature(rawBody, signatureB64) {
  // Escape hatch explícito pra dev/sandbox — nunca ligar em produção.
  if (process.env.WA_SKIP_WEBHOOK_VERIFY === "1") {
    return { valid: true, reason: "verification_skipped" };
  }
  if (!signatureB64) return { valid: false, reason: "missing_signature" };

  let key;
  try {
    key = getPublicKey();
  } catch (err) {
    return { valid: false, reason: err.message };
  }

  const data = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  let sig;
  try {
    sig = Buffer.from(String(signatureB64), "base64");
  } catch {
    return { valid: false, reason: "signature_not_base64" };
  }

  let ok = false;
  try {
    // Ed25519: algoritmo null (a curva é implícita na chave).
    ok = edVerify(null, data, key, sig);
  } catch (err) {
    return { valid: false, reason: `verify_error:${err.message}` };
  }
  return ok ? { valid: true } : { valid: false, reason: "signature_mismatch" };
}
