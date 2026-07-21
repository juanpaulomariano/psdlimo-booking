/**
 * POST /api/xendit-webhook — the only route that writes to the CRM.
 *
 * This handler is the hinge of the whole system, so the ordering below is
 * deliberate and each step exists for a reason:
 *
 *   1. VERIFY THE TOKEN BEFORE READING THE BODY. An unauthenticated request
 *      should never have its payload parsed, let alone acted on.
 *   2. Return 200 for anything we do not act on (EXPIRED, PENDING, unknown
 *      shapes). A non-200 makes the provider retry a callback we are
 *      deliberately ignoring — forever.
 *   3. Check idempotency before creating anything. A re-sent callback must not
 *      produce a second booking.
 *   4. Return 500 on a CRM failure so the provider retries. Never catch-and-200:
 *      that turns a recoverable outage into a silently lost booking.
 *
 * Status-code summary — every one of these is a decision, not a default:
 *   401  bad or missing callback token          (do not retry; it is not ours)
 *   200  verified but not actionable            (do not retry; nothing to do)
 *   200  verified, already recorded             (do not retry; idempotent)
 *   200  verified, booking created              (success)
 *   400  verified but the payload is unusable   (retrying cannot fix bad data)
 *   500  CRM failed                             (RETRY — this is recoverable)
 */

import { NextResponse } from "next/server";
import { bookingMetadataSchema } from "@/lib/booking-schema";
import { parseCallback, verifyCallback } from "@/lib/payments";
import { GHLError, pushBookingToGHL } from "@/lib/ghl";

export async function POST(request: Request) {
  /* ── 1. Authenticate FIRST, before touching the body ──────────────────── */
  if (!verifyCallback(request.headers)) {
    console.warn("[webhook] rejected: missing or invalid x-callback-token");
    // Deliberately terse. A detailed error would help an attacker probe.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* ── 2. Parse ─────────────────────────────────────────────────────────── */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.error("[webhook] verified request had an unparseable body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = parseCallback(body);

  if (!event) {
    // EXPIRED lands here, and that is CORRECT: an abandoned invoice leaves no
    // CRM record by design. 200 so the provider stops sending it.
    const status =
      typeof body === "object" && body !== null && "status" in body
        ? String((body as { status: unknown }).status)
        : "unknown";
    console.log(`[webhook] acknowledged non-actionable callback (status: ${status})`);
    return NextResponse.json({ received: true, acted: false });
  }

  /* ── 3. Validate the booking payload ──────────────────────────────────── */
  const parsed = bookingMetadataSchema.safeParse(event.metadata);

  if (!parsed.success) {
    // The invoice metadata IS the booking — there is no database to fall back
    // on. If it is malformed, retrying will not help, so 400 rather than 500.
    console.error(
      `[webhook] PAID callback ${event.externalId} has unusable metadata:`,
      JSON.stringify(parsed.error.issues),
    );
    return NextResponse.json({ error: "Booking metadata is not valid" }, { status: 400 });
  }

  const booking = parsed.data;

  // The metadata is attacker-influenced only if the token was forged, which we
  // have already ruled out. Still worth asserting: a mismatch means the invoice
  // and its payload disagree, which should never happen.
  if (booking.external_id !== event.externalId) {
    console.error(
      `[webhook] external_id mismatch: callback says "${event.externalId}", ` +
        `metadata says "${booking.external_id}"`,
    );
    return NextResponse.json({ error: "Booking reference mismatch" }, { status: 400 });
  }

  /* ── 4. Push to the CRM ───────────────────────────────────────────────── */
  try {
    const result = await pushBookingToGHL(booking);

    if (!result.created) {
      console.log(`[webhook] ${booking.external_id} was already recorded — no duplicate created`);
      return NextResponse.json({
        received: true,
        acted: false,
        reason: "already_recorded",
        opportunityId: result.opportunityId,
      });
    }

    console.log(
      `[webhook] ${booking.external_id} recorded — contact ${result.contactId}, ` +
        `opportunity ${result.opportunityId}, $${booking.quoted_total}`,
    );

    return NextResponse.json({
      received: true,
      acted: true,
      contactId: result.contactId,
      opportunityId: result.opportunityId,
    });
  } catch (err) {
    /*
     * 500 ON PURPOSE. The payment succeeded but the CRM did not record it, so
     * the provider must retry. Returning 200 here would acknowledge a booking
     * that exists nowhere — money taken, no record.
     *
     * If retries are exhausted, the callback can be re-sent manually from the
     * Xendit dashboard. The idempotency check makes that always safe.
     */
    if (err instanceof GHLError) {
      console.error(
        `[webhook] CRM write FAILED for ${booking.external_id} — returning 500 so Xendit retries.\n` +
          `  status: ${err.status ?? "n/a"}\n  message: ${err.message}\n  body: ${err.body ?? "n/a"}`,
      );
    } else {
      console.error(`[webhook] unexpected failure for ${booking.external_id}:`, err);
    }

    return NextResponse.json(
      { error: "Could not record the booking", reference: booking.external_id },
      { status: 500 },
    );
  }
}

/**
 * Xendit only ever POSTs here. A GET is usually a human checking the URL is
 * live, so answer helpfully without revealing anything.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "xendit-webhook",
    note: "This endpoint accepts POST callbacks with a valid x-callback-token header.",
  });
}
