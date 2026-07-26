/**
 * Seed the rate tables from the CURRENT code values in config/rates.ts.
 * Run: `npm run db:seed` (after db:migrate).
 *
 * The point: the DB starts as an EXACT MIRROR of the code, so moving pricing to
 * the DB changes nothing about the numbers — only their source. Idempotent
 * (upsert), so re-running is safe. Also seeds ONE demo admin user.
 *
 * PLACEHOLDER rates flow straight through — the // PLACEHOLDER banner in
 * config/rates.ts still governs; these values are not "confirmed" pricing.
 */

import { neon } from "@neondatabase/serverless";
import {
  ADD_ONS,
  BASE_FARE,
  MINIMUM_FARE,
  MIN_HOURS,
  PER_HOUR,
  PER_MILE,
  ROUND_TRIP_RETURN_DISCOUNT,
  SERVICE_FEE_PCT,
  VEHICLE_CLASSES,
} from "@/config/rates";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("\n✖ DATABASE_URL is not set.\n");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

/** One admin user for the demo. Password is set by the auth slice; here we only
 *  reserve the row so the role gate has something to point at. Overwritten when
 *  the real register/login flow hashes a password. */
const DEMO_ADMIN_EMAIL = "admin@psdlimo.demo";

async function seed() {
  console.log("\nSeeding from config/rates.ts …\n");

  // ── rate_config (the scalar knobs) ──────────────────────────────────────
  const knobs: Array<[string, number, string, string]> = [
    ["base_fare", BASE_FARE, "Base fare (distance rides)", "fare"],
    ["per_mile", PER_MILE, "Per mile", "fare"],
    ["per_hour", PER_HOUR, "Per hour", "fare"],
    ["min_hours", MIN_HOURS, "Minimum hours (hourly)", "rules"],
    ["service_fee_pct", SERVICE_FEE_PCT, "Service & fees (%)", "fees"],
    ["minimum_fare", MINIMUM_FARE, "Minimum fare (floor)", "rules"],
    ["round_trip_return_discount", ROUND_TRIP_RETURN_DISCOUNT, "Round-trip return discount (%)", "rules"],
  ];
  for (const [key, value, label, category] of knobs) {
    await sql`
      INSERT INTO rate_config (key, value, label, category)
      VALUES (${key}, ${value}, ${label}, ${category})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label
    `;
  }
  console.log(`  ✓ ${knobs.length} rate_config rows`);

  // ── vehicle_class ───────────────────────────────────────────────────────
  let order = 0;
  for (const v of VEHICLE_CLASSES) {
    await sql`
      INSERT INTO vehicle_class (id, label, blurb, multiplier, capacity, luggage, sort_order)
      VALUES (${v.id}, ${v.label}, ${v.blurb}, ${v.multiplier}, ${v.capacity}, ${v.luggage}, ${order})
      ON CONFLICT (id) DO UPDATE SET
        label = EXCLUDED.label, blurb = EXCLUDED.blurb, multiplier = EXCLUDED.multiplier,
        capacity = EXCLUDED.capacity, luggage = EXCLUDED.luggage, sort_order = EXCLUDED.sort_order
    `;
    order++;
  }
  console.log(`  ✓ ${VEHICLE_CLASSES.length} vehicle_class rows`);

  // ── add_on ──────────────────────────────────────────────────────────────
  order = 0;
  for (const a of ADD_ONS) {
    await sql`
      INSERT INTO add_on (id, label, blurb, price, sort_order)
      VALUES (${a.id}, ${a.label}, ${a.blurb}, ${a.price}, ${order})
      ON CONFLICT (id) DO UPDATE SET
        label = EXCLUDED.label, blurb = EXCLUDED.blurb, price = EXCLUDED.price, sort_order = EXCLUDED.sort_order
    `;
    order++;
  }
  console.log(`  ✓ ${ADD_ONS.length} add_on rows`);

  // ── demo admin (row reserved; password set by the auth slice) ────────────
  await sql`
    INSERT INTO app_user (id, email, name, password_hash, role)
    VALUES ('seed-admin', ${DEMO_ADMIN_EMAIL}, 'PSD Limo Admin', '!pending-auth-slice', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin'
  `;
  console.log(`  ✓ demo admin reserved (${DEMO_ADMIN_EMAIL})`);

  // ── demo drivers (PLACEHOLDER roster) ─────────────────────────────────────
  // The owner assigns a driver by name in the admin; the real roster is entered
  // at go-live and managed there. `id`s are stable slugs so the seed is
  // idempotent and the test harness can reference them.
  //
  // FOUR, not two: the dispatch rule is one driver = one trip per day, so with
  // only two drivers a second same-day assignment hits the block immediately and
  // reads as a bug rather than the protection it is.
  const drivers: Array<[string, string, string, string]> = [
    ["drv-marco", "Marco Reyes", "09170000001", "marco@psdlimo.demo"],
    ["drv-elena", "Elena Cruz", "09170000002", "elena@psdlimo.demo"],
    ["drv-james", "James Okafor", "09170000003", "james@psdlimo.demo"],
    ["drv-sofia", "Sofia Lindqvist", "09170000004", "sofia@psdlimo.demo"],
  ];
  for (const [id, name, phone, email] of drivers) {
    await sql`
      INSERT INTO driver (id, name, phone, email)
      VALUES (${id}, ${name}, ${phone}, ${email})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, phone = EXCLUDED.phone, email = EXCLUDED.email, active = true
    `;
  }
  console.log(`  ✓ ${drivers.length} demo drivers`);

  console.log("\n✓ Seed complete — DB now mirrors config/rates.ts.\n");
}

seed().catch((err) => {
  console.error("\n✖ Seed failed:\n", err);
  process.exit(1);
});
