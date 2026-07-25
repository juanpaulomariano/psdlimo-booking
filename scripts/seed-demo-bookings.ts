/**
 * Seed a few REAL demo bookings — end to end, through the production code path.
 * Run: `npm run seed:bookings`
 *
 * Each booking is pushed through the SAME functions the paid-invoice webhook uses
 * (`pushBookingToGHL` → contact + opportunity + appointment in GHL, then
 * `upsertTrip` → the dispatch DB row), so what you get is indistinguishable from a
 * genuine paid booking: it appears in GHL AND on the /admin/dispatch board.
 *
 * DEMO DATA. External ids are prefixed `psdlimo-demo-` so they're easy to spot and
 * clear later. Two bookings share a pickup DAY on purpose, so the one-driver-one-
 * trip-per-day block can be demonstrated. Idempotent-ish: re-running creates NEW
 * opportunities (GHL dedupes the contact by email, but each booking is distinct).
 */

import { pushBookingToGHL } from "@/lib/ghl";
import { upsertTrip } from "@/lib/trips";
import type { BookingMetadata } from "@/lib/booking-schema";
import { laWallClockToISO } from "@/lib/datetime";

/** Build a valid BookingMetadata for a simple point-to-point distance ride. */
function booking(o: {
  ref: string;
  name: string;
  email: string;
  phone: string;
  date: string; // YYYY-MM-DD (LA)
  time: string; // HH:MM (LA)
  pickup: string;
  dropoff: string;
  vehicle: BookingMetadata["vehicle_class"];
  total: number;
  durationMin: number;
}): BookingMetadata {
  const pickupAt = laWallClockToISO(o.date, o.time);
  return {
    external_id: o.ref,
    ride_type: "distance",
    pickup_location: o.pickup,
    dropoff_location: o.dropoff,
    pickup_datetime: pickupAt,
    return_datetime: "",
    vehicle_class: o.vehicle,
    passengers: 2,
    luggage: 2,
    hours: null,
    duration_minutes: o.durationMin,
    addons: "",
    flight_number: "",
    special_requests: "",
    company_name: "",
    quoted_total: o.total,
    currency: "USD",
    breakdown_json: JSON.stringify({ note: "demo seed" }),
    contact_name: o.name,
    contact_email: o.email,
    contact_phone: o.phone,
    tags_csv: "source-website,payment-paid,method-card,ride-pointtopoint",
  };
}

// A near-future date so the bookings look upcoming on the board.
const D1 = "2026-08-15";
const D2 = "2026-08-16";

const BOOKINGS: BookingMetadata[] = [
  booking({
    ref: "psdlimo-demo-0001",
    name: "Olivia Bennett",
    email: "olivia.bennett.demo@psdlimo.test",
    phone: "+14155550101",
    date: D1,
    time: "09:00",
    pickup: "SFO International Terminal, San Francisco, CA",
    dropoff: "The Ritz-Carlton, 600 Stockton St, San Francisco, CA",
    vehicle: "first",
    total: 168,
    durationMin: 35,
  }),
  // SAME DAY as #1 — assign the same driver to both to see the block.
  booking({
    ref: "psdlimo-demo-0002",
    name: "Marcus Hale",
    email: "marcus.hale.demo@psdlimo.test",
    phone: "+14155550102",
    date: D1,
    time: "18:30",
    pickup: "Salesforce Tower, 415 Mission St, San Francisco, CA",
    dropoff: "SFO International Terminal, San Francisco, CA",
    vehicle: "business",
    total: 142,
    durationMin: 40,
  }),
  booking({
    ref: "psdlimo-demo-0003",
    name: "Priya Raman",
    email: "priya.raman.demo@psdlimo.test",
    phone: "+14155550103",
    date: D2,
    time: "11:00",
    pickup: "Four Seasons Hotel, 757 Market St, San Francisco, CA",
    dropoff: "Napa Valley, Yountville, CA",
    vehicle: "suv-van",
    total: 395,
    durationMin: 95,
  }),
];

async function main() {
  console.log("\nSeeding demo bookings through the real GHL + DB path…\n");
  for (const b of BOOKINGS) {
    try {
      const result = await pushBookingToGHL(b);
      await upsertTrip(b, {
        contactId: result.contactId,
        opportunityId: result.opportunityId,
      });
      console.log(
        `  ✓ ${b.external_id}  ${b.contact_name}  → opportunity ${result.opportunityId}` +
          `${result.created ? "" : " (already existed)"}`,
      );
    } catch (err) {
      console.error(`  ✗ ${b.external_id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(
    "\n✓ Done. Open /admin/dispatch — the bookings appear there, and each is a real\n" +
      "  opportunity in GHL (Confirmed stage). Assign Marco to both same-day rides\n" +
      "  (demo-0001 and demo-0002) to see the one-trip-per-day block.\n",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✖ Seed failed:\n", err);
    process.exit(1);
  });
