/**
 * Dispatch / double-booking assertions. Run: `npm run test:dispatch`.
 *
 * This one hits the REAL database (the clash query is SQL — a pure-function test
 * would not exercise the thing that can actually be wrong). It is
 * SELF-CONTAINED and SELF-CLEANING: every row it creates uses the `TEST-`
 * external_id prefix and is deleted in a `finally`, so it never pollutes the
 * demo data and is safe to run repeatedly.
 *
 * It seeds trips directly (bypassing the payment webhook) because the unit under
 * test is the clash detection, not the booking flow. Uses the seeded demo driver
 * `drv-marco` and vehicle `veh-s580`.
 *
 * Exits non-zero on any failure.
 */

import assert from "node:assert/strict";
import { sql } from "@/lib/db";
import { assignDriverAndDetectClashes, resolveDriverByName } from "@/lib/trips";

const PREFIX = "TEST-DISPATCH-";
const DRIVER_ID = "drv-marco";
const VEHICLE_ID = "veh-s580";

let passed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Insert a bare trip with a known window. Times are LA-offset ISO strings. */
async function seedTrip(ref: string, pickupAt: string, endsAt: string) {
  const externalId = `${PREFIX}${ref}`;
  await sql`
    INSERT INTO trip (id, external_id, ghl_opportunity_id, customer_name, pickup_at, ends_at, vehicle_class, status)
    VALUES (${`trip-${externalId}`}, ${externalId}, ${`opp-${ref}`}, ${`Test ${ref}`}, ${pickupAt}, ${endsAt}, 'first', 'booked')
    ON CONFLICT (external_id) DO UPDATE SET
      pickup_at = EXCLUDED.pickup_at, ends_at = EXCLUDED.ends_at,
      driver_id = NULL, vehicle_id = NULL, status = 'booked'
  `;
  return externalId;
}

async function cleanup() {
  await sql`DELETE FROM trip WHERE external_id LIKE ${PREFIX + "%"}`;
}

