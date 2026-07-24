/**
 * Dispatch assertions — the ADMIN driver-assignment model with the HARD BLOCK.
 * Run: `npm run test:dispatch`.
 *
 * Hits the REAL database (the block is enforced in SQL — a pure-function test
 * would not exercise the thing that can actually be wrong). SELF-CONTAINED and
 * SELF-CLEANING: every row it creates uses a `TEST-DISPATCH-` / `TEST-DRV-`
 * prefix and is deleted in `finally`, so it never pollutes real data and is safe
 * to run repeatedly.
 *
 * The rule under test: one driver = one trip per LA calendar day. Assigning a
 * driver who already has a trip THAT DAY is refused; a different day is fine;
 * reassigning the same booking is a no-op that still succeeds; unassigning frees
 * the day.
 *
 * Exits non-zero on any failure.
 */

import assert from "node:assert/strict";
import { sql } from "@/lib/db";
import {
  addDriver,
  updateDriver,
  setDriverActive,
  listDrivers,
  listActiveDrivers,
  listConfirmedBookings,
  assignDriverForDay,
  unassignDriver,
  DispatchError,
} from "@/lib/trips";
import { laDayOf } from "@/lib/datetime";

const TRIP_PREFIX = "TEST-DISPATCH-";
const DRV_PREFIX = "TEST-DRV-"; // driver NAMES use this so cleanup is targeted

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

/** Insert a bare confirmed trip with a known pickup instant (offset-carrying). */
async function seedTrip(ref: string, pickupAt: string) {
  const externalId = `${TRIP_PREFIX}${ref}`;
  // ends_at is 90 min later — irrelevant to the day rule, but a real column.
  const ends = new Date(new Date(pickupAt).getTime() + 90 * 60_000).toISOString();
  await sql`
    INSERT INTO trip (id, external_id, ghl_contact_id, ghl_opportunity_id, customer_name, pickup_at, ends_at, vehicle_class, status)
    VALUES (${`trip-${externalId}`}, ${externalId}, 'c-x', ${`opp-${ref}`}, ${`Test ${ref}`}, ${pickupAt}, ${ends}, 'first', 'booked')
    ON CONFLICT (external_id) DO UPDATE SET pickup_at = EXCLUDED.pickup_at, driver_id = NULL, status = 'booked'
  `;
  return externalId;
}

async function cleanup() {
  await sql`DELETE FROM trip WHERE external_id LIKE ${TRIP_PREFIX + "%"}`;
  await sql`DELETE FROM driver WHERE name LIKE ${DRV_PREFIX + "%"}`;
}

