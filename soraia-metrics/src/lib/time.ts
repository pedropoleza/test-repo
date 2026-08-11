/**
 * Timezone-aware week boundaries (Mon 00:00 → next Mon 00:00), without a date
 * library. Weeks are anchored to the location's timezone so "this week" matches
 * how the team reads their calendar. DST is handled by offset correction.
 */
export const METRICS_TZ = process.env.METRICS_TZ ?? "America/New_York";

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

function zonedParts(ms: number, tz: string): Parts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return {
    year: +p.year!,
    month: +p.month!,
    day: +p.day!,
    hour: p.hour === "24" ? 0 : +p.hour!,
    minute: +p.minute!,
    second: +p.second!,
    weekday: p.weekday!,
  };
}

/** UTC ms for local wall-clock midnight of the given Y-M-D in `tz`. */
function zonedMidnightMs(y: number, m: number, d: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const p = zonedParts(guess, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = asUtc - guess; // how far local is ahead of UTC at this instant
  return guess - offset;
}

const WD: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type WeekRange = { startMs: number; endMs: number; label: string };

/**
 * Monday-anchored week range, `weeksAgo` back from the current week, in `tz`.
 * label is like "11–17 Aug".
 */
export function weekRange(
  weeksAgo = 0,
  tz: string = METRICS_TZ,
  nowMs: number = Date.now(),
): WeekRange {
  const p = zonedParts(nowMs, tz);
  const daysSinceMon = (WD[p.weekday]! + 6) % 7; // Mon = 0
  // Monday's calendar date (pure-date arithmetic avoids DST drift).
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day));
  base.setUTCDate(base.getUTCDate() - daysSinceMon - weeksAgo * 7);
  const startMs = zonedMidnightMs(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    tz,
  );
  const endBase = new Date(base);
  endBase.setUTCDate(endBase.getUTCDate() + 7);
  const endMs = zonedMidnightMs(
    endBase.getUTCFullYear(),
    endBase.getUTCMonth() + 1,
    endBase.getUTCDate(),
    tz,
  );

  const last = new Date(endMs - 86_400_000);
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "numeric",
    }).format(new Date(ms));
  const month = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    month: "short",
  }).format(last);
  const label = `${fmt(startMs)}–${fmt(last.getTime())} ${month}`;
  return { startMs, endMs, label };
}
