/**
 * Pricing + datetime assertions. No test framework — plain assertions, run with
 * `npm run test:pricing`. Exits non-zero on the first failure.
 *
 * Every expected value below is computed BY HAND in the comment above it. That
 * is the whole point: if the engine and the hand-computation disagree, one of
 * them is wrong and we find out now rather than on an invoice.
 */

import assert from "node:assert/strict";
import { calculatePrice } from "@/lib/pricing";
import { rideDetailsSchema } from "@/lib/booking-schema";
import { MAX_PASSENGERS, VEHICLE_CLASSES, deriveBookingTags } from "@/config/rates";
import { addMinutesISO, formatPickup, laWallClockToISO, meetsLeadTime } from "@/lib/datetime";

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

const baseRide = {
  pickupAt: "2026-07-22T09:00:00-07:00",
  vehicleClass: "business",
  passengers: 2,
  luggage: 2,
  addOns: [],
} as const;

console.log("\nPricing engine\n");

// Business class, 10 mi:
//   base 45 + distance (10 × 4.50 = 45)          = 90.00
//   × 1.00 business                              = 90.00
//   + service fee 25% (22.50)                    = 112.50
//   above minimum 95 → round                     = 113
check("distance ride, business class, 10 mi → $113", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    rideType: "distance",
    pickup: "SFO, San Francisco, CA",
    dropoff: "Ritz-Carlton, San Francisco, CA",
  } as unknown);
  const r = calculatePrice(ride, 10);
  assert.equal(r.subtotal, 90);
  assert.equal(r.serviceFee, 22.5);
  assert.equal(r.total, 113);
  assert.equal(r.minimumApplied, false);
  assert.equal(r.distanceMiles, 10);
});

// First class, 10 mi:
//   base 45 + 45 = 90 × 1.45                     = 130.50 (adjustment +40.50)
//   + service fee 25% (32.625)                   = 163.125 → round = 163
check("distance ride, first class, 10 mi → $163", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    vehicleClass: "first",
    rideType: "distance",
    pickup: "SFO",
    dropoff: "Ritz-Carlton SF",
  } as unknown);
  const r = calculatePrice(ride, 10);
  assert.equal(r.subtotal, 130.5);
  assert.equal(r.total, 163);
  const vehicleLine = r.lines.find((l) => l.key === "vehicle");
  assert.ok(vehicleLine, "expected a vehicle adjustment line");
  assert.equal(vehicleLine.amount, 40.5);
});

// Business multiplier is 1.00 → no adjustment line should be emitted at all.
check("business class emits no vehicle-adjustment line", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    rideType: "distance",
    pickup: "100 Main St, San Francisco, CA",
    dropoff: "200 Market St, San Francisco, CA",
  } as unknown);
  const r = calculatePrice(ride, 10);
  assert.equal(r.lines.find((l) => l.key === "vehicle"), undefined);
});

// Minimum fare: 1 mi, business.
//   base 45 + 4.50 = 49.50 × 1.00 = 49.50
//   + 25% (12.375) = 61.875 → below minimum 95 → 95
check("very short ride is floored at the $95 minimum", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    rideType: "distance",
    pickup: "100 Main St, San Francisco, CA",
    dropoff: "200 Market St, San Francisco, CA",
  } as unknown);
  const r = calculatePrice(ride, 1);
  assert.equal(r.total, 95);
  assert.equal(r.minimumApplied, true);
});

// Hourly, 3 hrs, SUV/Van:
//   3 × 95 = 285 × 1.30 = 370.50
//   + 25% (92.625) = 463.125 → 463
check("hourly ride, 3 hrs, SUV/Van → $463", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    vehicleClass: "suv-van",
    rideType: "hourly",
    pickup: "Union Square, SF",
    hours: 3,
  } as unknown);
  const r = calculatePrice(ride, null);
  assert.equal(r.total, 463);
  assert.equal(r.distanceMiles, null, "hourly rides report no distance");
});

