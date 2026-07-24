/**
 * Trips — the SILENT dispatch backend.
 *
 * SERVER ONLY. This module is the DB side of Stage E. It exists so the system
 * can do two things the owner never sees a dashboard for:
 *
 *   1. RECORD every paid ride as a `trip` row (written by the payment webhook).
 *   2. DETECT a double booking when the owner assigns a driver/vehicle in GHL —
 *      i.e. the same driver (or the same car) booked for two overlapping rides.
 *
 * The owner's cockpit is GoHighLevel. Nothing here renders a website dashboard;
 * the DB is invisible infrastructure. A detected clash surfaces to the owner as
 * an email + a "Possible Double Booking" GHL stage — handled by the dispatch
 * route and a GHL workflow, NOT here. See ARCHITECTURE.md §10.
 *
 * All datetimes are stored as TIMESTAMPTZ (an absolute instant), so an
 * offset-carrying ISO string in ("…-07:00") and out is compared correctly
 * regardless of the server's own timezone. See lib/datetime.ts.
 */

import "server-only";
import { sql } from "@/lib/db";
import { rideEndISO } from "@/lib/ghl";
import { laDayOf } from "@/lib/datetime";
import type { BookingMetadata } from "@/lib/booking-schema";

/* ══════════════════════════════════════════════════════════════════════════
 * Types
 * ══════════════════════════════════════════════════════════════════════════ */

export type TripRow = {
  id: string;
  external_id: string;
  ghl_contact_id: string;
  ghl_opportunity_id: string;
  customer_name: string;
  pickup_at: string; // ISO
  ends_at: string; // ISO
  pickup_location: string;
  dropoff_location: string;
  vehicle_class: string;
  driver_id: string | null;
  vehicle_id: string | null;
  status: string;
};

export type Driver = {
  id: string;
  name: string;
  phone: string;
  email: string;
};

/* ══════════════════════════════════════════════════════════════════════════
 * Write — called by the payment webhook
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Record a paid ride as a trip. Idempotent on `external_id`: a re-sent payment
 * callback UPDATES the same row rather than inserting a duplicate — exactly the
 * guarantee the GHL side already gives, extended to the DB.
 *
 * This is written INSIDE the verified payment webhook and, like the appointment
 * step there, is NON-FATAL to the caller: a trip-write failure must never lose a
 * booking. The webhook keeps the trip write in its own try/catch. Driver and
 * vehicle are intentionally left NULL here — assignment happens later in GHL.
 *
 * @param ghl ids obtained by the webhook, so dispatch can later flag the RIGHT
 *            opportunity without re-searching GHL.
 */
