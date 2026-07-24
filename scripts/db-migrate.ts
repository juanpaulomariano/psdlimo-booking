/**
 * Database schema — idempotent migration. Run: `npm run db:migrate`.
 *
 * Safe to run repeatedly (CREATE TABLE IF NOT EXISTS). This same script is what
 * re-creates the schema against the CLIENT-OWNED production database at go-live —
 * the demo DB is throwaway; the schema is the durable artifact.
 *
 * Kept deliberately small for the first slice: only what the demo needs.
 * Rates + settings (owner-editable pricing) and users (auth). Drivers, trips,
 * zones, etc. get added in later slices as their features land.
 *
 * Stage E adds `driver`, `vehicle`, `trip` — the SILENT dispatch backend. These
 * are never shown in a website dashboard; they exist only so the system can (a)
 * record every paid ride as a trip and (b) detect a driver/vehicle time clash
 * when the owner assigns a driver in GHL. The owner's cockpit stays GHL. See
 * ARCHITECTURE.md §10.
 */

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("\n✖ DATABASE_URL is not set. Add the Neon string to .env.local.\n");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("\nMigrating schema…\n");

  /* ── rate_config ──────────────────────────────────────────────────────────
   * A simple key→value store for editable pricing numbers. One row per knob
   * (base_fare, per_mile, service_fee_pct, …). value is NUMERIC so the engine
   * reads exact decimals. This is the "owner can adjust rates" foundation.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS rate_config (
      key          TEXT PRIMARY KEY,
      value        NUMERIC NOT NULL,
      label        TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'general',
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("  ✓ rate_config");

  /* ── vehicle_class ────────────────────────────────────────────────────────
   * Editable vehicle classes: multiplier + capacity. Seeded from the current
   * code values so behaviour is identical until the owner changes something.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS vehicle_class (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      blurb        TEXT NOT NULL DEFAULT '',
      multiplier   NUMERIC NOT NULL,
      capacity     INTEGER NOT NULL,
      luggage      INTEGER NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      active       BOOLEAN NOT NULL DEFAULT true,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("  ✓ vehicle_class");

  /* ── add_on ──────────────────────────────────────────────────────────────── */
  await sql`
    CREATE TABLE IF NOT EXISTS add_on (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      blurb        TEXT NOT NULL DEFAULT '',
      price        NUMERIC NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      active       BOOLEAN NOT NULL DEFAULT true,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("  ✓ add_on");

  /* ── app_user ─────────────────────────────────────────────────────────────
   * Auth users. `role` gates the admin dashboard. Password is a bcrypt/argon
   * HASH, never plaintext (the auth slice writes it). `app_user` not `user`
   * because `user` is a reserved word in Postgres.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS app_user (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("  ✓ app_user");

  /* ── driver ────────────────────────────────────────────────────────────────
   * Chauffeurs. Kept minimal: enough to MATCH the name the owner types into the
   * GHL `chauffeur_assigned` field and to detect clashes. `active` lets a driver
   * be retired without deleting history. Drivers are NOT GHL users — the owner
   * assigns by name in GHL, and this table is the roster we resolve that against.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS driver (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      phone        TEXT NOT NULL DEFAULT '',
      email        TEXT NOT NULL DEFAULT '',
      active       BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Case-insensitive lookup by name (the owner may type "John Doe" or "john doe"
  // in GHL). A UNIQUE index on lower(name) among ACTIVE drivers keeps the roster
  // unambiguous so a clash query always resolves to one driver.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS driver_name_lower_uniq
      ON driver (lower(name)) WHERE active
  `;
  console.log("  ✓ driver");

  /* ── vehicle ───────────────────────────────────────────────────────────────
   * Physical cars (distinct from `vehicle_class`, which is a PRICING tier). A
   * clash can be a driver double-booked OR the same car double-booked, so both
   * are first-class. `class_id` ties a car to its pricing tier for reporting.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS vehicle (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      plate        TEXT NOT NULL DEFAULT '',
      class_id     TEXT REFERENCES vehicle_class(id),
      active       BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("  ✓ vehicle");

  /* ── trip ──────────────────────────────────────────────────────────────────
   * One row per PAID ride, written silently by the payment webhook. This is the
   * backbone of clash detection: `pickup_at` + `ends_at` give each trip a time
   * window, and a driver/vehicle assigned to two overlapping windows is a double
   * booking.
   *
   *   external_id  — the booking ref (psdlimo-…); UNIQUE so the webhook is
   *                  idempotent here exactly as it is in GHL (a re-sent callback
   *                  updates the same row, never inserts a second).
   *   ghl_*        — the ids the webhook already obtained, so dispatch can flag
   *                  the RIGHT opportunity later without re-searching GHL.
   *   driver_id /  — NULL until the owner assigns in GHL. The assign webhook
   *   vehicle_id     fills these and re-runs the clash check.
   *   status       — coarse lifecycle for reporting (booked → assigned → …).
   *                  Fine-grained live statuses are a FUTURE phase.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS trip (
      id             TEXT PRIMARY KEY,
      external_id    TEXT UNIQUE NOT NULL,
      ghl_contact_id      TEXT NOT NULL DEFAULT '',
      ghl_opportunity_id  TEXT NOT NULL DEFAULT '',
      customer_name  TEXT NOT NULL DEFAULT '',
      pickup_at      TIMESTAMPTZ NOT NULL,
      ends_at        TIMESTAMPTZ NOT NULL,
      pickup_location   TEXT NOT NULL DEFAULT '',
      dropoff_location  TEXT NOT NULL DEFAULT '',
      vehicle_class  TEXT NOT NULL DEFAULT '',
      driver_id      TEXT REFERENCES driver(id),
      vehicle_id     TEXT REFERENCES vehicle(id),
      status         TEXT NOT NULL DEFAULT 'booked',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // The clash query filters by driver_id/vehicle_id and an overlapping time
  // window; these indexes keep it fast as trip history grows.
  await sql`CREATE INDEX IF NOT EXISTS trip_driver_time  ON trip (driver_id, pickup_at, ends_at)`;
  await sql`CREATE INDEX IF NOT EXISTS trip_vehicle_time ON trip (vehicle_id, pickup_at, ends_at)`;
  console.log("  ✓ trip");

  console.log("\n✓ Schema up to date.\n");
}

migrate().catch((err) => {
  console.error("\n✖ Migration failed:\n", err);
  process.exit(1);
});
