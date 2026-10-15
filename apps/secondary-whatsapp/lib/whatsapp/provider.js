/**
 * Resolução de provider_installations e tokens (§13).
 *
 * Nada hardcoded: dado um locationId (Main OU Ghost) ou um
 * conversationProviderId, devolvemos a instalação correspondente e os
 * tokens de acesso pra cada camada.
 *
 * Tokens:
 *   - main_access_token  → opera na Main (inbound inject, status)
 *   - ghost_access_token → opera na Ghost (enviar WhatsApp real)
 *   - APP token          → status update do provider exige o token do
 *                          próprio Marketplace App (§12). Vem de
 *                          GHL_APP_ACCESS_TOKEN (ou resolvido via installations
 *                          OAuth por location, se disponível).
 *
 * Tokens em repouso são AES-256-GCM (lib/server/crypto.js). Quando a coluna
 * está NULL, cai no token de app compartilhado por env.
 */
import { db } from "../server/db.js";
import { decrypt } from "../server/crypto.js";
import { getAppToken, getLocationToken } from "./oauth-store.js";

const GHL_BASE = process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";
const GHL_VERSION = process.env.GHL_API_VERSION || "2021-04-15";

export function ghlBase() {
  return GHL_BASE;
}
export function ghlVersion() {
  return GHL_VERSION;
}

const SELECT_COLS =
  "id, tenant_id, agency_id, main_location_id, main_location_name, main_access_token, " +
  "ghost_location_id, ghost_location_name, ghost_access_token, ghost_whatsapp_number, " +
  "conversation_provider_id, provider_alias, provider_logo_url, status, last_error, last_checked_at";

/** Instalação pela Main location. */
export async function getInstallationByMain(mainLocationId) {
  if (!mainLocationId) return null;
  const { data, error } = await db()
    .from("provider_installations")
    .select(SELECT_COLS)
    .eq("main_location_id", mainLocationId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Instalação pela Ghost location. */
export async function getInstallationByGhost(ghostLocationId) {
  if (!ghostLocationId) return null;
  const { data, error } = await db()
    .from("provider_installations")
    .select(SELECT_COLS)
    .eq("ghost_location_id", ghostLocationId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Instalação pelo conversationProviderId (payload do outbound webhook). */
export async function getInstallationByProvider(providerId, mainLocationId) {
  if (!providerId) return null;
  let q = db()
    .from("provider_installations")
    .select(SELECT_COLS)
    .eq("conversation_provider_id", providerId);
  if (mainLocationId) q = q.eq("main_location_id", mainLocationId);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data || null;
}

function appToken() {
  const t = process.env.GHL_APP_ACCESS_TOKEN;
  if (!t) throw new Error("GHL_APP_ACCESS_TOKEN not configured");
  return t;
}

/** access_token pra operar na MAIN account desta instalação. */
export function mainToken(inst) {
  if (inst?.main_access_token) return decrypt(inst.main_access_token);
  return appToken();
}

/** access_token pra operar na GHOST account desta instalação. */
export function ghostToken(inst) {
  if (inst?.ghost_access_token) return decrypt(inst.ghost_access_token);
  return appToken();
}

/**
 * Token do Marketplace App no nível LOCATION da Main — exigido pelas APIs do
 * provider (inbound inject §5, status §12): elas pedem authClass=Location, então
 * um token de agência (Company) é recusado com "authClass not allowed".
 *
 * getLocationToken resolve isso: usa o install da própria location se existir,
 * senão cunha um token de location a partir do token de agência via
 * /oauth/locationToken. GHL_APP_ACCESS_TOKEN (env) tem prioridade se setado.
 */
export async function providerAppToken(inst) {
  if (process.env.GHL_APP_ACCESS_TOKEN) return process.env.GHL_APP_ACCESS_TOKEN;
  if (!inst?.main_location_id) {
    const stored = await getAppToken({});
    if (stored) return stored;
    throw new Error("no_app_token_available");
  }
  return await getLocationToken({
    companyId: inst.agency_id,
    locationId: inst.main_location_id,
  });
}
