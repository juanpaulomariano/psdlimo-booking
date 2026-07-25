/**
 * POST /api/checkout — create a payment invoice for a booking.
 *
 * THE PRICE IS RECOMPUTED HERE. The request schema has no `total` field, so a
 * client-submitted price is not merely ignored — there is nowhere to put it.
 * The amount charged comes from lib/pricing.ts, fed by a fresh Routes API
 * lookup, exactly as /api/quote does it. Tampering with the browser changes the
 * displayed number and nothing else. See the project invariants (invariant 1).
 *
 * This route creates NO CRM record. GoHighLevel is written only from the
 * verified payment callback — paid ⇔ exists in GHL. An abandoned invoice must
 * leave zero trace. See the project invariants (invariant 2).
 */

import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { checkoutRequestSchema, type BookingMetadata } from "@/lib/booking-schema";
import { calculatePrice } from "@/lib/pricing";
import { getRateCard } from "@/lib/rates-source";
import { RoutingError, getDrivingRoute } from "@/lib/maps";
import { PaymentError, createInvoice } from "@/lib/payments";
import {
  MIN_LEAD_TIME_HOURS,
  deriveBookingTags,
  getFlatRoute,
  getVehicleClass,
} from "@/config/rates";
import { formatPickupShort, meetsLeadTime } from "@/lib/datetime";