async function main() {
  console.log("\nDispatch — driver/vehicle double-booking detection\n");

  // Sanity: the seeded roster must be present, or the whole suite is meaningless.
  await check("seeded driver 'Marco Reyes' resolves by name (case-insensitive)", async () => {
    const d = await resolveDriverByName("marco reyes");
    assert.ok(d, "expected to resolve a driver");
    assert.equal(d!.id, DRIVER_ID);
  });

  await check("unknown driver name resolves to null", async () => {
    const d = await resolveDriverByName("Nobody McGhost");
    assert.equal(d, null);
  });

  // ── Clean assignment: two trips that do NOT overlap ─────────────────────
  await check("non-overlapping trips → no clash", async () => {
    await cleanup();
    // 9:00–10:00 and 11:00–12:00 on the same day: a clear gap.
    await seedTrip("A1", "2026-08-01T09:00:00-07:00", "2026-08-01T10:00:00-07:00");
    await seedTrip("A2", "2026-08-01T11:00:00-07:00", "2026-08-01T12:00:00-07:00");
    await assignDriverAndDetectClashes({ externalId: `${PREFIX}A1`, driverId: DRIVER_ID });
    const clashes = await assignDriverAndDetectClashes({ externalId: `${PREFIX}A2`, driverId: DRIVER_ID });
    assert.deepEqual(clashes, []);
  });

  // ── Overlapping assignment: same driver, overlapping windows ────────────
  await check("overlapping trips, same driver → driver clash", async () => {
    await cleanup();
    // 9:00–11:00 and 10:00–12:00 overlap by an hour.
    await seedTrip("B1", "2026-08-02T09:00:00-07:00", "2026-08-02T11:00:00-07:00");
    await seedTrip("B2", "2026-08-02T10:00:00-07:00", "2026-08-02T12:00:00-07:00");
    await assignDriverAndDetectClashes({ externalId: `${PREFIX}B1`, driverId: DRIVER_ID });
    const clashes = await assignDriverAndDetectClashes({ externalId: `${PREFIX}B2`, driverId: DRIVER_ID });
    assert.equal(clashes!.length, 1);
    assert.equal(clashes![0].external_id, `${PREFIX}B1`);
    assert.equal(clashes![0].reason, "driver");
  });

  // ── Back-to-back: one ends exactly when the next begins → NOT a clash ────
  await check("back-to-back trips (touch at the boundary) → no clash", async () => {
    await cleanup();
    // 9:00–10:00 then 10:00–11:00. Half-open intervals do not intersect.
    await seedTrip("C1", "2026-08-03T09:00:00-07:00", "2026-08-03T10:00:00-07:00");
    await seedTrip("C2", "2026-08-03T10:00:00-07:00", "2026-08-03T11:00:00-07:00");
    await assignDriverAndDetectClashes({ externalId: `${PREFIX}C1`, driverId: DRIVER_ID });
    const clashes = await assignDriverAndDetectClashes({ externalId: `${PREFIX}C2`, driverId: DRIVER_ID });
    assert.deepEqual(clashes, [], "back-to-back must be allowed");
  });

  // ── A trip never clashes with itself (re-assigning the same booking) ─────
  await check("re-assigning the same trip → no self-clash", async () => {
    await cleanup();
    await seedTrip("D1", "2026-08-04T09:00:00-07:00", "2026-08-04T11:00:00-07:00");
    await assignDriverAndDetectClashes({ externalId: `${PREFIX}D1`, driverId: DRIVER_ID });
    // Assign the SAME trip again — must not report itself as a conflict.
    const clashes = await assignDriverAndDetectClashes({ externalId: `${PREFIX}D1`, driverId: DRIVER_ID });
    assert.deepEqual(clashes, []);
  });

  // ── Vehicle clash: different drivers, SAME car, overlapping ─────────────
  await check("same vehicle, different drivers, overlapping → vehicle clash", async () => {
    await cleanup();
    await seedTrip("E1", "2026-08-05T09:00:00-07:00", "2026-08-05T11:00:00-07:00");
    await seedTrip("E2", "2026-08-05T10:00:00-07:00", "2026-08-05T12:00:00-07:00");
    // Same car on both; drivers differ (marco vs elena).
    await assignDriverAndDetectClashes({ externalId: `${PREFIX}E1`, driverId: "drv-marco", vehicleId: VEHICLE_ID });
    const clashes = await assignDriverAndDetectClashes({ externalId: `${PREFIX}E2`, driverId: "drv-elena", vehicleId: VEHICLE_ID });
    assert.equal(clashes!.length, 1);
    assert.equal(clashes![0].external_id, `${PREFIX}E1`);
    assert.equal(clashes![0].reason, "vehicle");
  });

  // ── Different drivers, no shared vehicle, overlapping → NO clash ─────────
  await check("overlapping trips, different drivers, no shared car → no clash", async () => {
    await cleanup();
    await seedTrip("F1", "2026-08-06T09:00:00-07:00", "2026-08-06T11:00:00-07:00");
    await seedTrip("F2", "2026-08-06T10:00:00-07:00", "2026-08-06T12:00:00-07:00");
    await assignDriverAndDetectClashes({ externalId: `${PREFIX}F1`, driverId: "drv-marco" });
    const clashes = await assignDriverAndDetectClashes({ externalId: `${PREFIX}F2`, driverId: "drv-elena" });
    assert.deepEqual(clashes, []);
  });

  // ── Unknown booking reference → null (nothing to assign) ────────────────
  await check("assigning a non-existent trip → null", async () => {
    const clashes = await assignDriverAndDetectClashes({
      externalId: `${PREFIX}DOES-NOT-EXIST`,
      driverId: DRIVER_ID,
    });
    assert.equal(clashes, null);
  });

  // ── De-dupe: a trip clashing on BOTH driver and vehicle appears once ─────
  await check("clash on both driver AND vehicle is reported once", async () => {
    await cleanup();
    await seedTrip("G1", "2026-08-07T09:00:00-07:00", "2026-08-07T11:00:00-07:00");
    await seedTrip("G2", "2026-08-07T10:00:00-07:00", "2026-08-07T12:00:00-07:00");
    await assignDriverAndDetectClashes({ externalId: `${PREFIX}G1`, driverId: DRIVER_ID, vehicleId: VEHICLE_ID });
    const clashes = await assignDriverAndDetectClashes({ externalId: `${PREFIX}G2`, driverId: DRIVER_ID, vehicleId: VEHICLE_ID });
    assert.equal(clashes!.length, 1, "the same trip must not be listed twice");
    assert.equal(clashes![0].reason, "driver"); // driver wins the label
  });
}

main()
  .catch((err) => {
    console.error("\n✖ Dispatch test crashed:\n", err);
    failures.push("suite crashed");
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    console.log(`\n${passed} passed, ${failures.length} failed.\n`);
    if (failures.length > 0) {
      console.error("Failures:\n  - " + failures.join("\n  - ") + "\n");
      process.exit(1);
    }
    console.log("✓ Dispatch double-booking detection verified.\n");
    process.exit(0);
  });
