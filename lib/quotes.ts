/**
 * Quote pricing — the owner-priced side of the complex-booking flow.
 *
 * A customer requests a quote (see createQuoteLead) → the owner reviews it and
 * PRICES it here: they set the amount, a primary pickup date/time (the anchor
 * the system needs), and the itinerary as free text. This creates a real invoice
 * for that exact amount, reusing the SAME payment machinery as an instant
 * booking, and writes the payment link back onto the GHL opportunity. A GHL
 * workflow emails the customer the link; when they pay, the EXISTING webhook
 * confirms it and moves the opportunity to Confirmed — no new confirm logic.
 *
 * WHY THIS IS SAFE re: "never trust a client price": the amount here is the
 * OWNER'S, entered in the admin behind requireAdmin — not a customer-submitted
 * value. It is validated (bounded, positive) and it is the whole point of a
 * manual quote. This is the one legitimate place a human sets the price.
 *
 * The complex itinerary is NOT forced into structured fields (a custom trip may
 * have many stops and flexible timing). Only the anchor (date + amount) is
 * structured; everything else lives in the itinerary text, which the owner and
 * driver read — exactly how a human runs a multi-stop job.
 */

import "server-only";
import { nanoid } from "nanoid";
import type { BookingMetadata } from "@/lib/booking-schema";
import { createInvoice } from "@/lib/payments";
import { getVehicleClass, VEHICLE_CLASS_IDS } from "@/config/rates";

export type PriceQuoteInput = {
  /** The GHL opportunity id of the quote lead being priced. */
  opportunityId: string;
  contact: { name: string; email: string; phone: string };
  /** The owner's quoted price, in USD. */
  amountUSD: number;
  /** The anchor pickup instant — ISO 8601 with offset (America/Los_Angeles). */
  pickupAtISO: string;
  /** Vehicle class id, or a sensible default if the owner leaves it. */
  vehicleClass: (typeof VEHICLE_CLASS_IDS)[number];
  /** Approximate party size. */
  passengers: number;
  /** The full itinerary / trip description (all stops, waits, notes). */
  itinerary: string;
};

export type PriceQuoteResult = {
  /** Our booking reference (also the idempotency key). */
  externalId: string;
  /** The hosted payment page URL to send the customer. */
  invoiceUrl: string;
  chargedAmount: number;
  chargedCurrency: string;
};

/**
 * Build the booking metadata for a priced quote and create its invoice.
 *
 * The metadata deliberately mirrors a normal booking so the webhook confirms it
 * with zero special-casing: a valid vehicle class, the anchor as pickup_datetime,
 * the itinerary as special_requests, and the tags that mark it a paid website
 * booking that ORIGINATED as a custom quote (`ride-custom`).
 */
export async function priceQuoteAndInvoice(
  input: PriceQuoteInput,
  baseUrl: string,
): Promise<PriceQuoteResult> {
  const externalId = `psdlimo-${Date.now()}-${nanoid(8)}`;

  // Label the trip for the CRM/appointment. The itinerary carries the detail;
  // this is just the human-facing title.
  const vehicleLabel = (() => {
    try {
      return getVehicleClass(input.vehicleClass).label;
    } catch {
      return input.vehicleClass;
    }
  })();

  const metadata: BookingMetadata = {
    external_id: externalId,
    ride_type: "distance", // a custom trip is modelled as a distance-type booking
    pickup_location: "See itinerary",
    dropoff_location: "See itinerary",
    pickup_datetime: input.pickupAtISO,
    return_datetime: "",
    vehicle_class: input.vehicleClass,
    passengers: input.passengers,
    luggage: 0,
    hours: null,
    // No routes lookup for a custom trip; give the appointment a nominal block so
    // one still gets created. The owner/driver run the trip from the itinerary.
    duration_minutes: 120,
    addons: "",
    flight_number: "",
    // The full itinerary lives here — visible on the opportunity, no note needed.
    special_requests: input.itinerary.slice(0, 2000),
    company_name: "",
    quoted_total: input.amountUSD,
    currency: "USD",
    breakdown_json: JSON.stringify({ custom_quote: true, amount: input.amountUSD }),
    contact_name: input.contact.name,
    contact_email: input.contact.email,
    contact_phone: input.contact.phone,
    // A paid website card booking that ORIGINATED as a custom quote. Internal
    // hyphen tags; mapped to dotted CRM tags by tagsForBooking().
    tags_csv: "source-website,payment-paid,method-card,ride-custom",
  };

  const invoice = await createInvoice({
    externalId,
    amountUSD: input.amountUSD,
    customer: input.contact,
    description: `Custom quote · ${vehicleLabel} · ${input.contact.name}`,
    metadata,
    successUrl: `${baseUrl}/success?ref=${encodeURIComponent(externalId)}`,
    failureUrl: `${baseUrl}/cancelled?ref=${encodeURIComponent(externalId)}`,
  });

  return {
    externalId,
    invoiceUrl: invoice.invoiceUrl,
    chargedAmount: invoice.chargedAmount,
    chargedCurrency: invoice.chargedCurrency,
  };
}