export async function upsertTrip(
  booking: BookingMetadata,
  ghl: { contactId: string; opportunityId: string },
): Promise<void> {
  const pickupAt = booking.pickup_datetime;
  const endsAt = rideEndISO(booking);

  await sql`
    INSERT INTO trip (
      id, external_id, ghl_contact_id, ghl_opportunity_id, customer_name,
      pickup_at, ends_at, pickup_location, dropoff_location, vehicle_class, status
    )
    VALUES (
      ${`trip-${booking.external_id}`}, ${booking.external_id},
      ${ghl.contactId}, ${ghl.opportunityId}, ${booking.contact_name},
      ${pickupAt}, ${endsAt}, ${booking.pickup_location},
      ${booking.dropoff_location}, ${booking.vehicle_class}, 'booked'
    )
    ON CONFLICT (external_id) DO UPDATE SET
      ghl_contact_id     = EXCLUDED.ghl_contact_id,
      ghl_opportunity_id = EXCLUDED.ghl_opportunity_id,
      customer_name      = EXCLUDED.customer_name,
      pickup_at          = EXCLUDED.pickup_at,
      ends_at            = EXCLUDED.ends_at,
      pickup_location    = EXCLUDED.pickup_location,
      dropoff_location   = EXCLUDED.dropoff_location,
      vehicle_class      = EXCLUDED.vehicle_class,
      updated_at         = now()
  `;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ADMIN DISPATCH — assign a driver to a CONFIRMED booking, with a HARD BLOCK.
 *
 * This is the owner-facing model (decided 2026-07-25) that SUPERSEDES the old
 * GHL "assign then warn" flow. The owner assigns a driver in the website admin;
 * the rule is ONE DRIVER = ONE TRIP PER LA CALENDAR DAY, and an assignment that
 * would break it is REFUSED at the source rather than flagged after the fact.
 * Because this is our own UI + API, we can actually block (GHL could only warn).
 *
 * "Per day" is deliberately stricter than "no time overlap": a same-day second
 * trip is refused even if the clock says it fits, because delays make same-day
 * doubles risky. This is the owner's explicit v1 choice.
 * ══════════════════════════════════════════════════════════════════════════ */

/** A driver, including whether they're active (the roster panel shows all). */
export type DriverRow = Driver & { active: boolean };

/** A confirmed booking row for the dispatch list, with its assigned driver. */
export type DispatchBooking = {
  external_id: string;
  customer_name: string;
  pickup_at: string; // ISO (offset-carrying)
  ends_at: string; // ISO
  pickup_location: string;
  dropoff_location: string;
  vehicle_class: string;
  status: string;
  driver_id: string | null;
  driver_name: string | null;
  ghl_opportunity_id: string;
};

/* ── Roster CRUD ─────────────────────────────────────────────────────────── */

/** All drivers (active first, then name) for the roster panel. */
export async function listDrivers(): Promise<DriverRow[]> {
  return (await sql`
    SELECT id, name, phone, email, active
    FROM driver
    ORDER BY active DESC, lower(name)
  `) as DriverRow[];
}

/** Active drivers only — what the assignment dropdown offers. */
export async function listActiveDrivers(): Promise<Driver[]> {
  return (await sql`
    SELECT id, name, phone, email FROM driver WHERE active ORDER BY lower(name)
  `) as Driver[];
}

/**
 * Add a driver. Generates a stable slug id from the name (+ a short random
 * suffix so two "John Smith"s don't collide). Returns the new row. Throws
 * DispatchError on a duplicate active name so the UI can show a clean message.
 */
export async function addDriver(input: {
  name: string;
  phone?: string;
  email?: string;
}): Promise<DriverRow> {
  const name = input.name.trim();
  if (!name) throw new DispatchError("A driver name is required.");

  // Guard the friendly case before hitting the partial unique index, so the
  // error is a clean message rather than a raw constraint violation.
  const existing = (await sql`
    SELECT id FROM driver WHERE active AND lower(name) = lower(${name}) LIMIT 1
  `) as Array<{ id: string }>;
  if (existing.length > 0) {
    throw new DispatchError(`A driver named "${name}" already exists.`);
  }

  const id = `drv-${slugify(name)}-${randomSuffix()}`;
  const rows = (await sql`
    INSERT INTO driver (id, name, phone, email)
    VALUES (${id}, ${name}, ${input.phone?.trim() ?? ""}, ${input.email?.trim() ?? ""})
    RETURNING id, name, phone, email, active
  `) as DriverRow[];
  return rows[0];
}

/** Edit a driver's details (not their id). Returns the updated row, or null if
 *  the id is unknown. */
export async function updateDriver(input: {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}): Promise<DriverRow | null> {
  const name = input.name.trim();
  if (!name) throw new DispatchError("A driver name is required.");

  // Don't let a rename collide with another ACTIVE driver.
  const clash = (await sql`
    SELECT id FROM driver
    WHERE active AND lower(name) = lower(${name}) AND id <> ${input.id}
    LIMIT 1
  `) as Array<{ id: string }>;
  if (clash.length > 0) {
    throw new DispatchError(`Another driver named "${name}" already exists.`);
  }

  const rows = (await sql`
    UPDATE driver
    SET name = ${name}, phone = ${input.phone?.trim() ?? ""}, email = ${input.email?.trim() ?? ""}
    WHERE id = ${input.id}
    RETURNING id, name, phone, email, active
  `) as DriverRow[];
  return rows[0] ?? null;
}

/**
 * Retire (soft-delete) or reactivate a driver. We never hard-delete: a retired
 * driver may still be referenced by past trips, and history must not break. A
 * retired driver drops out of the assignment dropdown but their name still shows
 * on the bookings they already have.
 */
export async function setDriverActive(id: string, active: boolean): Promise<DriverRow | null> {
  const rows = (await sql`
    UPDATE driver SET active = ${active} WHERE id = ${id}
    RETURNING id, name, phone, email, active
  `) as DriverRow[];
  return rows[0] ?? null;
}

/* ── Bookings list ───────────────────────────────────────────────────────── */

/**
 * Confirmed bookings for the dispatch board, soonest pickup first, joined to
 * their assigned driver's name. "Confirmed" = every trip we recorded, since the
 * payment webhook only writes a trip for a PAID booking (status starts 'booked'
 * and becomes 'assigned' once a driver is set — both belong on the board).
 */
export async function listConfirmedBookings(): Promise<DispatchBooking[]> {
  return (await sql`
    SELECT
      t.external_id, t.customer_name, t.pickup_at, t.ends_at,
      t.pickup_location, t.dropoff_location, t.vehicle_class, t.status,
      t.driver_id, d.name AS driver_name, t.ghl_opportunity_id
    FROM trip t
    LEFT JOIN driver d ON d.id = t.driver_id
    ORDER BY t.pickup_at ASC
  `) as DispatchBooking[];
}

/* ── Assign / unassign, with the per-day block ───────────────────────────── */

/** Raised for a clean, user-facing dispatch failure (bad input, name clash). */
export class DispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchError";
  }
}