// Flat route SFO→Downtown ($120), business, + Meet & Greet ($25):
//   120 × 1.00 = 120, + 25 = 145
//   + 25% (36.25) = 181.25 → 181
check("flat route + add-on → $181", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    rideType: "flat",
    flatRouteId: "sfo-downtown-sf",
    addOns: ["meet-greet"],
  } as unknown);
  const r = calculatePrice(ride, null);
  assert.equal(r.subtotal, 145);
  assert.equal(r.total, 181);
});

// Add-ons are applied after the multiplier, so they are NOT multiplied.
// First class flat: 120 × 1.45 = 174, + 25 = 199, + 25% (49.75) = 248.75 → 249
check("add-ons are not multiplied by vehicle class", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    vehicleClass: "first",
    rideType: "flat",
    flatRouteId: "sfo-downtown-sf",
    addOns: ["meet-greet"],
  } as unknown);
  const r = calculatePrice(ride, null);
  assert.equal(r.subtotal, 199);
  assert.equal(r.total, 249);
});

check("breakdown line order is stable regardless of toggle order", () => {
  const mk = (addOns: string[]) =>
    calculatePrice(
      rideDetailsSchema.parse({
        ...baseRide,
        rideType: "flat",
        flatRouteId: "sfo-downtown-sf",
        addOns,
      } as unknown),
      null,
    );
  const a = mk(["extra-stop", "meet-greet"]).lines.map((l) => l.key);
  const b = mk(["meet-greet", "extra-stop"]).lines.map((l) => l.key);
  assert.deepEqual(a, b);
});

check("a distance ride with null miles throws rather than pricing at zero", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    rideType: "distance",
    pickup: "100 Main St, San Francisco, CA",
    dropoff: "200 Market St, San Francisco, CA",
  } as unknown);
  assert.throws(() => calculatePrice(ride, null), /distanceMiles is required/);
});

check("the sum of breakdown lines equals the subtotal", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    vehicleClass: "first",
    rideType: "distance",
    pickup: "100 Main St, San Francisco, CA",
    dropoff: "200 Market St, San Francisco, CA",
    addOns: ["meet-greet", "child-seat", "extra-stop"],
  } as unknown);
  const r = calculatePrice(ride, 17.3);
  const sum = r.lines.reduce((acc, l) => acc + l.amount, 0);
  assert.ok(
    Math.abs(sum - r.subtotal) < 0.01,
    `lines sum to ${sum} but subtotal is ${r.subtotal} — the customer would see a breakdown that does not add up`,
  );
});

console.log("\nSchema validation\n");

check("hourly ride below the 2-hour minimum is rejected", () => {
  const result = rideDetailsSchema.safeParse({
    ...baseRide,
    rideType: "hourly",
    pickup: "100 Main St, San Francisco, CA",
    hours: 1,
  });
  assert.equal(result.success, false);
});

check("a naive datetime without an offset is rejected", () => {
  const result = rideDetailsSchema.safeParse({
    ...baseRide,
    pickupAt: "2026-07-22T09:00:00", // no offset — the exact bug we guard against
    rideType: "flat",
    flatRouteId: "sfo-downtown-sf",
  });
  assert.equal(result.success, false);
});

check("passenger count above the largest vehicle capacity is rejected", () => {
  const result = rideDetailsSchema.safeParse({
    ...baseRide,
    passengers: 15, // max capacity is 14 (SUV/Van)
    rideType: "flat",
    flatRouteId: "sfo-downtown-sf",
  });
  assert.equal(result.success, false);
});

check("an unknown flat route id is rejected", () => {
  const result = rideDetailsSchema.safeParse({
    ...baseRide,
    rideType: "flat",
    flatRouteId: "sfo-to-narnia",
  });
  assert.equal(result.success, false);
});

console.log("\nTimezone handling\n");

// July 22 is PDT (UTC-7).
check("a July wall-clock time gets the -07:00 PDT offset", () => {
  assert.equal(laWallClockToISO("2026-07-22", "09:00"), "2026-07-22T09:00:00-07:00");
});

// January 22 is PST (UTC-8) — proves DST is read from the IANA db, not hardcoded.
check("a January wall-clock time gets the -08:00 PST offset", () => {
  assert.equal(laWallClockToISO("2026-01-22", "09:00"), "2026-01-22T09:00:00-08:00");
});

