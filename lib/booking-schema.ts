/**
 * Shared zod schemas — ONE schema, THREE consumers (quote, checkout, webhook).
 *
 * If a field is validated differently in two places, the two places will
 * eventually disagree and the disagreement will surface as a mispriced invoice
 * or a malformed CRM record. So it lives here.
 *
 * Note on timezone: pickupAt is an ISO 8601 string WITH an explicit offset
 * (e.g. "2026-07-22T09:00:00-07:00"). We never store a naive local datetime —
 * the server runs in UTC, the client operates in America/Los_Angeles, and a
 * bare timestamp would silently shift by 7-8 hours. See lib/datetime.ts.
 */

import { z } from "zod";
import {
  ADD_ON_IDS,
  FLAT_ROUTE_IDS,
  MAX_HOURS,
  MAX_LUGGAGE,
  MAX_PASSENGERS,
  MIN_HOURS,
  VEHICLE_CLASS_IDS,
} from "@/config/rates";

/** ISO 8601 with a REQUIRED explicit offset (Z or ±HH:MM). */
const isoWithOffset = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
    "pickupAt must be an ISO 8601 datetime with an explicit UTC offset",
  )
  .refine((s) => !Number.isNaN(Date.parse(s)), "pickupAt is not a parseable datetime");

const addressSchema = z
  .string()
  .trim()
  .min(3, "Please enter a valid address")
  .max(300, "Address is too long");

/** Fields common to all three ride types. */
const rideCommon = {
  pickupAt: isoWithOffset,
  vehicleClass: z.enum(VEHICLE_CLASS_IDS),
  passengers: z.coerce.number().int().min(1).max(MAX_PASSENGERS),
  luggage: z.coerce.number().int().min(0).max(MAX_LUGGAGE),
  addOns: z.array(z.enum(ADD_ON_IDS)).default([]),
};

/**
 * Discriminated union on rideType. This is deliberate: it makes "hourly ride
 * with no hours" or "flat ride with no route" unrepresentable, so the pricing
 * engine never has to defend against those combinations at runtime.
 */
export const rideDetailsSchema = z.discriminatedUnion("rideType", [
  z
    .object({
      ...rideCommon,
      rideType: z.literal("distance"),
      pickup: addressSchema,
      dropoff: addressSchema,
      /**
       * When present, this is a ROUND TRIP: the same route back, with its own
       * return pickup time. A round trip is modelled as a distance ride + a
       * return, rather than a separate ride type, so it reuses all the distance
       * logic and the union stays clean. `returnAt` must be after the outbound
       * pickup — enforced here so BOTH quote and checkout reject a return in the
       * past relative to pickup (the UI check alone is trivially bypassed).
       */
      returnAt: isoWithOffset.optional(),
    })
    .refine(
      (r) => !r.returnAt || new Date(r.returnAt).getTime() > new Date(r.pickupAt).getTime(),
      { message: "The return time must be after the pickup time.", path: ["returnAt"] },
    ),
  z.object({
    ...rideCommon,
    rideType: z.literal("hourly"),
    pickup: addressSchema,
    hours: z.coerce.number().int().min(MIN_HOURS).max(MAX_HOURS),
  }),
  z.object({
    ...rideCommon,
    rideType: z.literal("flat"),
    flatRouteId: z.enum(FLAT_ROUTE_IDS),
  }),
]);

export type RideDetails = z.infer<typeof rideDetailsSchema>;

/** POST /api/quote */
export const quoteRequestSchema = z.object({ ride: rideDetailsSchema });
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

/**
 * Contact details, collected at step 3.
 *
 * specialRequests is user free-text bound for Xendit invoice metadata, which has
 * size limits — capped at 400 here AND truncated server-side before it is
 * attached to the invoice (belt and braces; see CLAUDE.md).
 */
