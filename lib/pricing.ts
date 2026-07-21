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
  BASE_FARE,
  CURRENCY,
  MINIMUM_FARE,
  MIN_HOURS,
  PER_HOUR,
  PER_MILE,
  SERVICE_FEE_PCT,
  getAddOn,
  getFlatRoute,
  getVehicleClass,
  type AddOnId,
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
 */
export function calculatePrice(ride: RideDetails, distanceMiles: number | null): PriceBreakdown {
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
      const distanceCharge = round2(usedDistance * PER_MILE);
      lines.push({ key: "base", label: "Base fare", amount: BASE_FARE });
      lines.push({
        key: "distance",
        label: `Distance (${usedDistance.toFixed(1)} mi × $${PER_MILE.toFixed(2)})`,
        amount: distanceCharge,
      });
      fareBasis = BASE_FARE + distanceCharge;
      break;
    }

    case "hourly": {
      // Schema enforces the minimum; clamping here too keeps the engine correct
      // in isolation, since it is called from more than one route.
      const hours = Math.max(ride.hours, MIN_HOURS);
      const hourlyCharge = round2(hours * PER_HOUR);
      lines.push({
        key: "hourly",
        label: `Hourly (${hours} hr${hours === 1 ? "" : "s"} × $${PER_HOUR.toFixed(2)})`,
        amount: hourlyCharge,
      });
      fareBasis = hourlyCharge;
      break;
    }

    case "flat": {
      const route = getFlatRoute(ride.flatRouteId);
      lines.push({ key: "flat", label: `Flat route — ${route.label}`, amount: route.price });
      fareBasis = route.price;
      break;
    }
  }

  // ── 2. Vehicle class multiplier ───────────────────────────────────────────
  // ASSUMPTION (config/rates.ts PRICING_ASSUMPTIONS): applies to flat routes too.
  const vehicle = getVehicleClass(ride.vehicleClass);
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
      const { label, price } = getAddOn(addOn.id);
      lines.push({ key: `addon-${addOn.id}`, label, amount: price });
      addOnTotal += price;
    }
  }

  // ── 4. Service & fees ─────────────────────────────────────────────────────
  const subtotal = round2(afterVehicle + addOnTotal);
  const serviceFee = round2(subtotal * SERVICE_FEE_PCT);

  // ── 5. Minimum fare floor, then round to whole USD ────────────────────────
  const beforeMinimum = round2(subtotal + serviceFee);
  const minimumApplied = beforeMinimum < MINIMUM_FARE;
  const total = Math.round(Math.max(beforeMinimum, MINIMUM_FARE));

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
