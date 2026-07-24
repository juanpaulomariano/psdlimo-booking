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

  console.log("\n✓ Schema up to date.\n");
}

migrate().catch((err) => {
  console.error("\n✖ Migration failed:\n", err);
  process.exit(1);
});
