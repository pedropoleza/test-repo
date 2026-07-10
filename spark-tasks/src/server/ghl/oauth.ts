/**
 * GHL agency OAuth + per-location token exchange (plan §4.2).
 *
 *   1. Install once at the agency (company) level  -> Company access token.
 *   2. To call a location's data, exchange it for a short-lived Location token
 *      via POST /oauth/locationToken { companyId, locationId }.
 *
 * The Company token is stored encrypted in spark_tasks.ghl_installations and
 * refreshed on demand. Location tokens are cached in memory with their expiry.
 * Tokens are never logged or exposed to the client.
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { ghlInstallations } from "~/server/db/schema";
import { env } from "~/env";
import { encryptToken, decryptToken } from "./crypto";

const GHL_BASE = "https://services.leadconnectorhq.com";
const TOKEN_URL = `${GHL_BASE}/oauth/token`;
const LOCATION_TOKEN_URL = `${GHL_BASE}/oauth/locationToken`;
const REFRESH_MARGIN_MS = 60_000; // refresh if < 60s left

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  /** Present on Company tokens — lets us capture the agency id at install. */
  companyId?: string;
  /** 'Company' | 'Location' — which install shape produced this token. */
  userType?: string;
  /** Present on Location tokens: the subaccount the token is scoped to. */
  locationId?: string;
};

async function postForm(
  url: string,
  form: Record<string, string>,
  bearer?: string,
): Promise<TokenResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    Version: "2021-07-28",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: new URLSearchParams(form),
  });
  const text = await res.text();
  if (!res.ok) {
    // Never include the request body (contains secrets) in the error.
    throw new Error(`ghl_oauth_${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as TokenResponse;
}

function expiryFrom(expiresIn?: number): Date {
  return new Date(Date.now() + (Number(expiresIn) || 3600) * 1000);
}

/**
 * Exchange an install `code` for a token and persist it encrypted. Supports
 * BOTH install shapes: agency-level (Company token, exchanged per-location
 * later) and direct subaccount installs (Location token, used as-is).
 */
export async function handleOAuthCallback(
  code: string,
  redirectUri: string,
): Promise<void> {
  const tok = await postForm(TOKEN_URL, {
    client_id: env.GHL_APP_CLIENT_ID,
    client_secret: env.GHL_APP_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    user_type: "Company",
    redirect_uri: redirectUri,
  });
  // Prefer the companyId GHL returns with the token; env is the fallback.
  const companyId = tok.companyId ?? env.GHL_COMPANY_ID;
  if (!companyId) throw new Error("no_company_id_in_token_or_env");
  const values = {
    companyId,
    accessTokenEnc: encryptToken(tok.access_token),
    refreshTokenEnc: tok.refresh_token ? encryptToken(tok.refresh_token) : null,
    expiresAt: expiryFrom(tok.expires_in),
    scopes: tok.scope ?? null,
    userType: tok.userType ?? (tok.locationId ? "Location" : "Company"),
    locationId: tok.locationId ?? null,
  };
  await db
    .insert(ghlInstallations)
    .values(values)
    .onConflictDoUpdate({
      target: ghlInstallations.companyId,
      set: { ...values, updatedAt: sql`now()` },
    });
}

type Installation = {
  token: string;
  companyId: string;
  userType: string | null;
  locationId: string | null;
};

/** Valid installation access token, refreshing if near expiry. */
async function getInstallationToken(): Promise<Installation> {
  // V1: one install. If GHL_COMPANY_ID is set, pin to it; otherwise use the
  // (single) stored installation captured by the OAuth callback.
  const rows = await db
    .select()
    .from(ghlInstallations)
    .where(
      env.GHL_COMPANY_ID
        ? eq(ghlInstallations.companyId, env.GHL_COMPANY_ID)
        : undefined,
    )
    .orderBy(desc(ghlInstallations.updatedAt))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("agency_not_installed");

  const base = {
    companyId: row.companyId,
    userType: row.userType,
    locationId: row.locationId,
  };
  const expMs = row.expiresAt ? row.expiresAt.getTime() : 0;
  if (expMs - Date.now() > REFRESH_MARGIN_MS) {
    return { token: decryptToken(row.accessTokenEnc), ...base };
  }
  if (!row.refreshTokenEnc) throw new Error("no_refresh_token");

  const tok = await postForm(TOKEN_URL, {
    client_id: env.GHL_APP_CLIENT_ID,
    client_secret: env.GHL_APP_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: decryptToken(row.refreshTokenEnc),
    user_type: row.userType === "Location" ? "Location" : "Company",
  });
  await db
    .update(ghlInstallations)
    .set({
      accessTokenEnc: encryptToken(tok.access_token),
      refreshTokenEnc: encryptToken(
        tok.refresh_token ?? decryptToken(row.refreshTokenEnc),
      ),
      expiresAt: expiryFrom(tok.expires_in),
      updatedAt: sql`now()`,
    })
    .where(eq(ghlInstallations.companyId, row.companyId));
  return { token: tok.access_token, ...base };
}

// In-memory location-token cache (plan allows in-memory/DB). Serverless
// instances are ephemeral, so this is a best-effort cache; misses just refetch.
const locationTokenCache = new Map<string, { token: string; expMs: number }>();

/**
 * Access token usable for a given location's APIs.
 *  - Agency (Company) install → exchange via POST /oauth/locationToken.
 *  - Direct subaccount (Location) install → the installation token IS the
 *    location token; use it as-is. GHL scopes it server-side, so a mismatched
 *    location would just get 401s from the API — nothing can leak.
 * Installations recorded before user_type existed are healed on first use:
 * when the exchange answers "user type not supported", we mark the row as a
 * Location install and use the token directly.
 */
export async function getLocationToken(locationId: string): Promise<string> {
  const cached = locationTokenCache.get(locationId);
  if (cached && cached.expMs - Date.now() > REFRESH_MARGIN_MS) {
    return cached.token;
  }
  const inst = await getInstallationToken();

  if (inst.userType === "Location") {
    if (inst.locationId && inst.locationId !== locationId) {
      throw new Error("location_mismatch");
    }
    return inst.token;
  }

  try {
    const tok = await postForm(
      LOCATION_TOKEN_URL,
      { companyId: inst.companyId, locationId },
      inst.token,
    );
    locationTokenCache.set(locationId, {
      token: tok.access_token,
      expMs: expiryFrom(tok.expires_in).getTime(),
    });
    return tok.access_token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    // Legacy row without user_type that is actually a Location token.
    if (msg.includes("user type is not yet supported")) {
      await db
        .update(ghlInstallations)
        .set({ userType: "Location", locationId, updatedAt: sql`now()` })
        .where(eq(ghlInstallations.companyId, inst.companyId));
      console.info("[ghl-oauth] healed installation as Location-type");
      return inst.token;
    }
    throw err;
  }
}
