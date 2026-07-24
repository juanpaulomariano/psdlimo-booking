/**
 * POST /api/quote — live price for a ride.
 *
 * Read-only: creates nothing, charges nothing, writes nothing to the CRM. The
 * customer's browser calls this on every meaningful edit (vehicle change,
 * add-on toggle) to keep the displayed price current.
 *
 * The price shown here is NOT trusted later. /api/checkout recomputes from the
 * same engine at payment time — this route exists purely to render a number.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { quoteRequestSchema } from "@/lib/booking-schema";
import { calculatePrice } from "@/lib/pricing";
import { getRateCard } from "@/lib/rates-source";
import { RoutingError, getDrivingRoute } from "@/lib/maps";
import { MIN_LEAD_TIME_HOURS, getFlatRoute } from "@/config/rates";
import { meetsLeadTime } from "@/lib/datetime";

export type QuoteResponse = {
  breakdown: ReturnType<typeof calculatePrice>;
  distanceMiles: number | null;
  durationMinutes: number | null;
  /** True when the distance came from the mock — the UI surfaces this in dev. */
  mocked: boolean;
};

export async function POST(request: Request) {
  // ── Parse ────────────────────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = quoteRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Those ride details are not valid.",
        details: z.treeifyError(parsed.error),
      },
      { status: 400 },
    );
  }

  const { ride } = parsed.data;

  // ── Lead time ────────────────────────────────────────────────────────────
  // Re-checked here because the UI's check is trivially bypassed.
  if (!meetsLeadTime(ride.pickupAt)) {
    return NextResponse.json(
      { error: `Pickups must be booked at least ${MIN_LEAD_TIME_HOURS} hours in advance.` },
      { status: 400 },
    );
  }

  // ── Distance (only distance rides hit Google) ────────────────────────────
  let distanceMiles: number | null = null;
  let durationMinutes: number | null = null;
  let mocked = false;

  if (ride.rideType === "distance") {
    try {
      const route = await getDrivingRoute(ride.pickup, ride.dropoff);
      distanceMiles = route.distanceMiles;
      durationMinutes = route.durationMinutes;
      mocked = route.mocked;
    } catch (err) {
      if (err instanceof RoutingError) {
        // A bad address is the customer's to fix (400); anything else is ours (502).
        const status = err.code === "INVALID_ADDRESS" || err.code === "NO_ROUTE" ? 400 : 502;
        console.error(`[quote] routing failed (${err.code}): ${err.message}`);
        return NextResponse.json({ error: err.message, code: err.code }, { status });
      }
      throw err;
    }
  }

  // Flat routes have a known distance conceptually, but the price is fixed, so
  // no Google call is made. Duration is left null — nothing displays it.
  if (ride.rideType === "flat") {
    // Validates the id early; getFlatRoute throws on an unknown id.
    getFlatRoute(ride.flatRouteId);
  }

  // ── Price ────────────────────────────────────────────────────────────────
  let breakdown: ReturnType<typeof calculatePrice>;
  try {
    // Rates from the DB (owner-editable), with last-good/code fallback so a DB
    // hiccup never breaks a quote.
    const rateCard = await getRateCard();
    breakdown = calculatePrice(ride, distanceMiles, rateCard);
  } catch (err) {
    console.error("[quote] pricing failed:", err);
    return NextResponse.json({ error: "Could not price that ride." }, { status: 500 });
  }

  const body: QuoteResponse = { breakdown, distanceMiles, durationMinutes, mocked };
  return NextResponse.json(body);
}
