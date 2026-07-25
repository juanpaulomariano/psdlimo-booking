/**
 * Remove the seeded demo bookings — from GHL AND the dispatch DB.
 * Run: `npm run clean:bookings`
 *
 * The inverse of `seed:bookings`. For every trip whose external_id starts with
 * `psdlimo-demo-`, it deletes the linked GHL opportunity and contact, then the
 * `trip` row. Safe to run repeatedly (skips what's already gone). Use it to get a
 * clean slate before a real dry run or the client demo; re-seed anytime with
 * `npm run seed:bookings`.
 *
 * ONLY touches `psdlimo-demo-*` rows — real bookings are never matched.
 */

import { neon } from "@neondatabase/serverless";

const GHL_API = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

const DATABASE_URL = process.env.DATABASE_URL;
const GHL_TOKEN = process.env.GHL_PRIVATE_TOKEN;
if (!DATABASE_URL) {
  console.error("\n✖ DATABASE_URL is not set.\n");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

async function ghlDelete(path: string): Promise<"ok" | "missing" | "error"> {
  if (!GHL_TOKEN) return "error";
  try {
    const res = await fetch(`${GHL_API}${path}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: API_VERSION, Accept: "application/json" },
    });
    if (res.ok) return "ok";
    // GHL returns 404 OR 400 for an id that no longer exists — both mean "gone".
    if (res.status === 404 || res.status === 400) return "missing";
    return "error";
  } catch {
    return "error";
  }
}

type DemoTrip = { external_id: string; customer_name: string; ghl_contact_id: string; ghl_opportunity_id: string };

async function main() {
  console.log("\nCleaning demo bookings (GHL + DB)…\n");

  const trips = (await sql`
    SELECT external_id, customer_name, ghl_contact_id, ghl_opportunity_id
    FROM trip WHERE external_id LIKE 'psdlimo-demo-%'
  `) as DemoTrip[];

  if (trips.length === 0) {
    console.log("  Nothing to clean — no psdlimo-demo-* bookings found.\n");
    return;
  }

  for (const t of trips) {
    // Opportunity first, then contact (deleting a contact would orphan the opp).
    if (t.ghl_opportunity_id) {
      const r = await ghlDelete(`/opportunities/${t.ghl_opportunity_id}`);
      console.log(`  opportunity ${t.ghl_opportunity_id} → ${r}`);
    }
    if (t.ghl_contact_id) {
      const r = await ghlDelete(`/contacts/${t.ghl_contact_id}`);
      console.log(`  contact ${t.ghl_contact_id} → ${r}`);
    }
  }

  const deleted = (await sql`
    DELETE FROM trip WHERE external_id LIKE 'psdlimo-demo-%' RETURNING external_id
  `) as Array<{ external_id: string }>;

  console.log(`\n✓ Removed ${deleted.length} demo trip row(s) and their GHL records.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✖ Cleanup failed:\n", err);
    process.exit(1);
  });
