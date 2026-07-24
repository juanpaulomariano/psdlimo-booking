/**
 * POST /api/dispatch/assign — the driver-assignment webhook.
 *
 * The owner assigns a driver to a booking INSIDE GoHighLevel. A GHL workflow
 * (wired in Stage A') fires an outbound webhook here carrying the booking
 * reference and the driver name the owner chose. This route:
 *
 *   1. Authenticates the caller with a shared secret (constant-time) BEFORE
 *      reading the body — same discipline as the payment webhook.
 *   2. Resolves the driver name against the DB roster.
 *   3. Records the assignment on the trip and checks for a time clash — the same
 *      driver (or car) booked for two overlapping rides.
 *   4. On a clash: moves the opportunity to the "Possible Double Booking" GHL
 *      stage (a GHL workflow on that stage sends the owner the alert email).
 *
 * WARNING-AFTER, not a hard block: GHL cannot be prevented from assigning, so
 * the contract's double-booking requirement is met as automated DETECTION +
 * ALERT, not prevention. See ARCHITECTURE.md §10.
 *
 * Status codes — each a decision:
 *   401  bad/missing dispatch token         (reject; not a trusted caller)
 *   200  assigned, no clash                 (success, clean)
 *   200  assigned, CLASH flagged            (success — the clash IS the outcome)
 *   200  driver name not on the roster      (acknowledge; nothing to check)
 *   200  no such booking                    (acknowledge; nothing to assign)
 *   400  unparseable / invalid body         (retry cannot fix it)
 *   500  DB or GHL failure                  (recoverable — let GHL retry)
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/db";
import {
  assignDriverAndDetectClashes,
  getTripOpportunityId,
  resolveDriverByName,
  type Clash,
} from "@/lib/trips";
import { flagPossibleDoubleBooking, GHLError } from "@/lib/ghl";

/**
 * Authenticate the GHL outbound webhook with a shared secret in the
 * `x-dispatch-token` header. Constant-time comparison — a plain `===` leaks the
 * token one byte at a time under timing analysis. Fails closed: a missing
 * server secret rejects everything rather than waving all callers through.
 *
 * This is a SEPARATE secret from XENDIT_CALLBACK_TOKEN by design — two different
 * callers (Xendit vs GHL), two different trust boundaries; compromising one must
 * not grant the other.
 */
function verifyDispatchToken(headers: Headers): boolean {
  const expected = process.env.DISPATCH_WEBHOOK_TOKEN;
  if (!expected) {
    console.error(
      "[dispatch] DISPATCH_WEBHOOK_TOKEN is not set — rejecting all assign webhooks. " +
        "Set it in the env and configure the GHL outbound webhook to send it as x-dispatch-token.",
    );
    return false;
  }
  const received = headers.get("x-dispatch-token");
  if (!received) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // length is not the secret
  return timingSafeEqual(a, b);
}

/**
 * The assignment payload GHL sends. Kept minimal and tolerant: GHL webhook
 * bodies vary, so we accept the booking reference under a couple of likely keys
 * and the driver by name (the owner picks a name in GHL, not our internal id).
 * An optional vehicle id lets the same-car clash check run when the owner also
 * records a car.
 */
const assignSchema = z.object({
  external_id: z.string().trim().min(1, "external_id (booking reference) is required"),
  driver_name: z.string().trim().min(1, "driver_name is required"),
  vehicle_id: z.string().trim().optional(),
});

