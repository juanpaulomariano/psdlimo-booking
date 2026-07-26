/**
 * The live rate card — read from the database so the owner can edit rates
 * without a redeploy.
 *
 * SERVER ONLY. Read by /api/quote and /api/checkout, which pass the result into
 * the pure pricing engine. The engine itself never touches the DB — this module
 * is the boundary that fetches the numbers.
 *
 * RESILIENCE — pricing must NEVER break because the DB hiccuped:
 *   1. Success → the DB rate card, cached briefly (rates change rarely; no need
 *      to hit the DB on every keystroke-driven re-quote).
 *   2. DB error → the LAST-GOOD card if we have one in memory.
 *   3. No last-good yet → CODE_RATE_CARD (the config/rates.ts defaults).
 * So a quote is ALWAYS produced. The worst case is briefly-stale rates, never a
 * broken quote. This is why the DB is an editable OVERLAY on the code defaults,
 * not a hard dependency.
 */

import "server-only";
import { sql, isDatabaseConfigured } from "@/lib/db";
import { CODE_RATE_CARD, type RateCard } from "@/config/rates";

/** How long a fetched card is reused before re-reading the DB. Rates change
 *  rarely and a booking session fires many quotes; 60s keeps it snappy without
 *  serving badly stale rates. An owner edit is visible within a minute. */
const CACHE_TTL_MS = 60_000;

let cached: { card: RateCard; at: number } | null = null;
/** The last card we successfully built from the DB — the fallback on a later
 *  DB error, preferred over the code defaults because it reflects owner edits. */
let lastGood: RateCard | null = null;

type RateConfigRow = { key: string; value: string | number };
type VehicleRow = { id: string; label: string; multiplier: string | number };
type AddOnRow = { id: string; label: string; blurb: string; price: string | number };

function num(v: string | number): number {
  return typeof v === "number" ? v : Number.parseFloat(v);
}

async function buildFromDb(): Promise<RateCard> {
  // Neon returns NUMERIC as strings — coerce explicitly. The rows are untyped at
  // the driver level, so we assert the shapes we SELECT (unknown-cast is the
  // standard pattern for raw-SQL row typing).
  const [config, vehicles, addOns] = await Promise.all([
    sql`SELECT key, value FROM rate_config` as unknown as Promise<RateConfigRow[]>,
    sql`SELECT id, label, multiplier FROM vehicle_class WHERE active = true ORDER BY sort_order` as unknown as Promise<VehicleRow[]>,
    sql`SELECT id, label, blurb, price FROM add_on WHERE active = true ORDER BY sort_order` as unknown as Promise<AddOnRow[]>,
  ]);

  const cfg = new Map(config.map((r) => [r.key, num(r.value)]));

  // Any missing knob falls back to the code default for THAT field, so a partial
  // DB never produces a nonsense card.
  const card: RateCard = {
    baseFare: cfg.get("base_fare") ?? CODE_RATE_CARD.baseFare,
    perMile: cfg.get("per_mile") ?? CODE_RATE_CARD.perMile,
    perHour: cfg.get("per_hour") ?? CODE_RATE_CARD.perHour,
    minHours: cfg.get("min_hours") ?? CODE_RATE_CARD.minHours,
    serviceFeePct: cfg.get("service_fee_pct") ?? CODE_RATE_CARD.serviceFeePct,
    minimumFare: cfg.get("minimum_fare") ?? CODE_RATE_CARD.minimumFare,
    roundTripReturnDiscount:
      cfg.get("round_trip_return_discount") ?? CODE_RATE_CARD.roundTripReturnDiscount,
    vehicleMultipliers: vehicles.length
      ? Object.fromEntries(vehicles.map((v) => [v.id, { label: v.label, multiplier: num(v.multiplier) }]))
      : CODE_RATE_CARD.vehicleMultipliers,
    addOnPrices: addOns.length
      ? Object.fromEntries(
          addOns.map((a) => [a.id, { label: a.label, blurb: a.blurb ?? "", price: num(a.price) }]),
        )
      : CODE_RATE_CARD.addOnPrices,
  };

  return card;
}

/**
 * The rate card to price with. Always returns a usable card; never throws for a
 * DB reason.
 */
export async function getRateCard(): Promise<RateCard> {
  // No DB configured (e.g. a fresh checkout, or local dev without DATABASE_URL)
  // → the code defaults. Identical to the pre-DB behaviour.
  if (!isDatabaseConfigured()) return CODE_RATE_CARD;

  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.card;

  try {
    const card = await buildFromDb();
    cached = { card, at: now };
    lastGood = card;
    return card;
  } catch (err) {
    console.error(
      "[rates] DB read failed — falling back to last-good/code rates so quoting " +
        `never breaks: ${err instanceof Error ? err.message : String(err)}`,
    );
    return lastGood ?? CODE_RATE_CARD;
  }
}

/** Called by the admin after an edit so the next quote reflects it immediately
 *  rather than waiting up to CACHE_TTL_MS. */
export function invalidateRateCache(): void {
  cached = null;
}