export async function POST(request: Request) {
  // ── Parse ────────────────────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = checkoutRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Those booking details are not valid.", details: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { ride, contact } = parsed.data;

  // ── Lead time, re-checked at the money boundary ──────────────────────────
  if (!meetsLeadTime(ride.pickupAt)) {
    return NextResponse.json(
      { error: `Pickups must be booked at least ${MIN_LEAD_TIME_HOURS} hours in advance.` },
      { status: 400 },
    );
  }

  // ── Distance: a FRESH lookup, not a value carried from the quote ─────────
  let distanceMiles: number | null = null;
  let durationMinutes: number | null = null;
  if (ride.rideType === "distance") {
    try {
      const route = await getDrivingRoute(ride.pickup, ride.dropoff);
      distanceMiles = route.distanceMiles;
      // Carried into metadata so the webhook can compute the appointment END
      // without a second Routes call.
      durationMinutes = route.durationMinutes;
    } catch (err) {
      if (err instanceof RoutingError) {
        const status = err.code === "INVALID_ADDRESS" || err.code === "NO_ROUTE" ? 400 : 502;
        console.error(`[checkout] routing failed (${err.code}): ${err.message}`);
        return NextResponse.json({ error: err.message }, { status });
      }
      throw err;
    }
  }

  // ── Price ────────────────────────────────────────────────────────────────
  let breakdown: ReturnType<typeof calculatePrice>;
  try {
    // Same DB-backed rate card the quote used — recomputed server-side at payment
    // time. The owner's current rates are the ones charged.
    const rateCard = await getRateCard();
    breakdown = calculatePrice(ride, distanceMiles, rateCard);
  } catch (err) {
    console.error("[checkout] pricing failed:", err);
    return NextResponse.json({ error: "Could not price that ride." }, { status: 500 });
  }

  /*
   * ── external_id: generated exactly ONCE, here ──────────────────────────
   * One value doing three jobs: the booking reference shown to the customer,
   * the idempotency key that stops duplicate callbacks creating duplicate
   * opportunities, and the join key across the payment dashboard and our logs.
   * Generating it in a second place would quietly break all three.
   */
  const externalId = `psdlimo-${Date.now()}-${nanoid(8)}`;

  // ── Derive display strings, duration, and the full tag set ───────────────
  // Narrow on rideType so the union's per-variant fields are accessible.
  let pickupLocation: string;
  let dropoffLocation: string;
  let isAirportFlatRoute = false;

  switch (ride.rideType) {
    case "flat": {
      const flatRoute = getFlatRoute(ride.flatRouteId);
      pickupLocation = flatRoute.from;
      dropoffLocation = flatRoute.to;
      isAirportFlatRoute = flatRoute.isAirport;
      // A flat route makes no Routes call, so its duration comes from config.
      durationMinutes = flatRoute.durationMinutes;
      break;
    }
    case "distance":
      pickupLocation = ride.pickup;
      dropoffLocation = ride.dropoff;
      // durationMinutes already captured from the Routes lookup above.
      break;
    case "hourly":
      pickupLocation = ride.pickup;
      dropoffLocation = "As directed";
      // hourly rides have no duration; the appointment END uses `hours`.
      break;
  }

  const company = (contact.company ?? "").trim().slice(0, 120);

  const tags = deriveBookingTags({
    rideType: ride.rideType,
    pickupLocation,
    dropoffLocation,
    passengers: ride.passengers,
    distanceMiles,
    isAirportFlatRoute,
    hasCompany: company.length > 0,
    // Only distance rides can be round trips (they carry an optional returnAt).
    isRoundTrip: ride.rideType === "distance" && Boolean(ride.returnAt),
  });

  const vehicleLabel = getVehicleClass(ride.vehicleClass).label;

  /*
   * ── Metadata: this demo's entire "database" ────────────────────────────
   * There is no datastore. Everything the CRM needs must survive the round trip
   * through the payment provider inside this object, so it is written once here
   * and validated on the way back out by bookingMetadataSchema.
   *
   * specialRequests is user free-text: capped at 400 in the UI AND truncated
   * here. The UI limit is a courtesy; this one is the actual guarantee.
   */
  const metadata: BookingMetadata = {
    external_id: externalId,
    ride_type: ride.rideType,
    pickup_location: pickupLocation,
    dropoff_location: dropoffLocation,
    pickup_datetime: ride.pickupAt,
    return_datetime: ride.rideType === "distance" && ride.returnAt ? ride.returnAt : "",
    vehicle_class: ride.vehicleClass,
    passengers: ride.passengers,
    luggage: ride.luggage,
    hours: ride.rideType === "hourly" ? ride.hours : null,
    duration_minutes: durationMinutes,
    addons: ride.addOns.join(","),
    flight_number: (contact.flightNumber ?? "").slice(0, 16),
    special_requests: (contact.specialRequests ?? "").slice(0, 400),
    company_name: company,
    quoted_total: breakdown.total,
    currency: breakdown.currency,
    breakdown_json: JSON.stringify(breakdown.lines),
    contact_name: contact.name,
    contact_email: contact.email,
    contact_phone: contact.phone,
    tags_csv: tags.join(","),
  };

  // ── Create the invoice ───────────────────────────────────────────────────
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  try {
    const invoice = await createInvoice({
      externalId,
      amountUSD: breakdown.total,
      customer: { name: contact.name, email: contact.email, phone: contact.phone },
      description: `${vehicleLabel} · ${formatPickupShort(ride.pickupAt)} · ${pickupLocation} → ${dropoffLocation}`,
      metadata,
      successUrl: `${baseUrl}/success?ref=${encodeURIComponent(externalId)}`,
      failureUrl: `${baseUrl}/cancelled?ref=${encodeURIComponent(externalId)}`,
    });

    console.log(
      `[checkout] invoice created ${externalId} — $${breakdown.total} USD ` +
        `charged as ${invoice.chargedAmount} ${invoice.chargedCurrency} (provider ${invoice.providerInvoiceId})`,
    );

    return NextResponse.json({
      invoiceUrl: invoice.invoiceUrl,
      reference: externalId,
      total: breakdown.total,
      currency: breakdown.currency,
      chargedAmount: invoice.chargedAmount,
      chargedCurrency: invoice.chargedCurrency,
    });
  } catch (err) {
    if (err instanceof PaymentError) {
      console.error(`[checkout] payment provider error (${err.code}): ${err.message}`, err.detail ?? "");
      return NextResponse.json(
        { error: "We could not start your payment. Please try again in a moment." },
        { status: 502 },
      );
    }
    throw err;
  }
}
