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
 * Driver / vehicle resolution
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Resolve the driver the owner named in GHL against the roster. Matched
 * case-insensitively on name, among ACTIVE drivers only (a retired driver's
 * name should not silently resolve). Returns null when no active driver matches
 * — the dispatch route treats that as "cannot check" and says so, rather than
 * pretending the assignment is clash-free.
 */
export async function resolveDriverByName(name: string): Promise<Driver | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const rows = (await sql`
    SELECT id, name, phone, email
    FROM driver
    WHERE active AND lower(name) = lower(${trimmed})
    LIMIT 1
  `) as Driver[];
  return rows[0] ?? null;
}

/** The GHL opportunity id recorded for a booking, or null if unknown/empty.
 *  Lets the dispatch route flag the right opportunity without searching GHL. */
export async function getTripOpportunityId(externalId: string): Promise<string | null> {
  const rows = (await sql`
    SELECT ghl_opportunity_id FROM trip WHERE external_id = ${externalId} LIMIT 1
  `) as Array<{ ghl_opportunity_id: string }>;
  const id = rows[0]?.ghl_opportunity_id?.trim();
  return id ? id : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Assignment + clash detection
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * A trip that clashes with the one being assigned: same driver (or same
 * vehicle) whose time window overlaps.
 */
export type Clash = {
  external_id: string;
  customer_name: string;
  pickup_at: string;
  ends_at: string;
  reason: "driver" | "vehicle";
};

/**
 * Record a driver (and optionally a vehicle) onto a trip, then return any
 * clashes this assignment creates.
 *
 * Overlap test is the standard half-open interval intersection:
 *     A.start < B.end  AND  A.end > B.start
 * Two rides that merely touch end-to-start (one ends exactly when the next
 * begins) do NOT overlap — which is correct: back-to-back is allowed.
 *
 * The UPDATE and the clash query run against the same trip row, so a trip never
 * reports a clash with ITSELF (excluded by id). Returns the (possibly empty)
 * list of clashing trips — an empty list means the assignment is clean.
 *
 * @returns null if the trip does not exist; otherwise the clash list.
 */
export async function assignDriverAndDetectClashes(input: {
  externalId: string;
  driverId: string;
  vehicleId?: string | null;
}): Promise<Clash[] | null> {
  // 1. Assign. Guarded so we only touch a real trip and can tell the caller when
  //    the external_id is unknown (a stray/forged assign for a ride we never
  //    recorded — worth surfacing, not silently succeeding).
  const updated = (await sql`
    UPDATE trip
    SET driver_id = ${input.driverId},
        vehicle_id = ${input.vehicleId ?? null},
        status = 'assigned',
        updated_at = now()
    WHERE external_id = ${input.externalId}
    RETURNING id, pickup_at, ends_at
  `) as Array<{ id: string; pickup_at: string; ends_at: string }>;

  if (updated.length === 0) return null;
  const trip = updated[0];

  // 2. Driver clashes: any OTHER trip with the same driver whose window overlaps.
  const driverClashes = (await sql`
    SELECT external_id, customer_name, pickup_at, ends_at
    FROM trip
    WHERE driver_id = ${input.driverId}
      AND id <> ${trip.id}
      AND pickup_at < ${trip.ends_at}
      AND ends_at   > ${trip.pickup_at}
  `) as Array<Omit<Clash, "reason">>;

  // 3. Vehicle clashes: the same car double-booked (only if a vehicle was set).
  const vehicleClashes = input.vehicleId
    ? ((await sql`
        SELECT external_id, customer_name, pickup_at, ends_at
        FROM trip
        WHERE vehicle_id = ${input.vehicleId}
          AND id <> ${trip.id}
          AND pickup_at < ${trip.ends_at}
          AND ends_at   > ${trip.pickup_at}
      `) as Array<Omit<Clash, "reason">>)
    : [];

  // De-dupe: a trip that clashes on BOTH driver and vehicle should appear once,
  // labelled by whichever was found first (driver). Keyed by external_id.
  const byRef = new Map<string, Clash>();
  for (const c of driverClashes) byRef.set(c.external_id, { ...c, reason: "driver" });
  for (const c of vehicleClashes) {
    if (!byRef.has(c.external_id)) byRef.set(c.external_id, { ...c, reason: "vehicle" });
  }
  return [...byRef.values()];
}