check("9:00 AM in San Francisco renders as 9:00 AM regardless of server zone", () => {
  const iso = laWallClockToISO("2026-07-22", "09:00");
  const rendered = formatPickup(iso);
  assert.ok(
    rendered.includes("9:00 AM"),
    `expected "9:00 AM" in "${rendered}" — a shifted time here means the CRM gets the wrong pickup`,
  );
  assert.ok(rendered.includes("PDT"), `expected the zone label in "${rendered}"`);
});

check("lead time rejects a pickup one hour from now, accepts one three hours out", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  assert.equal(meetsLeadTime("2026-07-22T13:00:00Z", now), false);
  assert.equal(meetsLeadTime("2026-07-22T15:00:00Z", now), true);
});

check("lead time rejects a pickup in the past", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  assert.equal(meetsLeadTime("2026-07-21T12:00:00Z", now), false);
});

console.log("\nVehicle capacity gating\n");

/**
 * Mirrors the effectiveVehicleClass derivation in BookingWizard.tsx. If these
 * two ever diverge the UI could quote a vehicle that cannot seat the party.
 */
function effectiveVehicleClass(selected: string, passengers: number): string {
  const found = VEHICLE_CLASSES.find((v) => v.id === selected);
  if (found && passengers <= found.capacity) return selected;
  return VEHICLE_CLASSES.find((v) => v.capacity >= passengers)?.id ?? selected;
}

check("a 2-passenger party keeps its Business selection", () => {
  assert.equal(effectiveVehicleClass("business", 2), "business");
});

check("6 passengers falls back off Business (capacity 3) to SUV/Van", () => {
  assert.equal(effectiveVehicleClass("business", 6), "suv-van");
});

check("6 passengers falls back off First Class too", () => {
  assert.equal(effectiveVehicleClass("first", 6), "suv-van");
});

check("14 passengers still resolves to a real vehicle", () => {
  const result = effectiveVehicleClass("business", 14);
  const vehicle = VEHICLE_CLASSES.find((v) => v.id === result);
  assert.ok(vehicle, "must resolve to a known class");
  assert.ok(vehicle.capacity >= 14, `${result} seats ${vehicle.capacity}, need 14`);
});

check("no vehicle is ever quoted below the party size", () => {
  for (let pax = 1; pax <= MAX_PASSENGERS; pax++) {
    for (const start of VEHICLE_CLASSES) {
      const result = effectiveVehicleClass(start.id, pax);
      const vehicle = VEHICLE_CLASSES.find((v) => v.id === result)!;
      assert.ok(
        vehicle.capacity >= pax,
        `${pax} pax starting from ${start.id} resolved to ${result} (seats ${vehicle.capacity})`,
      );
    }
  }
});

console.log("\nPricing uses ROAD distance, never straight-line\n");

/*
 * The booking page draws a straight A→B line on a static map. That line is
 * DECORATION — the price comes from Routes API computeRouteMatrix, which
 * returns true road distance.
 *
 * Measured on the real SFO → Hotel Zephyr booking:
 *   straight line   13.1 mi
 *   driving route   16.0 mi   (23% longer)
 *
 * These tests pin the size of the error so that if anyone ever wires the map
 * distance into the engine, the suite fails instead of the client being
 * quietly undercharged.
 */
check("road distance prices materially higher than straight-line", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    rideType: "distance",
    pickup: "San Francisco International Airport, CA",
    dropoff: "Hotel Zephyr, Beach Street, San Francisco, CA",
  } as unknown);

  const road = calculatePrice(ride, 16.0);
  const straightLine = calculatePrice(ride, 13.1);

  assert.ok(
    road.total > straightLine.total,
    "road distance must price higher than straight-line — if these ever match, " +
      "something is feeding the map's distance into the pricing engine",
  );

  // 2.9 mi × $4.50 × 1.25 service fee ≈ $16 of undercharging on ONE ride.
  const gap = road.total - straightLine.total;
  assert.ok(gap >= 15, `expected a material gap, got $${gap}`);
});

