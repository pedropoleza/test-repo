/**
 * Decodifica o payload encriptado que o GHL envia via postMessage
 * (`REQUEST_USER_DATA_RESPONSE`) para a iframe e devolve os dados
 * normalizados + um JWT curto que o front usa em chamadas seguintes.
 *
 * Anti-replay: cada payload encriptado é hasheado (SHA-256) e armazenado
 * em sso_replay_cache. Se o mesmo digest vier duas vezes em janela
 * curta, rejeitamos. O cache tem garbage-collection no próprio insert
 * (best-effort cleanup).
 */
import { createHash } from "node:crypto";
import { decryptCryptoJS } from "../../lib/server/ghl-decrypt.js";
import { sign as jwtSign } from "../../lib/server/jwt.js";
import { ensureInstallation } from "../../lib/server/provision.js";
import { db } from "../../lib/server/db.js";

const REPLAY_WINDOW_MS = 60 * 60 * 1000; // 1h: postMessage típico chega em < 1s

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
  if (!encrypted || typeof encrypted !== "string") {
    return res.status(400).json({ error: "missing_payload" });
  }

  // Anti-replay: digest do payload encriptado.
  const digest = createHash("sha256").update(encrypted).digest("hex");
  try {
    const { error } = await db()
      .from("sso_replay_cache")
      .insert({ digest });
    if (error) {
      if (error.code === "23505" || /duplicate/i.test(error.message)) {
        console.warn("[ghl-context] replay detected", digest.slice(0, 12));
        return res.status(409).json({ error: "replay_detected" });
      }
      console.warn("[ghl-context] replay cache error (allowing):", error.message);
    }
    // Best-effort garbage collection: delete digests > 1h.
    // Não bloqueia se falhar.
    db()
      .from("sso_replay_cache")
      .delete()
      .lt("received_at", new Date(Date.now() - REPLAY_WINDOW_MS).toISOString())
      .then(() => {}, () => {});
  } catch (err) {
    console.warn("[ghl-context] replay check non-fatal:", err.message);
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
    return res.status(400).json({ error: "invalid_payload" });
  }

  // GHL evoluiu o shape do payload algumas vezes; aceitamos sinônimos
  // comuns pra tolerar variações.
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

  let sessionToken = null;
  try {
    sessionToken = jwtSign({ locationId, userId, role, companyId, type });
  } catch (err) {
    console.warn("[ghl-context] jwt skipped:", err.message);
  }

  // Lazy provisioning agency-wide via PIT. Erros não bloqueiam SSO.
  let installation = null;
  if (locationId && process.env.GHL_AGENCY_PIT) {
    try {
      installation = await ensureInstallation(locationId, {
        locationName,
        companyId,
      });
    } catch (err) {
      console.warn("[ghl-context] provision skipped:", err?.message || err);
    }
  }

  // shareUrl = Stripe Payment Link + ?prefilled_promo_code=<cupom>
  // (cupom é pre-preenchido no campo do checkout, cliente clica Apply)
  let shareUrl = null;
  const linkBase = process.env.STRIPE_PAYMENT_LINK_BASE;
  if (linkBase && installation?.coupon_code) {
    const sep = linkBase.includes("?") ? "&" : "?";
    shareUrl = `${linkBase}${sep}prefilled_promo_code=${encodeURIComponent(installation.coupon_code)}`;
  }

  return res.status(200).json({
    locationId,
    locationName: installation?.location_name || locationName,
    userId,
    userName,
    email,
    role,
    type,
    companyId,
    sessionToken,
    couponCode: installation?.coupon_code || null,
    shareUrl,
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
