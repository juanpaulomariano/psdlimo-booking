/**
 * GET /api/admin/dispatch — the dispatch board data (admin only).
 *
 * Returns the confirmed bookings and the full driver roster in one payload, so
 * the admin page renders in a single request. Every field the UI needs to show
 * a booking, its assigned driver, and the assignment dropdown is here.
 *
 * SECURITY: gated by requireAdmin() before any data is read. A logged-out or
 * non-admin caller gets 403 and sees nothing.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { listConfirmedBookings, listDrivers } from "@/lib/trips";

export async function GET() {
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

  const [bookings, drivers] = await Promise.all([listConfirmedBookings(), listDrivers()]);
  return NextResponse.json({ bookings, drivers });
}
