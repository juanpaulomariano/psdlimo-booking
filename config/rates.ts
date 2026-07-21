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
  },
  {
    id: "oak-financial-district",
    label: "OAK → Financial District",
    from: "Oakland International Airport (OAK), Oakland, CA",
    to: "Financial District, San Francisco, CA",
    price: 110, // PLACEHOLDER
    isAirport: true,
  },
  {
    id: "sf-napa",
    label: "San Francisco → Napa Valley",
    from: "San Francisco, CA",
    to: "Napa, CA",
    price: 260, // PLACEHOLDER
    isAirport: false,
  },
] as const;

export type FlatRouteId = (typeof FLAT_ROUTES)[number]["id"];

export const FLAT_ROUTE_IDS = FLAT_ROUTES.map((r) => r.id) as readonly FlatRouteId[];

export function getFlatRoute(id: FlatRouteId) {
  const found = FLAT_ROUTES.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown flat route: ${id}`);
  return found;
}

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
