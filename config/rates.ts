/* ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  PLACEHOLDER RATE CARD — NOT CONFIRMED CLIENT PRICING  ⚠️
 *
 * Every number below is invented for the demo. The structure mirrors PSDLimo's
 * advertised pricing so the client can see the shape of the engine, but no
 * figure here has been signed off.
 *
 * DO NOT remove this banner. Swapping in real pricing means editing this file
 * and nothing else — that is the entire point of keeping it isolated.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const CURRENCY = "USD" as const;

/** Distance rides: flat base + per-mile, before multipliers. */
export const BASE_FARE = 45; // PLACEHOLDER
export const PER_MILE = 4.5; // PLACEHOLDER — miles come from Google Routes API

/** Hourly rides. */
export const PER_HOUR = 95; // PLACEHOLDER
export const MIN_HOURS = 2; // PLACEHOLDER — hourly bookings cannot go below this
export const MAX_HOURS = 12; // PLACEHOLDER — upper bound on the hours stepper

/** Applied last, after everything else, as a safety net on very short rides. */
export const MINIMUM_FARE = 95; // PLACEHOLDER

/** Service & fees, applied to the post-multiplier subtotal. */
export const SERVICE_FEE_PCT = 0.25; // PLACEHOLDER — 25%, matches current site's surcharge

/** Round-trip: discount applied to the RETURN leg's fare (0.10 = 10% off the
 *  return). The outbound leg is full price. Owner-editable. PLACEHOLDER. */
export const ROUND_TRIP_RETURN_DISCOUNT = 0.1; // PLACEHOLDER

/* ── Vehicle classes ────────────────────────────────────────────────────────
 * `capacity` gates the UI: a class is disabled when passengers exceed it.
 * ASSUMPTION FOR CLIENT TO CONFIRM: the multiplier applies to flat routes too,
 * not just distance/hourly. See PRICING_ASSUMPTIONS below.
 */
export const VEHICLE_CLASSES = [
  {
    id: "business",
    label: "Business Class",
    blurb: "Mercedes E-Class or similar",
    multiplier: 1.0, // PLACEHOLDER
    capacity: 3,
    luggage: 2,
  },
  {
    id: "first",
    label: "First Class",
    blurb: "Mercedes S-Class or similar",
    multiplier: 1.45, // PLACEHOLDER
    capacity: 3,
    luggage: 2,
  },
  {
    id: "suv-van",
    label: "SUV / Van",
    blurb: "Cadillac Escalade or Sprinter",
    multiplier: 1.3, // PLACEHOLDER
    capacity: 14,
    luggage: 10,
  },
  {
    id: "electric",
    label: "Electric",
    blurb: "Tesla Model S or similar",
    multiplier: 1.15, // PLACEHOLDER
    capacity: 3,
    luggage: 2,
  },
] as const;

export type VehicleClassId = (typeof VEHICLE_CLASSES)[number]["id"];

export const VEHICLE_CLASS_IDS = VEHICLE_CLASSES.map((v) => v.id) as readonly VehicleClassId[];

/** Largest capacity across all classes — the upper bound on the passenger field. */
export const MAX_PASSENGERS = Math.max(...VEHICLE_CLASSES.map((v) => v.capacity));
export const MAX_LUGGAGE = Math.max(...VEHICLE_CLASSES.map((v) => v.luggage));

export function getVehicleClass(id: VehicleClassId) {
  const found = VEHICLE_CLASSES.find((v) => v.id === id);
  // Unreachable via zod-validated input; loud rather than silently mispriced.
  if (!found) throw new Error(`Unknown vehicle class: ${id}`);
  return found;
}

/* ── Add-ons ────────────────────────────────────────────────────────────────
 * Flat surcharges added AFTER the vehicle multiplier, BEFORE the service fee.
 */
export const ADD_ONS = [
  { id: "meet-greet", label: "Meet & Greet", blurb: "Chauffeur waits inside with a name board", price: 25 }, // PLACEHOLDER
  { id: "child-seat", label: "Child Seat", blurb: "Fitted before pickup", price: 25 }, // PLACEHOLDER
  { id: "extra-stop", label: "Extra Stop", blurb: "One additional stop en route", price: 20 }, // PLACEHOLDER
] as const;

export type AddOnId = (typeof ADD_ONS)[number]["id"];

export const ADD_ON_IDS = ADD_ONS.map((a) => a.id) as readonly AddOnId[];

