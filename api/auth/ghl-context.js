/**
 * Decodifica o payload encriptado que o GHL envia via postMessage
 * (`REQUEST_USER_DATA_RESPONSE`) para a iframe e devolve os dados
 * normalizados + um JWT curto que o front usa em chamadas seguintes.
 *
 * Esta rota substitui o getLocation() baseado em URL pelo modelo SSO
 * recomendado pela GHL para Custom Page apps embedados.
 */
import { decryptCryptoJS } from "../../lib/server/ghl-decrypt.js";
import { sign as jwtSign } from "../../lib/server/jwt.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[ghl-context] GHL_WEBHOOK_SECRET not set");
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const { encrypted } =
    typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  if (!encrypted) {
    return res.status(400).json({ error: "missing_payload" });
  }

  let raw;
  try {
    raw = decryptCryptoJS(encrypted, secret);
  } catch (err) {
    console.error("[ghl-context] decrypt failed:", err.message);
    return res.status(401).json({ error: "decryption_failed" });
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("[ghl-context] invalid JSON after decrypt");
    return res.status(400).json({ error: "invalid_payload" });
  }

  // GHL evoluiu o shape do payload algumas vezes; aceitamos os
  // sinônimos mais comuns para tolerar variações.
  const locationId =
    data.activeLocation || data.locationId || data.location?.id || null;
  const locationName =
    data.activeLocationName ||
    data.locationName ||
    data.location?.name ||
    data.companyName ||
    null;
  const userId = data.userId || data.user?.id || null;
  const userName = data.userName || data.name || data.user?.name || null;
  const email = data.email || data.user?.email || null;
  const role = data.role || null;
  const type = data.type || null;
  const companyId = data.companyId || data.company?.id || null;

  // Tenta assinar um JWT curto para o front. Se a chave ainda não
  // estiver setada (Etapa 1), deixa o token nulo — o front continua
  // funcionando, mas chamadas autenticadas falharão até a chave existir.
  let sessionToken = null;
  try {
    sessionToken = jwtSign({ locationId, userId, role, companyId, type });
  } catch (err) {
    console.warn("[ghl-context] jwt skipped:", err.message);
  }

  return res.status(200).json({
    locationId,
    locationName,
    userId,
    userName,
    email,
    role,
    type,
    companyId,
    sessionToken,
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
