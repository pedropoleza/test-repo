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
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { ghlInstallations } from "~/server/db/schema";
import { env } from "~/env";
import { encryptToken, decryptToken } from "./crypto";

type Install = typeof ghlInstallations.$inferSelect;

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
 * Exchange an install `code` for a token and persist it encrypted.
 *
 * Supports BOTH install shapes, one row per install:
 *  - Agency (Company) install → Company token; mints per-location tokens later.
 *  - Subaccount (Location) install → Location token, used directly for that
 *    subaccount.
 * Classification comes from the token response (`locationId` present ⇒
 * Location). Upsert keys on the natural identity: location_id for a Location
 * install, company_id (agency row) for a Company install — so many subaccount
 * installs of the same agency coexist instead of overwriting each other.
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
  const companyId = tok.companyId ?? env.GHL_COMPANY_ID ?? "unknown";
  const locationId = tok.locationId ?? null;
  const userType = tok.userType ?? (locationId ? "Location" : "Company");

  const values = {
    companyId,
    accessTokenEnc: encryptToken(tok.access_token),
    refreshTokenEnc: tok.refresh_token ? encryptToken(tok.refresh_token) : null,
    expiresAt: expiryFrom(tok.expires_in),
    scopes: tok.scope ?? null,
    userType,
    locationId,
  };

  await db.transaction(async (tx) => {
    const existing = locationId
      ? await tx
          .select({ id: ghlInstallations.id })
          .from(ghlInstallations)
          .where(eq(ghlInstallations.locationId, locationId))
          .limit(1)
      : await tx
          .select({ id: ghlInstallations.id })
          .from(ghlInstallations)
          .where(
            and(
              eq(ghlInstallations.companyId, companyId),
              isNull(ghlInstallations.locationId),
            ),
          )
          .limit(1);

    if (existing[0]) {
      await tx
        .update(ghlInstallations)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(ghlInstallations.id, existing[0].id));
    } else {
      await tx.insert(ghlInstallations).values(values);
    }
  });
  console.info(
    `[ghl-oauth] install stored type=${userType} company=${companyId} location=${locationId ?? "-"}`,
  );
}

/** Decrypt the row's access token, refreshing (and persisting) if near expiry. */
async function validAccessToken(row: Install): Promise<string> {
  const expMs = row.expiresAt ? row.expiresAt.getTime() : 0;
  if (expMs - Date.now() > REFRESH_MARGIN_MS) {
    return decryptToken(row.accessTokenEnc);
  }
  if (!row.refreshTokenEnc) {
    // No refresh token but token still present — try it; API will 401 if dead.
    return decryptToken(row.accessTokenEnc);
  }
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
    .where(eq(ghlInstallations.id, row.id));
  return tok.access_token;
}

async function findLocationInstall(locationId: string): Promise<Install | null> {
  const [row] = await db
    .select()
    .from(ghlInstallations)
    .where(eq(ghlInstallations.locationId, locationId))
    .limit(1);
  return row ?? null;
}

async function findCompanyInstall(): Promise<Install | null> {
  const [row] = await db
    .select()
    .from(ghlInstallations)
    .where(
      env.GHL_COMPANY_ID
        ? and(
            eq(ghlInstallations.companyId, env.GHL_COMPANY_ID),
            isNull(ghlInstallations.locationId),
          )
        : isNull(ghlInstallations.locationId),
    )
    .orderBy(desc(ghlInstallations.updatedAt))
    .limit(1);
  return row ?? null;
}

// In-memory location-token cache (plan allows in-memory/DB). Serverless
// instances are ephemeral, so this is a best-effort cache; misses just refetch.
const locationTokenCache = new Map<string, { token: string; expMs: number }>();

/**
 * Access token usable for a given location's APIs. Resolution order:
 *  1. A direct **Location install** for THIS location → use its token as-is
 *     (GHL already scopes it to that subaccount).
 *  2. An **agency Company install** → mint a short-lived location token via
 *     POST /oauth/locationToken (works for any of the agency's subaccounts).
 *  3. Neither → the app isn't installed for this location (surfaced to the UI
 *     as "ghl_not_connected"). Tokens are never logged or exposed.
 */
export async function getLocationToken(locationId: string): Promise<string> {
  const cached = locationTokenCache.get(locationId);
  if (cached && cached.expMs - Date.now() > REFRESH_MARGIN_MS) {
    return cached.token;
  }

  // 1) Direct subaccount install.
  const locInstall = await findLocationInstall(locationId);
  if (locInstall) {
    return validAccessToken(locInstall);
  }

  // 2) Agency install → mint a per-location token.
  const company = await findCompanyInstall();
  if (!company) throw new Error("not_installed_for_location");

  const companyToken = await validAccessToken(company);
  const tok = await postForm(
    LOCATION_TOKEN_URL,
    { companyId: company.companyId, locationId },
    companyToken,
  );
  locationTokenCache.set(locationId, {
    token: tok.access_token,
    expMs: expiryFrom(tok.expires_in).getTime(),
  });
  return tok.access_token;
}
