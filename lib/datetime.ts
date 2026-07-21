/**
 * Timezone handling. Read this before touching any date in this codebase.
 *
 * THE PROBLEM: the build machine runs in UTC+8, Vercel's servers run in UTC, and
 * the client operates in San Francisco (America/Los_Angeles, UTC-7/-8 depending
 * on DST). A bare `new Date("2026-07-22T09:00")` is interpreted in the RUNTIME's
 * zone, so the same booking silently becomes a different time on every machine
 * it touches. A 9:00 AM airport pickup arriving in the CRM as 4:00 PM is not a
 * cosmetic bug — the customer misses their flight.
 *
 * THE RULE: every pickup datetime is an ISO string carrying an EXPLICIT offset,
 * and every render passes `timeZone: "America/Los_Angeles"`. Never call bare
 * `new Date()` formatting on a pickup time.
 */

import { BUSINESS_TIMEZONE, MIN_LEAD_TIME_HOURS } from "@/config/rates";

/**
 * The UTC offset of America/Los_Angeles at a given instant, in minutes.
 * Positive means ahead of UTC; LA is always negative (-420 PDT / -480 PST).
 *
 * Derived from the IANA database via Intl rather than hardcoded, so DST
 * transitions are handled correctly without us tracking the changeover dates.
 */
function laOffsetMinutes(at: Date): number {
  // `en-US` + longOffset yields "GMT-7" / "GMT-07:00" style strings.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    timeZoneName: "longOffset",
  }).formatToParts(at);

  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzName);
  if (!match) throw new Error(`Could not parse timezone offset from "${tzName}"`);

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

/** Format an offset in minutes as "-07:00". */
function formatOffset(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "+";
  const abs = Math.abs(totalMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * Convert a naive wall-clock datetime the customer picked (e.g. "2026-07-22"
 * + "09:00", which they mean in San Francisco time) into an ISO string with the
 * correct LA offset for that date: "2026-07-22T09:00:00-07:00".
 *
 * This is the ONLY place a naive datetime is allowed to enter the system.
 *
 * @param dateStr "YYYY-MM-DD" from a date input
 * @param timeStr "HH:MM" from a time input
 */
export function laWallClockToISO(dateStr: string, timeStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error(`Invalid date: "${dateStr}"`);
  if (!/^\d{2}:\d{2}$/.test(timeStr)) throw new Error(`Invalid time: "${timeStr}"`);

  // Two-pass: guess the offset by interpreting the wall clock as UTC, then
  // recompute using that instant. This resolves correctly because the guess is
  // never more than a day off, and offsets only change at DST boundaries.
  const provisional = new Date(`${dateStr}T${timeStr}:00Z`);
  const guess = laOffsetMinutes(provisional);

  // Shift by the guessed offset to land on the true instant, then re-read the
  // offset there — this self-corrects across a DST boundary.
  const trueInstant = new Date(provisional.getTime() - guess * 60_000);
  const actual = laOffsetMinutes(trueInstant);

  return `${dateStr}T${timeStr}:00${formatOffset(actual)}`;
}

/** Render a pickup datetime for humans, always in San Francisco time. */
export function formatPickup(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short", // shows "PDT"/"PST" so the zone is never ambiguous
  }).format(new Date(iso));
}

/** Compact variant for the opportunity name, e.g. "Jul 22, 9:00 AM PDT". */
export function formatPickupShort(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** Today's date in San Francisco as "YYYY-MM-DD" — the `min` for a date input. */
export function laToday(now: Date = new Date()): string {
  // en-CA gives ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Is this pickup far enough in the future? Enforced in the UI for feedback and
 * again at the API boundary, because the UI check is trivially bypassed.
 */
export function meetsLeadTime(iso: string, now: Date = new Date()): boolean {
  const pickup = new Date(iso).getTime();
  if (Number.isNaN(pickup)) return false;
  return pickup - now.getTime() >= MIN_LEAD_TIME_HOURS * 3_600_000;
}

/** Earliest bookable instant, as an ISO string — for error messages. */
export function earliestPickupISO(now: Date = new Date()): string {
  return new Date(now.getTime() + MIN_LEAD_TIME_HOURS * 3_600_000).toISOString();
}