async function main() {
  console.log("\nDispatch — admin assignment, one driver = one trip per LA day\n");
  await cleanup();

  // ── laDayOf: the unit the whole rule keys on ────────────────────────────
  await check("laDayOf uses the LA calendar day, not UTC", async () => {
    // 9:00 PM PDT on Jul 30 is 04:00 UTC Jul 31. LA day must be the 30th.
    assert.equal(laDayOf("2026-07-30T21:00:00-07:00"), "2026-07-30");
    // Early-morning ride: 1 AM PDT Jul 31 is still the 31st locally.
    assert.equal(laDayOf("2026-07-31T01:00:00-07:00"), "2026-07-31");
  });

  // ── Roster CRUD ─────────────────────────────────────────────────────────
  let driverAId = "";
  let driverBId = "";
  await check("addDriver creates an active driver", async () => {
    const d = await addDriver({ name: `${DRV_PREFIX}Alice`, phone: "111", email: "a@x.com" });
    assert.equal(d.active, true);
    assert.equal(d.name, `${DRV_PREFIX}Alice`);
    driverAId = d.id;
    const d2 = await addDriver({ name: `${DRV_PREFIX}Bob` });
    driverBId = d2.id;
  });

  await check("addDriver rejects a duplicate active name (DispatchError)", async () => {
    await assert.rejects(
      () => addDriver({ name: `${DRV_PREFIX}Alice` }),
      (e) => e instanceof DispatchError,
    );
  });

  await check("updateDriver edits details", async () => {
    const d = await updateDriver({ id: driverAId, name: `${DRV_PREFIX}Alice`, phone: "999", email: "a2@x.com" });
    assert.ok(d);
    assert.equal(d!.phone, "999");
  });

  await check("listActiveDrivers returns only active drivers", async () => {
    const active = await listActiveDrivers();
    assert.ok(active.some((d) => d.id === driverAId));
    assert.ok(active.some((d) => d.id === driverBId));
  });

  // ── The core rule ───────────────────────────────────────────────────────
  await check("assign a free driver to a booking → ok", async () => {
    await seedTrip("A1", "2026-08-01T09:00:00-07:00");
    const r = await assignDriverForDay({ externalId: `${TRIP_PREFIX}A1`, driverId: driverAId });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.driver.id, driverAId);
  });

  await check("SAME driver, SAME day, different booking → BLOCKED", async () => {
    await seedTrip("A2", "2026-08-01T18:00:00-07:00"); // same LA day as A1, hours apart
    const r = await assignDriverForDay({ externalId: `${TRIP_PREFIX}A2`, driverId: driverAId });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "blocked");
      assert.equal(r.conflictRef, `${TRIP_PREFIX}A1`);
      assert.equal(r.day, "2026-08-01");
    }
  });

  await check("blocked booking stays UNASSIGNED (block did not write)", async () => {
    const rows = (await sql`SELECT driver_id FROM trip WHERE external_id = ${TRIP_PREFIX + "A2"}`) as Array<{ driver_id: string | null }>;
    assert.equal(rows[0].driver_id, null);
  });

  await check("SAME driver, DIFFERENT day → ok", async () => {
    await seedTrip("A3", "2026-08-02T09:00:00-07:00"); // next day
    const r = await assignDriverForDay({ externalId: `${TRIP_PREFIX}A3`, driverId: driverAId });
    assert.equal(r.ok, true);
  });

  await check("DIFFERENT driver, same day as A1 → ok", async () => {
    const r = await assignDriverForDay({ externalId: `${TRIP_PREFIX}A2`, driverId: driverBId });
    assert.equal(r.ok, true);
  });

  await check("reassigning the SAME booking to the SAME driver → ok (no self-block)", async () => {
    const r = await assignDriverForDay({ externalId: `${TRIP_PREFIX}A1`, driverId: driverAId });
    assert.equal(r.ok, true);
  });

  await check("late-night vs next-early-morning are DIFFERENT LA days → ok", async () => {
    // 11 PM PDT Aug 3 and 1 AM PDT Aug 4 are different LA days, so the same
    // driver may take both (the rule is per-day, and these are separate days).
    await seedTrip("N1", "2026-08-03T23:00:00-07:00");
    await seedTrip("N2", "2026-08-04T01:00:00-07:00");
    const r1 = await assignDriverForDay({ externalId: `${TRIP_PREFIX}N1`, driverId: driverBId });
    const r2 = await assignDriverForDay({ externalId: `${TRIP_PREFIX}N2`, driverId: driverBId });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
  });

  // ── Unassign frees the day ──────────────────────────────────────────────
  await check("unassign frees the driver's day (can then reassign that day)", async () => {
    // driverA holds A1 on Aug 1. Free it, then a NEW Aug-1 booking can take A.
    const un = await unassignDriver(`${TRIP_PREFIX}A1`);
    assert.ok(un);
    await seedTrip("A4", "2026-08-01T12:00:00-07:00");
    const r = await assignDriverForDay({ externalId: `${TRIP_PREFIX}A4`, driverId: driverAId });
    assert.equal(r.ok, true, "after unassign, the day should be free again");
  });

  // ── Not-found + retired cases ───────────────────────────────────────────
  await check("assigning a non-existent booking → no_such_booking", async () => {
    const r = await assignDriverForDay({ externalId: `${TRIP_PREFIX}NOPE`, driverId: driverAId });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "no_such_booking");
  });

  await check("assigning a retired driver → no_such_driver", async () => {
    await setDriverActive(driverBId, false); // retire Bob
    await seedTrip("R1", "2026-08-09T09:00:00-07:00");
    const r = await assignDriverForDay({ externalId: `${TRIP_PREFIX}R1`, driverId: driverBId });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "no_such_driver");
    await setDriverActive(driverBId, true); // reactivate for tidiness
  });

  await check("retired driver drops out of listActiveDrivers, stays in listDrivers", async () => {
    await setDriverActive(driverBId, false);
    const active = await listActiveDrivers();
    const all = await listDrivers();
    assert.ok(!active.some((d) => d.id === driverBId), "retired not in active list");
    assert.ok(all.some((d) => d.id === driverBId), "retired still in full roster");
    await setDriverActive(driverBId, true);
  });

  // ── Bookings list ───────────────────────────────────────────────────────
  await check("listConfirmedBookings returns our trips with driver names joined", async () => {
    const all = await listConfirmedBookings();
    const ours = all.filter((b) => b.external_id.startsWith(TRIP_PREFIX));
    assert.ok(ours.length > 0);
    const a4 = ours.find((b) => b.external_id === `${TRIP_PREFIX}A4`);
    assert.ok(a4);
    assert.equal(a4!.driver_name, `${DRV_PREFIX}Alice`); // A4 was assigned to Alice
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
    console.log("✓ Dispatch admin-assignment + per-day block verified.\n");
    process.exit(0);
  });
