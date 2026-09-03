/**
 * Normalização de telefone para E.164 (§3, ETAPA D).
 *
 * O E.164 é a CHAVE PRIMÁRIA de matching entre a Main e a Ghost account:
 * o mesmo cliente precisa colapsar no mesmo número dos dois lados.
 *
 * Formato obrigatório:  +<country><national>   ex.: +14075551234
 *
 * Estratégia (sem dependência externa — libphonenumber seria ideal, mas
 * mantemos o middleware leve):
 *   - se já vem com '+', mantém os dígitos e valida tamanho
 *   - se vem só com dígitos, aplica um default country code configurável
 *     (WA_DEFAULT_COUNTRY_CODE, default '1' = US/CA) quando o número não
 *     tem cara de já incluir DDI.
 */

const DEFAULT_CC = () => (process.env.WA_DEFAULT_COUNTRY_CODE || "1").replace(/\D/g, "");

/**
 * @param {string} raw  telefone em qualquer formato ("(407) 555-1234", "whatsapp:+14075551234", etc.)
 * @returns {string|null} E.164 ("+14075551234") ou null se não der pra normalizar.
 */
export function normalizePhone(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Remove prefixos comuns de canal (Twilio/WhatsApp) e espaços.
  s = s.replace(/^whatsapp:/i, "").replace(/^tel:/i, "").trim();

  const hadPlus = s.trim().startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (!digits) return null;

  // Alguns provedores mandam com '00' internacional em vez de '+'.
  if (!hadPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    return finalize(digits);
  }

  if (hadPlus) return finalize(digits);

  // Sem '+': decide se precisa prefixar country code.
  const cc = DEFAULT_CC();
  if (digits.length <= 11 && cc && !digits.startsWith(cc)) {
    // heurística NANP: 10 dígitos → prefixa; 11 começando com '1' já tem cc.
    if (digits.length === 10) digits = cc + digits;
    else if (!(digits.length === 11 && digits.startsWith(cc))) digits = cc + digits;
  }
  return finalize(digits);
}

function finalize(digits) {
  // E.164: 8–15 dígitos (mínimo prático 8, máximo 15 pela ITU).
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

/** true se `a` e `b` normalizam pro mesmo E.164. */
export function samePhone(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return !!na && na === nb;
}
