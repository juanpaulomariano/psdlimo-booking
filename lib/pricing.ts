/**
 * Pricing engine.
 *
 * PURE FUNCTION — no fetches, no clock reads, no env access. Distance is passed
 * in by the caller (from lib/maps.ts). This is what makes it unit-testable and
 * lets /api/quote and /api/checkout share one implementation, guaranteeing the
 * displayed quote and the charged amount can never diverge.
 *
 * All rates come from config/rates.ts. No number is hardcoded here.
 */

import {
  ADD_ONS,
  CODE_RATE_CARD,
  CURRENCY,
  getFlatRoute,
  type AddOnId,
  type RateCard,
} from "@/config/rates";
import type { RideDetails } from "@/lib/booking-schema";

/** One row in the customer-visible price breakdown. */
export type PriceLine = {
  /** Stable identifier — for React keys and for tests, not for display. */
  key: string;
  /** Customer-facing label, e.g. "Distance (12.4 mi × $4.50)". */
  label: string;
  /** Whole-cent amount in USD. May be negative (e.g. minimum-fare top-up is positive). */
  amount: number;
};

export type PriceBreakdown = {
  lines: PriceLine[];
  /** Sum of fare components before the service fee. */
  subtotal: number;
  serviceFee: number;
  /** Final charge, whole USD. This is the number sent to the payment provider. */
  total: number;
  currency: typeof CURRENCY;
  /** Miles used for this quote; null for hourly and flat rides. */
  distanceMiles: number | null;
  /** True when MINIMUM_FARE floored the total — surfaced so the UI can explain it. */
  minimumApplied: boolean;
};

/** Money helper: 2dp, avoiding float drift like 0.1 + 0.2. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute the full price breakdown for a ride.
 *
 * @param ride     Validated ride details (zod-parsed by the caller).
 * @param distanceMiles Driving miles from the Routes API. Required for
 *   `rideType: "distance"`; ignored for hourly and flat rides. Passing null for
 *   a distance ride throws — a silent $0 mileage charge would be a pricing bug
 *   that reaches a real invoice.
 * @param rateCard The editable pricing numbers. Defaults to CODE_RATE_CARD (the
 *   config/rates.ts constants), so callers that pass nothing get identical
 *   behaviour. /api/quote and /api/checkout pass the DB-backed card so the owner
 *   can adjust rates. The engine stays PURE — the card is data passed in.
 */
export function calculatePrice(
  ride: RideDetails,
  distanceMiles: number | null,
  rateCard: RateCard = CODE_RATE_CARD,
): PriceBreakdown {
  const lines: PriceLine[] = [];
  let usedDistance: number | null = null;

  // ── 1. Fare basis: exactly one of distance | hourly | flat ────────────────
  let fareBasis = 0;

  switch (ride.rideType) {
    case "distance": {
      if (distanceMiles === null || !Number.isFinite(distanceMiles)) {
        throw new Error(
          "calculatePrice: distanceMiles is required for a distance ride. " +
            "Refusing to price a distance ride at zero miles.",
        );
      }
      usedDistance = round2(distanceMiles);
      const distanceCharge = round2(usedDistance * rateCard.perMile);
      lines.push({ key: "base", label: "Base fare", amount: rateCard.baseFare });
      lines.push({
        key: "distance",
        label: `Distance (${usedDistance.toFixed(1)} mi × $${rateCard.perMile.toFixed(2)})`,
        amount: distanceCharge,
      });
      fareBasis = rateCard.baseFare + distanceCharge;

      // Round trip: add a return leg (same base + distance) at the return
      // discount. The discount applies to the return leg only; the outbound is
      // full price. Both legs still get the vehicle multiplier below.
      if (ride.returnAt) {
        const oneWay = rateCard.baseFare + distanceCharge;
        const discount = Math.min(Math.max(rateCard.roundTripReturnDiscount, 0), 1);
        const returnLeg = round2(oneWay * (1 - discount));
        const pct = Math.round(discount * 100);
        lines.push({
          key: "return",
          label: pct > 0 ? `Return trip (−${pct}% off return)` : "Return trip",
          amount: returnLeg,
        });
        fareBasis += returnLeg;
      }
      break;
    }

    case "hourly": {
      // Schema enforces the minimum; clamping here too keeps the engine correct
      // in isolation, since it is called from more than one route.
      const hours = Math.max(ride.hours, rateCard.minHours);
      const hourlyCharge = round2(hours * rateCard.perHour);
      lines.push({
        key: "hourly",
        label: `Hourly (${hours} hr${hours === 1 ? "" : "s"} × $${rateCard.perHour.toFixed(2)})`,
        amount: hourlyCharge,
      });
      fareBasis = hourlyCharge;
      break;
    }

    case "flat": {
      // Flat-route prices are not yet DB-editable (a later slice); still from config.
      const route = getFlatRoute(ride.flatRouteId);
      lines.push({ key: "flat", label: `Flat route — ${route.label}`, amount: route.price });
      fareBasis = route.price;
      break;
    }
  }

  // ── 2. Vehicle class multiplier ───────────────────────────────────────────
  // ASSUMPTION (config/rates.ts PRICING_ASSUMPTIONS): applies to flat routes too.
  const vehicle = rateCard.vehicleMultipliers[ride.vehicleClass];
  if (!vehicle) {
    throw new Error(`calculatePrice: no rate-card entry for vehicle class "${ride.vehicleClass}".`);
  }
  const afterVehicle = round2(fareBasis * vehicle.multiplier);
  const vehicleAdjustment = round2(afterVehicle - fareBasis);

  if (vehicleAdjustment !== 0) {
    lines.push({
      key: "vehicle",
      label: `${vehicle.label} (×${vehicle.multiplier.toFixed(2)})`,
      amount: vehicleAdjustment,
    });
  }

  // ── 3. Add-ons (flat, post-multiplier) ────────────────────────────────────
  // Iterate ADD_ONS rather than ride.addOns so the breakdown order is stable
  // regardless of the order the customer toggled them in.
  let addOnTotal = 0;
  for (const addOn of ADD_ONS) {
    if (ride.addOns.includes(addOn.id as AddOnId)) {
      const priced = rateCard.addOnPrices[addOn.id];
      if (!priced) continue; // add-on not in the card (e.g. newly removed) — skip
      lines.push({ key: `addon-${addOn.id}`, label: priced.label, amount: priced.price });
      addOnTotal += priced.price;
    }
  }

  // ── 4. Service & fees ─────────────────────────────────────────────────────
  const subtotal = round2(afterVehicle + addOnTotal);
  const serviceFee = round2(subtotal * rateCard.serviceFeePct);

  // ── 5. Minimum fare floor, then round to whole USD ────────────────────────
  const beforeMinimum = round2(subtotal + serviceFee);
  const minimumApplied = beforeMinimum < rateCard.minimumFare;
  const total = Math.round(Math.max(beforeMinimum, rateCard.minimumFare));

  return {
    lines,
    subtotal,
    serviceFee,
    total,
    currency: CURRENCY,
    distanceMiles: usedDistance,
    minimumApplied,
  };
}