export type AssignResult =
  | { ok: true; driver: Driver; opportunityId: string }
  | {
      ok: false;
      reason: "blocked";
      /** The other booking that already has this driver that day. */
      conflictRef: string;
      conflictCustomer: string;
      day: string; // "YYYY-MM-DD" (LA)
    }
  | { ok: false; reason: "no_such_booking" }
  | { ok: false; reason: "no_such_driver" };

/**
 * Assign a driver to a confirmed booking, ENFORCING one-trip-per-LA-day.
 *
 * The check and the write must not race: two admins (or a double-click) could
 * both pass the check then both write. So we do it in a single statement — an
 * UPDATE whose WHERE clause includes "no OTHER same-day trip has this driver".
 * If that pre-condition fails the UPDATE touches zero rows, and we then report
 * exactly which booking blocked it. This is atomic at the row level in Postgres.
 *
 * @returns a structured result the API turns into 200 (ok), 409 (blocked), or
 *          404 (unknown booking/driver). Never throws for those cases.
 */
export async function assignDriverForDay(input: {
  externalId: string;
  driverId: string;
}): Promise<AssignResult> {
  // The booking must exist, and we need its LA day for the block.
  const bookingRows = (await sql`
    SELECT external_id, pickup_at, ghl_opportunity_id FROM trip WHERE external_id = ${input.externalId} LIMIT 1
  `) as Array<{ external_id: string; pickup_at: string; ghl_opportunity_id: string }>;
  if (bookingRows.length === 0) return { ok: false, reason: "no_such_booking" };
  const booking = bookingRows[0];

  // The driver must exist and be active (can't assign a retired driver).
  const driverRows = (await sql`
    SELECT id, name, phone, email FROM driver WHERE id = ${input.driverId} AND active LIMIT 1
  `) as Driver[];
  if (driverRows.length === 0) return { ok: false, reason: "no_such_driver" };
  const driver = driverRows[0];

  const day = laDayOf(booking.pickup_at);

  // Atomic assign-if-free: assign the driver ONLY IF they have no OTHER trip on
  // the same LA day. The day comparison happens in SQL against each candidate
  // trip's pickup, converted to the America/Los_Angeles date. Reassigning the
  // SAME booking to the SAME driver is a no-op that still succeeds (it is not
  // "another" trip — excluded by external_id).
  const assigned = (await sql`
    UPDATE trip
    SET driver_id = ${driver.id}, status = 'assigned', updated_at = now()
    WHERE external_id = ${input.externalId}
      AND NOT EXISTS (
        SELECT 1 FROM trip other
        WHERE other.driver_id = ${driver.id}
          AND other.external_id <> ${input.externalId}
          AND (other.pickup_at AT TIME ZONE 'America/Los_Angeles')::date
              = (${booking.pickup_at}::timestamptz AT TIME ZONE 'America/Los_Angeles')::date
      )
    RETURNING external_id
  `) as Array<{ external_id: string }>;

  if (assigned.length === 1) {
    return { ok: true, driver, opportunityId: booking.ghl_opportunity_id };
  }

  // Blocked — find WHICH booking already holds this driver that day, to explain.
  const conflictRows = (await sql`
    SELECT external_id, customer_name FROM trip
    WHERE driver_id = ${driver.id}
      AND external_id <> ${input.externalId}
      AND (pickup_at AT TIME ZONE 'America/Los_Angeles')::date
          = (${booking.pickup_at}::timestamptz AT TIME ZONE 'America/Los_Angeles')::date
    LIMIT 1
  `) as Array<{ external_id: string; customer_name: string }>;

  const conflict = conflictRows[0];
  return {
    ok: false,
    reason: "blocked",
    conflictRef: conflict?.external_id ?? "(unknown)",
    conflictCustomer: conflict?.customer_name ?? "another booking",
    day,
  };
}

/** Remove a driver from a booking, freeing that driver's day. Returns the
 *  booking's opportunity id (for the GHL sync), or null if unknown. */
export async function unassignDriver(
  externalId: string,
): Promise<{ opportunityId: string } | null> {
  const rows = (await sql`
    UPDATE trip
    SET driver_id = NULL, status = 'booked', updated_at = now()
    WHERE external_id = ${externalId}
    RETURNING ghl_opportunity_id
  `) as Array<{ ghl_opportunity_id: string }>;
  if (rows.length === 0) return null;
  return { opportunityId: rows[0].ghl_opportunity_id ?? "" };
}

/* ── small helpers ───────────────────────────────────────────────────────── */

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 24) || "driver"
  );
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}