export const contactSchema = z.object({
  name: z.string().trim().min(2, "Please enter your full name").max(120),
  email: z.email("Please enter a valid email address").max(200),
  phone: z
    .string()
    .trim()
    .min(7, "Please enter a valid phone number")
    .max(32)
    .regex(/^[+()\-.\s\d]+$/, "Phone number contains invalid characters"),
  /** Shown only when pickup or dropoff is an airport; optional everywhere. */
  flightNumber: z.string().trim().max(16).optional().or(z.literal("")),
  /**
   * Optional company, for corporate receipts. NEVER required — an empty value
   * infers nothing. When present it identifies a corporate booking (company_name
   * contact field + service.corporate / client.corporate tags).
   */
  company: z.string().trim().max(120).optional().or(z.literal("")),
  specialRequests: z.string().trim().max(400, "Please keep this under 400 characters").optional().or(z.literal("")),
});

export type Contact = z.infer<typeof contactSchema>;

/**
 * POST /api/checkout
 *
 * NOTE what is absent: there is no `total` field, by design. The checkout route
 * recomputes the price from `ride` via lib/pricing.ts. A client-submitted total
 * is not merely ignored — there is nowhere to put it. See CLAUDE.md invariant 1.
 */
export const checkoutRequestSchema = z.object({
  ride: rideDetailsSchema,
  contact: contactSchema,
  /** Only "card" is live for the demo; paypal/cash render as disabled. */
  paymentMethod: z.literal("card"),
});

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/**
 * The booking payload stored in Xendit invoice metadata — this demo's "database".
 *
 * Xendit metadata values must be flat scalars, so nested objects are serialized
 * to strings (addOns as CSV, breakdown as JSON). This schema is what the webhook
 * parses the metadata back out with, which is why it lives beside the request
 * schemas: if checkout writes a key the webhook does not expect, validation
 * fails loudly here rather than producing a half-populated CRM record.
 */
export const bookingMetadataSchema = z.object({
  external_id: z.string().min(1),
  ride_type: z.enum(["distance", "hourly", "flat"]),
  pickup_location: z.string(),
  dropoff_location: z.string(),
  pickup_datetime: isoWithOffset,
  /** Return pickup for a round trip; "" for a one-way. */
  return_datetime: z.string(),
  vehicle_class: z.enum(VEHICLE_CLASS_IDS),
  passengers: z.coerce.number().int(),
  luggage: z.coerce.number().int(),
  hours: z.coerce.number().int().nullable().optional(),
  /**
   * Estimated ride duration in minutes. Drives the appointment END in the
   * webhook. For distance rides it is the Routes API figure carried through from
   * the quote; for flat routes it comes from flatRouteDurations; hourly rides use
   * `hours` instead and leave this null.
   */
  duration_minutes: z.coerce.number().int().nullable().optional(),
  addons: z.string(), // CSV of add-on ids, "" when none
  flight_number: z.string(),
  special_requests: z.string(),
  /** Optional company for corporate bookings; "" when not given. */
  company_name: z.string(),
  quoted_total: z.coerce.number(),
  currency: z.string(),
  /** JSON-serialized PriceBreakdown, for the audit trail on the opportunity. */
  breakdown_json: z.string(),
  contact_name: z.string(),
  contact_email: z.string(),
  contact_phone: z.string(),
  /**
   * All CRM tags for this booking, derived server-side at checkout and stored as
   * a CSV so the webhook applies exactly what checkout decided — one source of
   * truth for tag logic. Internal HYPHEN enum values (service-airport); mapped to
   * the dotted CRM tags (service.airport) by tagsForBooking() in lib/ghl.ts.
   */
  tags_csv: z.string(),
});

export type BookingMetadata = z.infer<typeof bookingMetadataSchema>;

/** Internal tag vocabulary — hyphenated. Mapped to dotted CRM tags in lib/ghl.ts.
 *  Namespaces by concern: source / payment (outcome) / method / ride (type) /
 *  client. See deriveBookingTags in config/rates.ts. */
export const BOOKING_TAGS = [
  "source-website",
  "ride-airport",
  "ride-hourly",
  "ride-intercity",
  "ride-winetour",
  "ride-group",
  "ride-corporate",
  "ride-pointtopoint",
  "ride-roundtrip",
  "method-card",
  "payment-paid",
  "client-corporate",
] as const;

export type BookingTag = (typeof BOOKING_TAGS)[number];
