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
  getTripGHLIds,
  resolveDriverByName,
  type Clash,
} from "@/lib/trips";
import { flagPossibleDoubleBooking, GHLError } from "@/lib/ghl";

/** Constant-time string compare that never throws on length mismatch (which
 *  would itself leak length). A plain `===` short-circuits on the first
 *  differing byte, and that timing is measurable enough to recover a secret. */
function tokensMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // length is not the secret
  return timingSafeEqual(a, b);
}

/**
 * Authenticate the dispatch webhook with a shared secret.
 *
 * Accepts the token from EITHER the `x-dispatch-token` header OR a `?token=`
 * query parameter. The header is preferred (query strings can appear in access
 * logs), but GHL's FREE workflow webhook action cannot set a custom header or a
 * dynamic body — only the URL accepts merge fields — so the query form is what
 * makes the no-cost GHL path possible. The token is rotatable and the endpoint
 * performs no destructive action, so query-string exposure is an acceptable
 * trade for staying off GHL's premium webhook.
 *
 * SEPARATE secret from XENDIT_CALLBACK_TOKEN by design — two callers, two trust
 * boundaries. Fails closed: a missing server secret rejects everything.
 */
function verifyDispatchToken(request: Request): boolean {
  const expected = process.env.DISPATCH_WEBHOOK_TOKEN;
  if (!expected) {
    console.error(
      "[dispatch] DISPATCH_WEBHOOK_TOKEN is not set — rejecting all assign webhooks. " +
        "Set it in the env and pass it as the x-dispatch-token header or ?token= query param.",
    );
    return false;
  }
  const received =
    request.headers.get("x-dispatch-token") ??
    new URL(request.url).searchParams.get("token");
  if (!received) return false;
  return tokensMatch(received, expected);
}

/**
 * The assignment payload. `external_id` is the booking reference; `driver_name`
 * is what the owner typed in GHL (we resolve it to a driver id ourselves). An
 * optional `vehicle_id` enables the same-car clash check.
 *
 * These can arrive as QUERY PARAMETERS (the GHL free-webhook path — everything
 * rides in the URL) or as a JSON BODY (the test harness / a future premium
 * webhook). readAssignInput() below merges the two, query taking precedence.
 */
const assignSchema = z.object({
  external_id: z.string().trim().min(1, "external_id (booking reference) is required"),
  driver_name: z.string().trim().min(1, "driver_name is required"),
  vehicle_id: z.string().trim().optional(),
});

/**
 * Collect the assignment fields from wherever the caller put them.
 *
 * GHL's free workflow webhook (verified 2026-07-25 by capturing a real fire)
 * sends a large contact/opportunity payload and nests our two fields under a
 * `customData` object:
 *   { contact_id, first_name, …, customData: { external_id, driver_name } }
 * It also carries the opportunity's `contact_id` at the TOP LEVEL, which we keep
 * so a clash can tag the exact contact even if our own trip record is stale.
 *
 * Precedence (later wins): JSON body top-level → body.customData → query string.
 * The test harness posts a flat top-level body; a future premium webhook could
 * send a flat body or query params. All paths resolve here so the handler below
 * never has to care which caller it was.
 */
async function readAssignInput(
  request: Request,
): Promise<{ fields: Record<string, unknown>; contactId: string | null }> {
  const q = new URL(request.url).searchParams;
  const fromQuery: Record<string, unknown> = {};
  for (const key of ["external_id", "driver_name", "vehicle_id"]) {
    const v = q.get(key);
    if (v !== null) fromQuery[key] = v;
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // No/non-JSON body — the query string carries the data.
  }

  const custom =
    body.customData && typeof body.customData === "object"
      ? (body.customData as Record<string, unknown>)
      : {};

  // GHL sends the opportunity's contact under `contact_id`.
  const contactId =
    typeof body.contact_id === "string" && body.contact_id.trim() ? body.contact_id.trim() : null;

  return {
    fields: { ...body, ...custom, ...fromQuery },
    contactId,
  };
}

export async function POST(request: Request) {
  /* ── 1. Authenticate FIRST ────────────────────────────────────────────── */
  if (!verifyDispatchToken(request)) {
    console.warn("[dispatch] rejected: missing or invalid dispatch token");
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

  /* ── 2. Parse (query string, JSON body, and/or GHL customData) ────────── */
  const { fields, contactId: ghlContactId } = await readAssignInput(request);

  const parsed = assignSchema.safeParse(fields);
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

    /* ── 5. CLASH — flag the contact in GHL ───────────────────────────────── */
    const flagged = await flagBooking(external_id, driver.name, clashes, ghlContactId);

    return NextResponse.json({
      received: true,
      assigned: true,
      driver: driver.name,
      clash: true,
      clashesWith: clashes.map((c) => c.external_id),
      flagged,
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
 * Flag a clashing booking in GHL by TAGGING its contact (not moving the stage —
 * see flagPossibleDoubleBooking for the why). A GHL workflow watching for the tag
 * emails the owner. Returns whether the flag stuck.
 *
 * The contact id comes from the trip record first (written by the payment
 * webhook), falling back to the `contact_id` GHL itself sent on the assign
 * webhook — so a clash is still flagged even if the trip predates contact-id
 * capture or was recorded without one.
 */
async function flagBooking(
  externalId: string,
  driverName: string,
  clashes: Clash[],
  ghlContactId: string | null,
): Promise<boolean> {
  const ids = await getTripGHLIds(externalId);
  const contactId = ids?.contactId || ghlContactId;

  const conflictList = clashes
    .map((c) => `${c.external_id} (${c.customer_name}, ${c.reason})`)
    .join("; ");
  console.warn(
    `[dispatch] DOUBLE BOOKING: ${driverName} assigned to ${externalId} clashes with ${conflictList}`,
  );

  if (!contactId) {
    console.error(
      `[dispatch] clash detected for ${externalId} but no contact id (trip nor payload) — cannot flag.`,
    );
    return false;
  }
  return flagPossibleDoubleBooking(contactId);
}