export function getAddOn(id: AddOnId) {
  const found = ADD_ONS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown add-on: ${id}`);
  return found;
}

/* ── Flat routes ────────────────────────────────────────────────────────────
 * Predefined A→B pairs at a fixed price, bypassing base + per-mile entirely.
 * `isAirport` drives the `service-airport` GHL tag without string-sniffing.
 */
export const FLAT_ROUTES = [
  {
    id: "sfo-downtown-sf",
    label: "SFO → Downtown San Francisco",
    from: "San Francisco International Airport (SFO), San Francisco, CA",
    to: "Downtown San Francisco, CA",
    price: 120, // PLACEHOLDER
    isAirport: true,
    // Typical drive time. Feeds the calendar appointment END for this route,
    // since a flat route makes no Routes API call. PLACEHOLDER.
    durationMinutes: 35, // PLACEHOLDER
  },
  {
    id: "oak-financial-district",
    label: "OAK → Financial District",
    from: "Oakland International Airport (OAK), Oakland, CA",
    to: "Financial District, San Francisco, CA",
    price: 110, // PLACEHOLDER
    isAirport: true,
    durationMinutes: 30, // PLACEHOLDER
  },
  {
    id: "sf-napa",
    label: "San Francisco → Napa Valley",
    from: "San Francisco, CA",
    to: "Napa, CA",
    price: 260, // PLACEHOLDER
    isAirport: false,
    durationMinutes: 90, // PLACEHOLDER
  },
] as const;

export type FlatRouteId = (typeof FLAT_ROUTES)[number]["id"];

export const FLAT_ROUTE_IDS = FLAT_ROUTES.map((r) => r.id) as readonly FlatRouteId[];

export function getFlatRoute(id: FlatRouteId) {
  const found = FLAT_ROUTES.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown flat route: ${id}`);
  return found;
}

/* ── Currency ───────────────────────────────────────────────────────────────
 * The business currency is USD: every price shown, stored, and pushed to the
 * CRM is USD. But the demo Xendit account is Philippine-registered and cannot
 * issue USD invoices — verified 2026-07-21 by calling the API:
 *   USD -> {"error_code":"UNSUPPORTED_CURRENCY"}
 *   PHP -> 201 Created
 *
 * So the invoice — and ONLY the invoice — is denominated in PHP. The conversion
 * happens at one point in the codebase (lib/payments.ts) and nowhere else.
 * At go-live the processor becomes client-owned and charges USD directly, and
 * this constant disappears with the swap.
 */
export const USD_TO_PHP_FALLBACK = 58.5; // PLACEHOLDER — fixed demo rate, not a live FX feed

/* ── Booking rules ─────────────────────────────────────────────────────────── */

/** Minimum lead time between "now" and the pickup, in hours. */
export const MIN_LEAD_TIME_HOURS = 2; // PLACEHOLDER

/** The client operates in San Francisco. Every datetime in this app is this zone. */
export const BUSINESS_TIMEZONE = "America/Los_Angeles" as const;

/* ── Assumptions the client must confirm before go-live ─────────────────────
 * Surfaced here (and in the demo notes) rather than buried in code, so nobody
 * mistakes a demo decision for a business rule.
 */
export const PRICING_ASSUMPTIONS = [
  "The vehicle-class multiplier applies to flat routes as well as distance and hourly rides.",
  "The 25% service & fees charge is applied after add-ons, not before.",
  "The minimum fare is a floor applied to the final total, after the service fee.",
  "Hourly rides ignore distance entirely — the hourly rate is all-inclusive of mileage.",
  "Gratuity is not collected at booking.",
] as const;

/* ── RateCard — the pricing engine's editable inputs ────────────────────────
 * The engine reads its numbers from a RateCard passed IN by the caller, not
 * from the module constants directly. That keeps the engine a pure function
 * while letting the numbers come from the DB (owner-editable) at runtime.
 *
 * CODE_RATE_CARD below is built from the constants above, so:
 *   · every existing caller and test that passes no card gets IDENTICAL behaviour
 *   · the DB is seeded FROM these same values, so DB rates start identical too
 * The single source of truth for the DEFAULT numbers is still config/rates.ts;
 * the DB is an editable overlay that starts as an exact copy.
 */
export type RateCard = {
  baseFare: number;
  perMile: number;
  perHour: number;
  minHours: number;
  serviceFeePct: number;
  minimumFare: number;
  /** Fraction off the return leg of a round trip (0.10 = 10% off). */
  roundTripReturnDiscount: number;
  /** id → { label, multiplier } for vehicle classes. */
  vehicleMultipliers: Record<string, { label: string; multiplier: number }>;
  /** id → { label, price } for add-ons. */
  /** The add-on CATALOGUE, not just prices: this is the single source of truth
   *  for which add-ons exist. The booking wizard renders from it, the pricing
   *  engine charges from it, and checkout validates against it — so an add-on
   *  the owner creates in the admin appears on the site with no deploy. */
  addOnPrices: Record<string, { label: string; blurb: string; price: number }>;
};

/** The default rate card, built from the code constants. Behaviour with this is
 *  identical to the pre-RateCard engine. */
export const CODE_RATE_CARD: RateCard = {
  baseFare: BASE_FARE,
  perMile: PER_MILE,
  perHour: PER_HOUR,
  minHours: MIN_HOURS,
  serviceFeePct: SERVICE_FEE_PCT,
  minimumFare: MINIMUM_FARE,
  roundTripReturnDiscount: ROUND_TRIP_RETURN_DISCOUNT,
  vehicleMultipliers: Object.fromEntries(
    VEHICLE_CLASSES.map((v) => [v.id, { label: v.label, multiplier: v.multiplier }]),
  ),
  addOnPrices: Object.fromEntries(
    ADD_ONS.map((a) => [a.id, { label: a.label, blurb: a.blurb, price: a.price }]),
  ),
};

