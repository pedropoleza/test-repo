/**
 * POST /api/session — handshake do Custom Page (iframe GHL).
 *
 * O GHL embute o app numa iframe. A página pede o contexto do usuário via
 * postMessage ('REQUEST_USER_DATA') e recebe 'REQUEST_USER_DATA_RESPONSE' com
 * um payload cifrado com a Shared Secret Key (GHL_SHARED_SECRET). Aqui a gente
 * descriptografa, extrai o locationId/usuário e devolve um JWT curto que o
 * front usa nas chamadas seguintes (/api/documents).
 *
 * Anti-replay: digest SHA-256 do payload cifrado gravado em
 * document_vault.sso_replay (mesmo digest 2x em janela curta = replay).
 */
import { createHash } from "node:crypto";
import { decryptCryptoJS } from "../lib/ghl-sso.js";
import { sign as jwtSign } from "../lib/jwt.js";
import { sql, vaultConfigured } from "../lib/db.js";

const REPLAY_WINDOW_MS = 60 * 60 * 1000; // 1h

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const secret = process.env.GHL_SHARED_SECRET;
  if (!secret) return res.status(500).json({ error: "server_misconfigured" });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const encrypted = body.encrypted;
  if (!encrypted || typeof encrypted !== "string") {
    return res.status(400).json({ error: "missing_payload" });
  }

  // Anti-replay (best-effort; não bloqueia se o banco estiver indisponível).
  if (vaultConfigured()) {
    const digest = createHash("sha256").update(encrypted).digest("hex");
    try {
      const ins = await sql()`
        insert into document_vault.sso_replay (digest) values (${digest})
        on conflict (digest) do nothing returning digest`;
      if (!ins.length) return res.status(409).json({ error: "replay_detected" });
      // GC best-effort
      sql()`delete from document_vault.sso_replay where received_at < ${new Date(Date.now() - REPLAY_WINDOW_MS).toISOString()}`
        .catch(() => {});
    } catch (err) {
      console.warn("[session] replay check non-fatal:", err.message);
    }
  }

  let data;
  try {
    data = JSON.parse(decryptCryptoJS(encrypted, secret));
  } catch (err) {
    console.error("[session] decrypt failed:", err.message);
    return res.status(401).json({ error: "decryption_failed" });
  }

  const locationId = data.activeLocation || data.locationId || data.location?.id || null;
  const locationName =
    data.activeLocationName || data.locationName || data.location?.name || data.companyName || null;
  const userId = data.userId || data.user?.id || null;
  const userName = data.userName || data.name || data.user?.name || null;
  const email = data.email || data.user?.email || null;
  const role = data.role || null;
  const companyId = data.companyId || data.company?.id || null;

  if (!locationId) return res.status(400).json({ error: "no_location_in_context" });

  // Nome da subaccount: prefere o que foi salvo na instalação (via API do GHL)
  // ao que vem no payload do SSO (que às vezes vem só com o id).
  let resolvedName = locationName;
  if (vaultConfigured()) {
    try {
      const rows = await sql()`select location_name from document_vault.installations where location_id = ${locationId} limit 1`;
      if (rows[0]?.location_name) resolvedName = rows[0].location_name;
    } catch (err) { console.warn("[session] location_name lookup failed:", err.message); }
  }

  let sessionToken = null;
  try {
    sessionToken = jwtSign({ locationId, userId, role, companyId, app: "vault" }, { ttlSeconds: 900 });
  } catch (err) {
    console.warn("[session] jwt skipped:", err.message);
  }

  return res.status(200).json({
    locationId, locationName: resolvedName, userId, userName, email, role, companyId, sessionToken,
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
