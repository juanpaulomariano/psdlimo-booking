/**
 * POST /api/admin/dispatch/assign — assign or unassign a driver (admin only).
 *
 * This is the HARD BLOCK in action. Assigning a driver who already has a trip on
 * the same LA calendar day is refused with 409 and a clear reason — the owner is
 * protected from double-booking a driver at the source, not warned afterwards.
 *
 * Body:
 *   { external_id, driver_id }          → assign (may be blocked)
 *   { external_id, driver_id: null }    → unassign
 *
 * On success, the driver assignment is mirrored to GHL one-way (name on the
 * Chauffeur Assigned field + move to the Assigned stage) so the owner still sees
 * it in their cockpit. That sync never fails the request — the admin DB is the
 * source of truth.
 *
 * SECURITY: requireAdmin() first; zod-validated body.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { assignDriverForDay, unassignDriver } from "@/lib/trips";
import { syncDriverAssignmentToGHL } from "@/lib/ghl";
import { formatLADay } from "@/lib/datetime";

const schema = z.object({
  external_id: z.string().trim().min(1).max(128),
  // null = unassign; a string = assign that driver.
  driver_id: z.string().trim().min(1).max(64).nullable(),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Dispatch is unavailable: no database is configured." },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid assignment request." }, { status: 400 });
  }
  const { external_id, driver_id } = parsed.data;

  /* ── Unassign ─────────────────────────────────────────────────────────── */
  if (driver_id === null) {
    const result = await unassignDriver(external_id);
    if (!result) {
      return NextResponse.json({ error: "That booking was not found." }, { status: 404 });
    }
    // Clear the driver in GHL and return the opportunity to Confirmed. Non-fatal.
    await syncDriverAssignmentToGHL(result.opportunityId, "");
    return NextResponse.json({ ok: true, assigned: false });
  }

  /* ── Assign (with the per-day block) ──────────────────────────────────── */
  const result = await assignDriverForDay({ externalId: external_id, driverId: driver_id });

  if (result.ok) {
    // Mirror to GHL: name + Assigned stage. Never fails the request.
    await syncDriverAssignmentToGHL(result.opportunityId, result.driver.name);
    return NextResponse.json({
      ok: true,
      assigned: true,
      driver: { id: result.driver.id, name: result.driver.name },
    });
  }

  if (result.reason === "blocked") {
    return NextResponse.json(
      {
        ok: false,
        reason: "blocked",
        message:
          `That driver is already assigned to booking ${result.conflictRef} ` +
          `(${result.conflictCustomer}) on ${formatLADay(result.day + "T12:00:00-07:00")}. ` +
          `A driver can only take one trip per day.`,
        conflictRef: result.conflictRef,
      },
      { status: 409 },
    );
  }

  if (result.reason === "no_such_booking") {
    return NextResponse.json({ error: "That booking was not found." }, { status: 404 });
  }
  // no_such_driver
  return NextResponse.json(
    { error: "That driver was not found or is no longer active." },
    { status: 404 },
  );
}
