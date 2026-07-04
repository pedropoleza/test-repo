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
 * Exchange an install `code` for the Company token and persist it encrypted.
 * Called by the OAuth callback route after the agency install.
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
  await db
    .insert(ghlInstallations)
    .values({
      companyId,
      accessTokenEnc: encryptToken(tok.access_token),
      refreshTokenEnc: tok.refresh_token
        ? encryptToken(tok.refresh_token)
        : null,
      expiresAt: expiryFrom(tok.expires_in),
      scopes: tok.scope ?? null,
    })
    .onConflictDoUpdate({
      target: ghlInstallations.companyId,
      set: {
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: tok.refresh_token
          ? encryptToken(tok.refresh_token)
          : null,
        expiresAt: expiryFrom(tok.expires_in),
        scopes: tok.scope ?? null,
        updatedAt: sql`now()`,
      },
    });
}

/** Valid Company access token (+ its companyId), refreshing if near expiry. */
async function getCompanyToken(): Promise<{
  token: string;
  companyId: string;
}> {
  // V1: one agency install. If GHL_COMPANY_ID is set, pin to it; otherwise
  // use the (single) stored installation captured by the OAuth callback.
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

  const expMs = row.expiresAt ? row.expiresAt.getTime() : 0;
  if (expMs - Date.now() > REFRESH_MARGIN_MS) {
    return { token: decryptToken(row.accessTokenEnc), companyId: row.companyId };
  }
  if (!row.refreshTokenEnc) throw new Error("no_refresh_token");

  const tok = await postForm(TOKEN_URL, {
    client_id: env.GHL_APP_CLIENT_ID,
    client_secret: env.GHL_APP_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: decryptToken(row.refreshTokenEnc),
    user_type: "Company",
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
  return { token: tok.access_token, companyId: row.companyId };
}

// In-memory location-token cache (plan allows in-memory/DB). Serverless
// instances are ephemeral, so this is a best-effort cache; misses just refetch.
const locationTokenCache = new Map<string, { token: string; expMs: number }>();

/** Short-lived Location access token for a given location (cached). */
export async function getLocationToken(locationId: string): Promise<string> {
  const cached = locationTokenCache.get(locationId);
  if (cached && cached.expMs - Date.now() > REFRESH_MARGIN_MS) {
    return cached.token;
  }
  const company = await getCompanyToken();
  const tok = await postForm(
    LOCATION_TOKEN_URL,
    { companyId: company.companyId, locationId },
    company.token,
  );
  locationTokenCache.set(locationId, {
    token: tok.access_token,
    expMs: expiryFrom(tok.expires_in).getTime(),
  });
  return tok.access_token;
}