/* ── Booking tag derivation ─────────────────────────────────────────────────
 * A ride's CRM tags are derived from its SHAPE — where it goes, how big, how
 * long, whether a company is named. Never from anything the customer is asked to
 * disclose about WHY they are travelling (occasion tags like wedding/citytour
 * have no producer on the website path, by design — see the blueprint's privacy
 * note). This is a pure function so it is unit-testable and identical wherever
 * it runs.
 */

/** ≥ this many miles reads as an intercity run rather than a local hop. PLACEHOLDER. */
export const INTERCITY_MILES = 50; // PLACEHOLDER

/** ≥ this many passengers reads as a group booking. */
export const GROUP_PASSENGERS = 7; // PLACEHOLDER

/** Far-city name fragments that mark an intercity ride even under the mileage bar. */
const FAR_CITY_PATTERN = /\b(sacramento|los angeles|monterey|santa cruz|carmel|tahoe)\b/i;

/** Wine-country destinations. */
const WINE_COUNTRY_PATTERN = /\b(napa|sonoma|healdsburg|calistoga|yountville)\b/i;

/** Airport markers in a free-text address. */
const AIRPORT_ADDRESS_PATTERN = /\b(airport|sfo|oak|sjc|international terminal)\b/i;

export type TagDerivationInput = {
  rideType: "distance" | "hourly" | "flat";
  pickupLocation: string;
  dropoffLocation: string;
  /** Whole-dollar total; used for no tag today but kept for future value tags. */
  passengers: number;
  /** Road miles for distance rides; null otherwise. */
  distanceMiles: number | null;
  isAirportFlatRoute: boolean;
  hasCompany: boolean;
  /** True when the booking includes a return leg (a round trip). Adds the
   *  `ride-roundtrip` tag so the owner can see/filter round trips at a glance —
   *  a round trip is ONE opportunity carrying a return_datetime, not two. */
  isRoundTrip: boolean;
};

/**
 * The complete internal (hyphenated) tag set for a booking. Mapped to dotted CRM
 * tags in lib/ghl.ts (`ride-airport` → `ride.airport`).
 *
 * Namespaces are deliberately separated by CONCERN (cleanup 2026-07-25):
 *   source.*   — where the booking came from        (source.website)
 *   payment.*  — the payment OUTCOME                 (payment.paid)
 *   method.*   — the payment METHOD                  (method.card)
 *   ride.*     — the ride TYPE                       (ride.airport, ride.hourly…)
 *   client.*   — an attribute of the CLIENT          (client.corporate)
 *
 * `source-website`, `payment-paid`, and `method-card` are always present — every
 * website booking is a paid card booking. Exactly one `ride-*` is guaranteed
 * (falling back to `ride-pointtopoint`); others stack on top.
 */
export function deriveBookingTags(input: TagDerivationInput): string[] {
  const tags = new Set<string>(["source-website", "payment-paid", "method-card"]);

  const isAirport =
    input.isAirportFlatRoute ||
    AIRPORT_ADDRESS_PATTERN.test(input.pickupLocation) ||
    AIRPORT_ADDRESS_PATTERN.test(input.dropoffLocation);

  // Primary ride classification. An airport hourly ride is still "airport";
  // order here decides the PRIMARY, but tags stack so it rarely matters.
  if (isAirport) tags.add("ride-airport");
  if (input.rideType === "hourly") tags.add("ride-hourly");

  const isIntercity =
    (input.distanceMiles !== null && input.distanceMiles >= INTERCITY_MILES) ||
    FAR_CITY_PATTERN.test(input.dropoffLocation) ||
    FAR_CITY_PATTERN.test(input.pickupLocation);
  if (isIntercity) tags.add("ride-intercity");

  if (
    WINE_COUNTRY_PATTERN.test(input.dropoffLocation) ||
    WINE_COUNTRY_PATTERN.test(input.pickupLocation)
  ) {
    tags.add("ride-winetour");
  }

  if (input.passengers >= GROUP_PASSENGERS) tags.add("ride-group");

  if (input.hasCompany) {
    tags.add("ride-corporate");
    tags.add("client-corporate");
  }

  // Guarantee at least one ride-* CLASSIFICATION tag (airport/hourly/…). The
  // round-trip tag below is a modifier, not a classification, so this runs first.
  const hasRide = [...tags].some((t) => t.startsWith("ride-"));
  if (!hasRide) tags.add("ride-pointtopoint");

  // Round-trip modifier — stacks on top of the classification (e.g. a round-trip
  // airport run carries both ride-airport AND ride-roundtrip).
  if (input.isRoundTrip) tags.add("ride-roundtrip");

  return [...tags];
}
