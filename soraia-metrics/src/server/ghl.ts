/**
 * GHL REST client for the Soraia Close metrics dashboard.
 *
 * Auth is a Private Integration Token (PIT) scoped to a single location, used
 * as a Bearer token. Server-only — the token never reaches the client.
 */
const GHL_BASE = "https://services.leadconnectorhq.com";

function token(): string {
  const t = process.env.GHL_PIT_TOKEN;
  if (!t) throw new Error("GHL_PIT_TOKEN not set");
  return t;
}
export function locationId(): string {
  const l = process.env.GHL_LOCATION_ID;
  if (!l) throw new Error("GHL_LOCATION_ID not set");
  return l;
}

async function ghl<T>(path: string, version = "2021-04-15"): Promise<T> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Version: version,
      Accept: "application/json",
    },
    // Metrics are recomputed on demand; never cache stale numbers.
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ghl_${res.status}: ${path} ${text.slice(0, 160)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------------------------------------------------------------------------
// Calendars & appointments (meetings metric)
// ---------------------------------------------------------------------------

export type Calendar = { id: string; name: string };

export async function getCalendars(): Promise<Calendar[]> {
  const raw = await ghl<{ calendars?: Array<{ id: string; name?: string }> }>(
    `/calendars/?locationId=${encodeURIComponent(locationId())}`,
  );
  return (raw.calendars ?? []).map((c) => ({ id: c.id, name: c.name ?? c.id }));
}

export type CalendarEvent = {
  id: string;
  calendarId: string;
  contactId?: string;
  appointmentStatus?: string;
  startTime?: string;
  dateAdded?: string;
};

/** Raw events for a calendar whose START falls in [startMs, endMs]. */
export async function getEvents(
  calendarId: string,
  startMs: number,
  endMs: number,
): Promise<CalendarEvent[]> {
  const qs = new URLSearchParams({
    locationId: locationId(),
    calendarId,
    startTime: String(startMs),
    endTime: String(endMs),
  });
  const raw = await ghl<{ events?: CalendarEvent[] }>(
    `/calendars/events?${qs.toString()}`,
  );
  return raw.events ?? [];
}

const CANCELLED = new Set(["cancelled", "canceled"]);

/**
 * Collect the booking timestamps (dateAdded, ms) of every non-cancelled event
 * across all calendars, scanning a wide START window around `centerMs` so a
 * meeting booked recently but scheduled far ahead (or already past) is still
 * seen. The caller buckets these by week to count "meetings booked" per range.
 */
export async function getBookedTimestamps(centerMs: number): Promise<number[]> {
  const scanStart = centerMs - 90 * 86_400_000; // 90d back
  const scanEnd = centerMs + 180 * 86_400_000; // 180d ahead

  const calendars = await getCalendars();
  const seen = new Set<string>();
  const out: number[] = [];

  for (const cal of calendars) {
    let events: CalendarEvent[];
    try {
      events = await getEvents(cal.id, scanStart, scanEnd);
    } catch {
      continue; // skip a calendar that errors rather than failing the metric
    }
    for (const e of events) {
      if (!e.dateAdded || seen.has(e.id)) continue;
      seen.add(e.id);
      if (CANCELLED.has((e.appointmentStatus ?? "").toLowerCase())) continue;
      const addedMs = Date.parse(e.dateAdded);
      if (!Number.isNaN(addedMs)) out.push(addedMs);
    }
  }
  return out;
}

/** Count booking timestamps within [fromMs, toMs). */
export function countInRange(
  timestamps: number[],
  fromMs: number,
  toMs: number,
): number {
  return timestamps.filter((t) => t >= fromMs && t < toMs).length;
}