check("the engine is pure — identical inputs always give an identical price", () => {
  const ride = rideDetailsSchema.parse({
    ...baseRide,
    rideType: "distance",
    pickup: "San Francisco International Airport, CA",
    dropoff: "Hotel Zephyr, Beach Street, San Francisco, CA",
  } as unknown);
  assert.deepEqual(calculatePrice(ride, 16.0), calculatePrice(ride, 16.0));
});

console.log("\nBooking tag derivation (Phase 8.2)\n");

const baseTags = {
  rideType: "distance" as const,
  pickupLocation: "100 Main St, San Francisco, CA",
  dropoffLocation: "200 Market St, San Francisco, CA",
  passengers: 2,
  distanceMiles: 8,
  isAirportFlatRoute: false,
  hasCompany: false,
};

check("every booking gets source-website, pay-card, pay-paid", () => {
  const t = deriveBookingTags(baseTags);
  for (const req of ["source-website", "pay-card", "pay-paid"]) {
    assert.ok(t.includes(req), `missing ${req}`);
  }
});

check("a plain local ride is service-pointtopoint", () => {
  assert.ok(deriveBookingTags(baseTags).includes("service-pointtopoint"));
});

check("an SFO pickup is tagged service-airport, not pointtopoint", () => {
  const t = deriveBookingTags({ ...baseTags, pickupLocation: "SFO International Terminal" });
  assert.ok(t.includes("service-airport"));
  assert.ok(!t.includes("service-pointtopoint"));
});

check("a 60-mile ride is service-intercity", () => {
  assert.ok(deriveBookingTags({ ...baseTags, distanceMiles: 60 }).includes("service-intercity"));
});

check("a Napa destination is service-winetour", () => {
  assert.ok(
    deriveBookingTags({ ...baseTags, dropoffLocation: "Napa, CA" }).includes("service-winetour"),
  );
});

check("7+ passengers is service-group", () => {
  assert.ok(deriveBookingTags({ ...baseTags, passengers: 8 }).includes("service-group"));
});

check("a company adds service-corporate AND client-corporate", () => {
  const t = deriveBookingTags({ ...baseTags, hasCompany: true });
  assert.ok(t.includes("service-corporate"));
  assert.ok(t.includes("client-corporate"));
});

check("tags stack — a corporate airport group ride carries all three", () => {
  const t = deriveBookingTags({
    ...baseTags,
    pickupLocation: "SFO",
    passengers: 9,
    hasCompany: true,
  });
  assert.ok(t.includes("service-airport"));
  assert.ok(t.includes("service-group"));
  assert.ok(t.includes("service-corporate"));
});

check("hyphen→dot mapping only touches the namespace separator", () => {
  // mirrors tagsForBooking(): service-pointtopoint → service.pointtopoint
  const toCrm = (t: string) => t.replace("-", ".");
  assert.equal(toCrm("service-pointtopoint"), "service.pointtopoint");
  assert.equal(toCrm("client-corporate"), "client.corporate");
  assert.equal(toCrm("source-website"), "source.website");
});

console.log("\nAppointment-end datetime math (Phase 8.4)\n");

check("adds minutes and preserves the PDT offset", () => {
  assert.equal(addMinutesISO("2026-07-24T09:00:00-07:00", 30), "2026-07-24T09:30:00-07:00");
});

check("adds hours across the hour boundary", () => {
  assert.equal(addMinutesISO("2026-07-24T09:00:00-07:00", 90), "2026-07-24T10:30:00-07:00");
});

check("preserves a PST (-08:00) offset in January", () => {
  assert.equal(addMinutesISO("2026-01-24T09:00:00-08:00", 45), "2026-01-24T09:45:00-08:00");
});

check("rolls past midnight correctly", () => {
  assert.equal(addMinutesISO("2026-07-24T23:30:00-07:00", 60), "2026-07-25T00:30:00-07:00");
});

// ── Summary ────────────────────────────────────────────────────────────────
// Must stay the LAST statement in this file — anything appended below it would
// not be counted, and a failure there would still exit 0.
console.log("");
if (failures.length > 0) {
  console.error(`FAILED — ${failures.length} of ${passed + failures.length} checks failed:`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`All ${passed} checks passed.\n`);
