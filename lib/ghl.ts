/**
 * GoHighLevel API v2 client.
 *
 * This module is called from EXACTLY ONE PLACE: the verified Xendit callback in
 * app/api/xendit-webhook. No other route may write to the CRM — paid ⇔ exists in
 * GHL, and an abandoned invoice must leave zero trace. See CLAUDE.md invariant 2.
 *
 * Every contract below was verified against the live sandbox before being coded,
 * because several plausible-looking approaches silently do not work:
 *
 *   · `q=` free-text search does NOT match custom-field values. Searching for a
 *     payment_ref_id returns 0 results even when the opportunity exists. Using it
 *     for idempotency would mean the duplicate check silently never matches, and
 *     every re-sent callback would create a duplicate booking.
 *   · Opportunity SEARCH results omit `customFields` entirely, but
 *     `GET /opportunities/{id}` includes them — and search scoped by
 *     `contact_id` DOES include them. That is what makes the check below work.
 *   · Custom-field values come back as `fieldValue` (camelCase) on read, but are
 *     written as `field_value` (snake_case). Yes, really.
 *   · POST /opportunities/search with a customFields filter returns 422.
 */

import "server-only";
import fieldConfig from "@/config/ghl-fields.json";
import type { BookingMetadata } from "@/lib/booking-schema";
import { formatPickupShort } from "@/lib/datetime";
import { getVehicleClass } from "@/config/rates";

const GHL_API = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

export class GHLError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** GHL's errors are only useful in the body — always carried through. */
    readonly body?: string,
  ) {
    super(message);
    this.name = "GHLError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new GHLError(`${name} is not set. Add it to .env.local (see .env.example).`);
  return value;
}