export async function POST(request: Request) {
  /* ── 1. Authenticate FIRST ────────────────────────────────────────────── */
  if (!verifyDispatchToken(request.headers)) {
    console.warn("[dispatch] rejected: missing or invalid x-dispatch-token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A DB is mandatory for dispatch (unlike the payment webhook, which can still
  // reach GHL without one). Say so clearly rather than throwing an opaque error.
  if (!isDatabaseConfigured()) {
    console.error("[dispatch] no DATABASE_URL — cannot run the double-booking check.");
    return NextResponse.json(
      { error: "Dispatch is not available: no database configured." },
      { status: 500 },
    );
  }

  /* ── 2. Parse ─────────────────────────────────────────────────────────── */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[dispatch] invalid assign payload:", JSON.stringify(parsed.error.issues));
    return NextResponse.json(
      { error: "Invalid assignment payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { external_id, driver_name, vehicle_id } = parsed.data;

  try {
    /* ── 3. Resolve the driver against the roster ─────────────────────────── */
    const driver = await resolveDriverByName(driver_name);
    if (!driver) {
      // Not an error: the owner may have typed a name not in the roster yet.
      // Acknowledge so GHL does not retry, and make it visible in logs.
      console.warn(
        `[dispatch] no active driver matches "${driver_name}" for ${external_id} — ` +
          `assignment not recorded, no clash check run.`,
      );
      return NextResponse.json({
        received: true,
        assigned: false,
        reason: "driver_not_on_roster",
        driver_name,
      });
    }

    /* ── 4. Assign + detect clashes ───────────────────────────────────────── */
    const clashes = await assignDriverAndDetectClashes({
      externalId: external_id,
      driverId: driver.id,
      vehicleId: vehicle_id ?? null,
    });

    if (clashes === null) {
      // The trip does not exist — a stray assign for a booking we never recorded.
      console.warn(`[dispatch] no trip for ${external_id} — nothing to assign.`);
      return NextResponse.json({
        received: true,
        assigned: false,
        reason: "no_such_booking",
        external_id,
      });
    }

    if (clashes.length === 0) {
      console.log(
        `[dispatch] ${external_id} assigned to ${driver.name}` +
          `${vehicle_id ? ` / ${vehicle_id}` : ""} — no clash.`,
      );
      return NextResponse.json({
        received: true,
        assigned: true,
        driver: driver.name,
        clash: false,
      });
    }

    /* ── 5. CLASH — flag the opportunity in GHL ───────────────────────────── */
    const flagged = await flagBooking(external_id, driver.name, clashes);

    return NextResponse.json({
      received: true,
      assigned: true,
      driver: driver.name,
      clash: true,
      clashesWith: clashes.map((c) => c.external_id),
      opportunityFlagged: flagged,
    });
  } catch (err) {
    // DB or GHL failure — recoverable, so 500 and let GHL retry. The assignment
    // may have been written; the clash query and re-flag are both idempotent.
    if (err instanceof GHLError) {
      console.error(
        `[dispatch] GHL failure flagging ${external_id}: status ${err.status ?? "n/a"} — ${err.body ?? err.message}`,
      );
    } else {
      console.error(`[dispatch] failure handling assign for ${external_id}:`, err);
    }
    return NextResponse.json(
      { error: "Could not complete the assignment", reference: external_id },
      { status: 500 },
    );
  }
}

/**
 * Look up the opportunity id for a clashing trip and move it to the Possible
 * Double Booking stage. The trip carries `ghl_opportunity_id` (recorded by the
 * payment webhook), so no GHL search is needed. Returns whether the flag stuck
 * (false when the stage is not configured yet — Stage A').
 */
async function flagBooking(
  externalId: string,
  driverName: string,
  clashes: Clash[],
): Promise<boolean> {
  // The trip whose assignment triggered the clash is the one we flag. Its
  // opportunity id was stored at booking time, so no GHL search is needed.
  const opportunityId = await getTripOpportunityId(externalId);

  const conflictList = clashes
    .map((c) => `${c.external_id} (${c.customer_name}, ${c.reason})`)
    .join("; ");
  console.warn(
    `[dispatch] DOUBLE BOOKING: ${driverName} assigned to ${externalId} clashes with ${conflictList}`,
  );

  if (!opportunityId) {
    console.error(
      `[dispatch] clash detected for ${externalId} but its trip has no ghl_opportunity_id — cannot flag.`,
    );
    return false;
  }
  return flagPossibleDoubleBooking(opportunityId);
}
