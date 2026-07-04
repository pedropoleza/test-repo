/**
 * GHL REST client, always scoped to a location via the Location token (§4.2).
 * Server-only. Tokens are resolved through oauth.ts and never leave this layer.
 */
import { getLocationToken } from "./oauth";

const GHL_BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

async function ghlFetch<T>(
  locationId: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const token = await getLocationToken(locationId);
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: API_VERSION,
      Accept: "application/json",
      ...(init?.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // Trimmed body only — never the token or full payloads.
    throw new Error(`ghl_api_${res.status}: ${path} ${text.slice(0, 160)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------------------------------------------------------------------------
// Users (Stage 3 — assignee picker)
// ---------------------------------------------------------------------------

export type GhlUser = { id: string; name: string; email?: string };

// Short in-memory cache (plan: "short cache"). Serverless-instance-local.
const usersCache = new Map<string, { data: GhlUser[]; expMs: number }>();
const USERS_TTL_MS = 5 * 60_000;

export async function getLocationUsers(locationId: string): Promise<GhlUser[]> {
  const hit = usersCache.get(locationId);
  if (hit && hit.expMs > Date.now()) return hit.data;

  const raw = await ghlFetch<{
    users?: Array<{
      id: string;
      name?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
    }>;
  }>(locationId, `/users/?locationId=${encodeURIComponent(locationId)}`);

  const data: GhlUser[] = (raw.users ?? []).map((u) => ({
    id: u.id,
    name:
      u.name?.trim() ||
      [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
      u.email ||
      u.id,
    email: u.email,
  }));
  usersCache.set(locationId, { data, expMs: Date.now() + USERS_TTL_MS });
  return data;
}

// ---------------------------------------------------------------------------
// Contacts (Stage 4 — optional link + write-back)
// ---------------------------------------------------------------------------

export type GhlContact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
};

type RawContact = {
  id: string;
  locationId?: string;
  contactName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

function normalizeContact(c: RawContact): GhlContact {
  return {
    id: c.id,
    name:
      c.contactName?.trim() ||
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      c.email ||
      c.phone ||
      c.id,
    email: c.email,
    phone: c.phone,
  };
}

export async function searchContacts(
  locationId: string,
  query: string,
): Promise<GhlContact[]> {
  const raw = await ghlFetch<{ contacts?: RawContact[] }>(
    locationId,
    `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}&limit=20`,
  );
  return (raw.contacts ?? []).map(normalizeContact);
}

/** Fetch a single contact; null if it doesn't belong to this location. */
export async function getContact(
  locationId: string,
  contactId: string,
): Promise<GhlContact | null> {
  const raw = await ghlFetch<{ contact?: RawContact }>(
    locationId,
    `/contacts/${encodeURIComponent(contactId)}`,
  );
  const c = raw.contact;
  if (!c) return null;
  // The location token already scopes access, but double-check the tenant.
  if (c.locationId && c.locationId !== locationId) return null;
  return normalizeContact(c);
}

export async function createContactNote(
  locationId: string,
  contactId: string,
  body: string,
): Promise<void> {
  await ghlFetch(locationId, `/contacts/${encodeURIComponent(contactId)}/notes`, {
    method: "POST",
    body: { body },
  });
}

export async function addContactTags(
  locationId: string,
  contactId: string,
  tags: string[],
): Promise<void> {
  await ghlFetch(locationId, `/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: "POST",
    body: { tags },
  });
}