async function ghlFetch(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<unknown> {
  const token = requireEnv("GHL_PRIVATE_TOKEN");

  let response: Response;
  try {
    response = await fetch(`${GHL_API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: API_VERSION,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch (err) {
    throw new GHLError(
      `Could not reach GoHighLevel: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = await response.text();

  if (!response.ok) {
    // Log the body — GHL's status codes alone say nothing useful.
    console.error(`[ghl] ${init.method} ${path} -> ${response.status}: ${text}`);
    throw new GHLError(`GoHighLevel returned ${response.status} for ${path}`, response.status, text);
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new GHLError(`GoHighLevel returned unparseable JSON for ${path}`, response.status, text);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Field helpers
 * ══════════════════════════════════════════════════════════════════════════ */

type CustomFieldWrite = { id: string; field_value: string | number };

/**
 * Skip empty values rather than writing blanks over a populated field.
 *
 * Note `0` is treated as empty for the fields this writes. That is safe here
 * because no field in this booking has a meaningful zero — luggage 0 is the one
 * candidate, and it is passed via `?? null` handling upstream. It matters
 * because Xendit returns absent numeric metadata as "" which coerces to 0, and
 * "Hours Booked: 0" on a point-to-point ride reads as a data-entry bug to
 * anyone looking at the CRM.
 */
function field(
  id: string | undefined,
  value: string | number | null | undefined,
): CustomFieldWrite | null {
  if (!id) return null;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return { id, field_value: value };
}

function compact(fields: (CustomFieldWrite | null)[]): CustomFieldWrite[] {
  return fields.filter((f): f is CustomFieldWrite => f !== null);
}

/** Split a full name into GHL's first/last. Everything after the first token
 *  is the surname — wrong for some naming conventions, but better than dropping
 *  it, and the full name is preserved on the opportunity name regardless. */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** GHL DATE fields store a date, not a datetime — it truncated our ISO string
 *  to "2026-07-24" in testing. The full offset-carrying datetime is preserved
 *  in the opportunity name and description so the time is never lost. */
function toGHLDate(iso: string): string {
  return iso.slice(0, 10);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Contact
 * ══════════════════════════════════════════════════════════════════════════ */

export type UpsertContactInput = {
  name: string;
  email: string;
  phone: string;
  tags: string[];
  /** Contact-level only: attributes of the PERSON, safe to overwrite. */
  preferredVehicle?: string;
};

/**
 * Upsert the customer. GHL dedupes on email + phone, so a repeat customer
 * resolves to the same contact rather than accumulating duplicates.
 *
 * NOTE what is NOT written here: no pickup, no price, no booking detail. That is
 * per-booking data and belongs on the opportunity — writing it to the contact
 * would make a repeat customer's second booking overwrite their first.
 */
export async function upsertContact(input: UpsertContactInput): Promise<string> {
  const locationId = requireEnv("GHL_LOCATION_ID");
  const { firstName, lastName } = splitName(input.name);

  const customFields = compact([
    field(fieldConfig.contact.preferred_vehicle, input.preferredVehicle),
    field(fieldConfig.contact.last_ride_date, toGHLDate(new Date().toISOString())),
  ]);

  const response = (await ghlFetch("/contacts/upsert", {
    method: "POST",
    body: {
      locationId,
      firstName,
      lastName,
      name: input.name,
      email: input.email,
      phone: input.phone,
      tags: input.tags,
      ...(customFields.length > 0 ? { customFields } : {}),
    },
  })) as { contact?: { id?: string }; id?: string };

  const contactId = response.contact?.id ?? response.id;
  if (!contactId) {
    throw new GHLError("Contact upsert succeeded but returned no contact id.");
  }
  return contactId;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Idempotency
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Custom-field values come back under DIFFERENT KEYS depending on the endpoint,
 * which is a genuine trap — reading only `fieldValue` makes the idempotency
 * check silently never match, and every re-sent callback then attempts a
 * duplicate booking.
 *
 *   GET  /opportunities/{id}      -> { id, fieldValue: "psdlimo-…" }
 *   GET  /opportunities/search    -> { id, type: "string",
 *                                      fieldValueString: "psdlimo-…" }
 *                                    (also fieldValueDate / fieldValueNumber,
 *                                     …Array, per the field's type)
 *
 * Verified against the live sandbox. readFieldValue handles every shape.
 */
type GHLFieldValue = {
  id: string;
  type?: string;
  fieldValue?: unknown;
  field_value?: unknown;
  fieldValueString?: unknown;
  fieldValueNumber?: unknown;
  fieldValueDate?: unknown;
  fieldValueArray?: unknown;
};

type SearchedOpportunity = {
  id: string;
  name?: string;
  customFields?: GHLFieldValue[];
};

/** Extract a custom field's value regardless of which key GHL used. */
function readFieldValue(field: GHLFieldValue | undefined): string | null {
  if (!field) return null;
  const candidate =
    field.fieldValueString ??
    field.fieldValue ??
    field.field_value ??
    field.fieldValueNumber ??
    field.fieldValueDate;
  if (candidate === null || candidate === undefined) return null;
  return String(candidate);
}

/**
 * Has this booking already been recorded?
 *
 * Scoped to the contact, because opportunity search returns `customFields` only
 * when filtered by `contact_id` — a location-wide search omits them, and the
 * free-text `q=` parameter does not look inside custom fields at all.
 *
 * Scoping to the contact is also correct rather than merely convenient: the
 * contact is deduped by email, so a duplicate callback for the same booking
 * always resolves to the same contact, and therefore always finds its own prior
 * opportunity.
 *
 * @returns the existing opportunity id, or null if this booking is new.
 */
export async function findOpportunityByPaymentRef(
  contactId: string,
  paymentRefId: string,
): Promise<string | null> {
  const locationId = requireEnv("GHL_LOCATION_ID");
  const refFieldId = fieldConfig.opportunity.payment_ref_id;

  const response = (await ghlFetch(
    `/opportunities/search?location_id=${encodeURIComponent(locationId)}` +
      `&contact_id=${encodeURIComponent(contactId)}&limit=100`,
  )) as { opportunities?: SearchedOpportunity[] };

  for (const opportunity of response.opportunities ?? []) {
    const refField = (opportunity.customFields ?? []).find((f) => f.id === refFieldId);
    if (readFieldValue(refField) === paymentRefId) {
      return opportunity.id;
    }
  }

  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Opportunity
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the booking as an opportunity in the Confirmed stage.
 *
 * Confirmed rather than New Inquiry by design: the money has already been taken,
 * so routing it through the earlier stages would be theatre.
 */
export async function createBookingOpportunity(
  contactId: string,
  booking: BookingMetadata,
): Promise<string> {
  const locationId = requireEnv("GHL_LOCATION_ID");
  const opportunityFields = fieldConfig.opportunity;

  const vehicleLabel = (() => {
    try {
      return getVehicleClass(booking.vehicle_class).label;
    } catch {
      return booking.vehicle_class;
    }
  })();

  const route =
    booking.ride_type === "hourly"
      ? `${booking.pickup_location} (${booking.hours ?? "?"} hrs)`
      : `${booking.pickup_location} → ${booking.dropoff_location}`;

  const customFields = compact([
    field(opportunityFields.pickup_location, booking.pickup_location),
    field(opportunityFields.dropoff_location, booking.dropoff_location),
    field(opportunityFields.pickup_datetime, toGHLDate(booking.pickup_datetime)),
    field(opportunityFields.ride_type, booking.ride_type),
    field(opportunityFields.vehicle_class, booking.vehicle_class),
    field(opportunityFields.passenger_count, booking.passengers),
    field(opportunityFields.luggage_count, booking.luggage),
    field(opportunityFields.flight_number, booking.flight_number),
    field(opportunityFields.addons, booking.addons),
    // Only hourly rides have hours. Xendit returns absent numeric metadata as
    // "", which coerces to 0 — and "Hours Booked: 0" on a point-to-point ride
    // looks like a bug to anyone reading the CRM.
    field(
      opportunityFields.hours_booked,
      booking.ride_type === "hourly" && booking.hours ? booking.hours : null,
    ),
    // Both prices are the USD figure. The invoice may have been denominated in
    // PHP, but the CRM records the business currency — never pesos.
    field(opportunityFields.quoted_price, booking.quoted_total),
    field(opportunityFields.final_price, booking.quoted_total),
    field(opportunityFields.booking_source, "website"),
    field(opportunityFields.special_requests, booking.special_requests),
    // The idempotency key. Everything above is data; this one is a guarantee.
    field(opportunityFields.payment_ref_id, booking.external_id),
  ]);

  const response = (await ghlFetch("/opportunities/", {
    method: "POST",
    body: {
      pipelineId: fieldConfig.pipelineId,
      locationId,
      contactId,
      pipelineStageId: fieldConfig.stageConfirmedId,
      name: `${booking.contact_name} — ${formatPickupShort(booking.pickup_datetime)} — ${route}`,
      status: "open",
      monetaryValue: booking.quoted_total,
      customFields,
    },
  })) as { opportunity?: { id?: string }; id?: string };

  const opportunityId = response.opportunity?.id ?? response.id;
  if (!opportunityId) {
    throw new GHLError("Opportunity creation succeeded but returned no id.");
  }

  console.log(
    `[ghl] opportunity ${opportunityId} created for ${booking.external_id} ` +
      `(${vehicleLabel}, $${booking.quoted_total})`,
  );

  return opportunityId;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tags
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Tags for a paid booking. NOTE THE DOT NOTATION — the sandbox uses
 * `source.website`, not `source-website`. The CRM is the source of truth for tag
 * names, so the code matches the CRM rather than the original spec.
 */
export function tagsForBooking(booking: BookingMetadata): string[] {
  const { tags } = fieldConfig;

  const serviceTag =
    booking.service_tag === "service-airport"
      ? tags.serviceAirport
      : booking.service_tag === "service-hourly"
        ? tags.serviceHourly
        : tags.servicePointToPoint;

  return [tags.source, tags.payCard, tags.payPaid, serviceTag];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Orchestration
 * ══════════════════════════════════════════════════════════════════════════ */

export type PushResult =
  | { created: true; contactId: string; opportunityId: string }
  | { created: false; contactId: string; opportunityId: string; reason: "duplicate" };

/**
 * Push a paid booking into the CRM.
 *
 * Order matters: upsert the contact FIRST, because the idempotency check is
 * scoped to the contact. Upserting is itself idempotent, so doing it before the
 * duplicate check costs nothing and cannot create a duplicate contact.
 *
 * Throws on any GHL failure. The caller must let that propagate as a 500 so the
 * payment provider retries — swallowing it would lose the booking silently.
 */
export async function pushBookingToGHL(booking: BookingMetadata): Promise<PushResult> {
  const tags = tagsForBooking(booking);

  const contactId = await upsertContact({
    name: booking.contact_name,
    email: booking.contact_email,
    phone: booking.contact_phone,
    tags,
    preferredVehicle: booking.vehicle_class,
  });

  const existing = await findOpportunityByPaymentRef(contactId, booking.external_id);
  if (existing) {
    console.log(
      `[ghl] booking ${booking.external_id} already recorded as opportunity ${existing} — ` +
        `skipping. This is the idempotency guard working, not an error.`,
    );
    return { created: false, contactId, opportunityId: existing, reason: "duplicate" };
  }

  try {
    const opportunityId = await createBookingOpportunity(contactId, booking);
    return { created: true, contactId, opportunityId };
  } catch (err) {
    /*
     * SECOND LINE OF DEFENCE. GHL enforces its own per-contact duplicate rule
     * and rejects with 400 "Can not create duplicate opportunity for the
     * contact", helpfully including the existing id in `meta.existingId`.
     *
     * That is not a failure — it means the booking is already recorded, which
     * is precisely the outcome we want. Treating it as an error would return
     * 500 and make the provider retry a callback that has already succeeded,
     * forever.
     *
     * This also covers the race where two callbacks arrive close enough
     * together that both pass the search above before either has written.
     */
    if (err instanceof GHLError && err.status === 400 && err.body) {
      try {
        const parsed = JSON.parse(err.body) as {
          message?: string;
          meta?: { existingId?: string };
        };
        const existingId = parsed.meta?.existingId;
        if (existingId && /duplicate opportunity/i.test(parsed.message ?? "")) {
          console.log(
            `[ghl] GHL rejected a duplicate for ${booking.external_id}; ` +
              `existing opportunity ${existingId}. Treating as already-recorded.`,
          );
          return { created: false, contactId, opportunityId: existingId, reason: "duplicate" };
        }
      } catch {
        // Body was not the shape we expected — fall through and rethrow.
      }
    }
    throw err;
  }
}
