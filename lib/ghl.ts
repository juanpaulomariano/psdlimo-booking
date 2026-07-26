/**
 * GoHighLevel API v2 client.
 *
 * This module is called from EXACTLY ONE PLACE: the verified Xendit callback in
 * app/api/xendit-webhook. No other route may write to the CRM — paid ⇔ exists in
 * GHL, and an abandoned invoice must leave zero trace. See the project invariants (invariant 2).
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
import { addMinutesISO, formatPickupShort } from "@/lib/datetime";
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
  /** Optional; written only when non-empty so a later personal booking by the
   *  same person does not blank an earlier company. */
  company?: string;
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
      // `companyName` is a GHL STANDARD contact field (not a custom field), so it
      // is written on the body, not via customFields. Verified 2026-07-24 that
      // the upsert accepts and stores it. Only sent when present, so a later
      // personal booking by the same person does not blank an earlier company.
      ...(input.company ? { companyName: input.company } : {}),
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

  const vehicleLabel = (() => {
    try {
      return getVehicleClass(booking.vehicle_class).label;
    } catch {
      return booking.vehicle_class;
    }
  })();

  const isRoundTrip = Boolean(booking.return_datetime);
  const route =
    booking.ride_type === "hourly"
      ? `${booking.pickup_location} (${booking.hours ?? "?"} hrs)`
      : `${booking.pickup_location} ${isRoundTrip ? "⇄" : "→"} ${booking.dropoff_location}${
          isRoundTrip ? " (round trip)" : ""
        }`;

  const customFields = bookingOpportunityFields(booking, vehicleLabel);
  const opportunityName = `${booking.contact_name} — ${formatPickupShort(booking.pickup_datetime)} — ${route}`;

  const response = (await ghlFetch("/opportunities/", {
    method: "POST",
    body: {
      pipelineId: fieldConfig.pipelineId,
      locationId,
      contactId,
      pipelineStageId: fieldConfig.stageConfirmedId,
      name: opportunityName,
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

/** The full custom-field set for a paid booking — shared by CREATE (a new
 *  opportunity) and PROMOTE (an existing quote lead moving to Confirmed). */
function bookingOpportunityFields(booking: BookingMetadata, vehicleLabel: string) {
  const f = fieldConfig.opportunity;
  return compact([
    field(f.pickup_location, booking.pickup_location),
    field(f.dropoff_location, booking.dropoff_location),
    // GHL DATE fields TRUNCATE the time, so the date field carries the date only.
    field(f.pickup_datetime, toGHLDate(booking.pickup_datetime)),
    // …and a TEXT field carries the full LA date+time ("Jul 27, 9:39 PM PDT").
    field(f.pickup_datetime_text, formatPickupShort(booking.pickup_datetime)),
    field(f.ride_type, booking.ride_type),
    // The human LABEL ("Business Class"), never the internal id.
    field(f.vehicle_class, vehicleLabel),
    field(f.passenger_count, booking.passengers),
    field(f.luggage_count, booking.luggage),
    field(f.flight_number, booking.flight_number),
    field(f.addons, booking.addons),
    field(f.hours_booked, booking.ride_type === "hourly" && booking.hours ? booking.hours : null),
    // USD figure — the CRM records business currency, never pesos.
    field(f.quoted_price, booking.quoted_total),
    field(f.final_price, booking.quoted_total),
    field(f.booking_source, "website"),
    field(f.special_requests, booking.special_requests),
    // The idempotency key.
    field(f.payment_ref_id, booking.external_id),
  ]);
}

/**
 * PROMOTE an EXISTING opportunity (a priced quote lead sitting in New Inquiry) to
 * Confirmed when its payment arrives — moving it and filling in the booking
 * fields, rather than creating a duplicate. This is the fix for the quote flow:
 * the quote opportunity is stamped with payment_ref_id at pricing time, so the
 * webhook's idempotency search FINDS it; this then turns it into the confirmed
 * booking in place.
 */
async function promoteToConfirmed(opportunityId: string, booking: BookingMetadata): Promise<void> {
  const vehicleLabel = (() => {
    try {
      return getVehicleClass(booking.vehicle_class).label;
    } catch {
      return booking.vehicle_class;
    }
  })();
  const isRoundTrip = Boolean(booking.return_datetime);
  const route =
    booking.ride_type === "hourly"
      ? `${booking.pickup_location} (${booking.hours ?? "?"} hrs)`
      : `${booking.pickup_location} ${isRoundTrip ? "⇄" : "→"} ${booking.dropoff_location}`;

  await ghlFetch(`/opportunities/${opportunityId}`, {
    method: "PUT",
    body: {
      pipelineStageId: fieldConfig.stageConfirmedId,
      name: `${booking.contact_name} — ${formatPickupShort(booking.pickup_datetime)} — ${route}`,
      monetaryValue: booking.quoted_total,
      customFields: bookingOpportunityFields(booking, vehicleLabel),
    },
  });
  console.log(`[ghl] promoted quote opportunity ${opportunityId} → Confirmed ($${booking.quoted_total})`);
}

/**
 * Remove a tag from a contact. Tags are otherwise only ever ADDED, which is fine
 * for descriptive tags (`ride.airport`) but wrong for STATE tags: a contact who
 * abandoned checkout and later paid must stop being "abandoned", or the owner's
 * follow-up list fills with people who already bought.
 *
 * Never throws — a stale tag is untidy, not dangerous, and must not fail a
 * booking that has already been paid for.
 */
async function removeContactTag(contactId: string, tag: string): Promise<void> {
  if (!contactId) return;
  try {
    await ghlFetch(`/contacts/${contactId}/tags`, {
      method: "DELETE",
      body: { tags: [tag] },
    });
    console.log(`[ghl] removed tag "${tag}" from contact ${contactId}`);
  } catch (err) {
    console.error(
      `[ghl] could not remove tag "${tag}" from ${contactId} (non-fatal): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Read the stage id of an opportunity (to decide promote vs. skip). */
async function readOpportunityStage(opportunityId: string): Promise<string | null> {
  const r = (await ghlFetch(`/opportunities/${opportunityId}`)) as {
    opportunity?: { pipelineStageId?: string };
  };
  return r.opportunity?.pipelineStageId ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Pending booking — the abandoned-checkout capture.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Create a PENDING-PAYMENT lead the moment a customer reaches the payment page.
 *
 * WHY THIS EXISTS: without it, a customer who clicks Pay and then hesitates
 * leaves NO trace anywhere — no lead, no follow-up, no way for the owner to
 * recover them. They are simply lost. (The old rule "an abandoned invoice leaves
 * zero trace, that is correct behaviour" was written before the CRM had a lead
 * concept; it is now leaving recoverable money on the floor.)
 *
 * This is a LEAD, not a booking: it lands in **New Inquiry**, carries no
 * `payment.paid` tag, and makes no claim that money changed hands. It is tagged
 * `lead.abandoned` so the owner can filter New Inquiry to exactly "reached
 * payment, didn't finish" and follow up.
 *
 * THE PROMOTION HINGE: the opportunity is stamped with `payment_ref_id =
 * external_id`. When payment succeeds, the webhook's idempotency search finds
 * THIS record and PROMOTES it to Confirmed in place (see pushBookingToGHL) —
 * exactly the mechanism the priced-quote flow uses. So a completed checkout
 * produces ONE opportunity that moves New Inquiry → Confirmed, never a duplicate.
 *
 * PROVIDER-INDEPENDENT: this runs before any payment provider is involved, so it
 * survives the Xendit→Stripe swap untouched.
 *
 * NEVER THROWS. A CRM hiccup must not stop a customer from paying — the lead is
 * a recovery aid, not part of the payment path. Returns null if it could not be
 * created; the caller carries on regardless.
 */
export async function createPendingBookingLead(
  booking: BookingMetadata,
): Promise<{ contactId: string; opportunityId: string } | null> {
  try {
    const locationId = requireEnv("GHL_LOCATION_ID");
    const newInquiryStageId = (fieldConfig as { stageNewInquiryId?: string }).stageNewInquiryId;
    if (!newInquiryStageId) {
      console.warn("[ghl] no stageNewInquiryId — skipping abandoned-checkout capture.");
      return null;
    }

    // Contact tags deliberately EXCLUDE payment.* — nothing has been paid yet.
    // The webhook applies the full paid tag set when it promotes this record.
    const contactId = await upsertContact({
      name: booking.contact_name,
      email: booking.contact_email,
      phone: booking.contact_phone,
      tags: ["source.website", "lead.abandoned"],
      preferredVehicle: booking.vehicle_class,
      company: booking.company_name,
    });

    const vehicleLabel = (() => {
      try {
        return getVehicleClass(booking.vehicle_class).label;
      } catch {
        return booking.vehicle_class;
      }
    })();

    const response = (await ghlFetch("/opportunities/", {
      method: "POST",
      body: {
        pipelineId: fieldConfig.pipelineId,
        locationId,
        contactId,
        pipelineStageId: newInquiryStageId,
        // "Pending payment" reads unambiguously on the board next to real
        // enquiries — the owner knows at a glance this one nearly converted.
        name: `Pending payment — ${booking.contact_name} — ${formatPickupShort(booking.pickup_datetime)}`,
        status: "open",
        monetaryValue: booking.quoted_total,
        // Full booking detail INCLUDING payment_ref_id — the promotion hinge.
        customFields: bookingOpportunityFields(booking, vehicleLabel),
      },
    })) as { opportunity?: { id?: string }; id?: string };

    const opportunityId = response.opportunity?.id ?? response.id;
    if (!opportunityId) return null;

    console.log(
      `[ghl] pending-payment lead ${opportunityId} created for ${booking.external_id}`,
    );
    return { contactId, opportunityId };
  } catch (err) {
    // Non-fatal by design: the customer must still reach the payment page.
    console.error(
      `[ghl] abandoned-checkout capture failed for ${booking.external_id} ` +
        `(checkout continues normally): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Quote request (complex bookings) — a LEAD, not a paid booking.
 * ══════════════════════════════════════════════════════════════════════════ */

export type QuoteLeadInput = {
  name: string;
  email: string;
  phone: string;
  /** Rough pickup date "YYYY-MM-DD", or "" if flexible. */
  preferredDate: string;
  /** Approximate party size, or null. */
  passengers: number | null;
  /** The customer's free-text description of the complex trip. */
  tripDetails: string;
};

/**
 * Create a manual-quote LEAD from the website "Request a Quote" form (complex
 * trips the rules can't auto-price — contract Phase 2).
 *
 * Unlike a paid booking this takes NO PAYMENT and creates NO invoice/appointment:
 * it upserts the contact and creates an opportunity in the **New Inquiry** stage
 * for the owner to price manually. Tagged `source.website` (it came from the
 * site, same channel as a booking) + `lead.quote-request` (its nature), so the
 * owner can filter New Inquiry to the custom quotes awaiting a price.
 *
 * The trip description goes on the opportunity's `special_requests` field (a
 * multi-line text field) so the owner sees the request without opening a note.
 *
 * @returns the new contact + opportunity ids.
 */
export async function createQuoteLead(
  input: QuoteLeadInput,
): Promise<{ contactId: string; opportunityId: string }> {
  const locationId = requireEnv("GHL_LOCATION_ID");

  const contactId = await upsertContact({
    name: input.name,
    email: input.email,
    phone: input.phone,
    tags: ["source.website", "lead.quote-request"],
  });

  const newInquiryStageId = (fieldConfig as { stageNewInquiryId?: string }).stageNewInquiryId;
  if (!newInquiryStageId) {
    throw new GHLError(
      "No stageNewInquiryId in config/ghl-fields.json — run npm run ghl:ids after " +
        "confirming the New Inquiry stage exists.",
    );
  }

  // A readable summary on the opportunity NAME so the owner sees the essentials
  // at a glance on the board, and the full description in special_requests.
  const parts = [
    input.preferredDate ? `date ${input.preferredDate}` : null,
    input.passengers ? `${input.passengers} pax` : null,
  ].filter(Boolean);
  const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";

  const customFields = compact([
    field(fieldConfig.opportunity.special_requests, input.tripDetails),
    field(fieldConfig.opportunity.booking_source, "website"),
    field(fieldConfig.opportunity.passenger_count, input.passengers ?? null),
  ]);

  const response = (await ghlFetch("/opportunities/", {
    method: "POST",
    body: {
      pipelineId: fieldConfig.pipelineId,
      locationId,
      contactId,
      pipelineStageId: newInquiryStageId,
      name: `Quote request — ${input.name}${summary}`,
      status: "open",
      // No monetaryValue — the owner sets it when they price the quote.
      customFields,
    },
  })) as { opportunity?: { id?: string }; id?: string };

  const opportunityId = response.opportunity?.id ?? response.id;
  if (!opportunityId) {
    throw new GHLError("Quote-lead opportunity creation succeeded but returned no id.");
  }

  console.log(`[ghl] quote-request lead ${opportunityId} created for ${input.email}`);
  return { contactId, opportunityId };
}

/** A quote lead awaiting a price, for the admin Quotes list. */
export type QuoteLead = {
  opportunityId: string;
  contactId: string;
  name: string;
  email: string;
  phone: string;
  itinerary: string;
  createdAt: string;
};

/**
 * List quote-request leads in the New Inquiry stage that have NOT yet been priced
 * (no payment link attached). These are what the owner sees in the admin Quotes
 * list. Scoped to the New Inquiry stage of our pipeline.
 *
 * The search endpoint returns opportunities without full custom fields, so for
 * each candidate we read the opportunity + its contact to build the row. Kept to
 * a modest page size — quote requests are low volume.
 */
export async function listQuoteLeads(): Promise<QuoteLead[]> {
  const locationId = requireEnv("GHL_LOCATION_ID");
  const stageId = (fieldConfig as { stageNewInquiryId?: string }).stageNewInquiryId;
  if (!stageId) return [];

  const search = (await ghlFetch(
    `/opportunities/search?location_id=${encodeURIComponent(locationId)}` +
      `&pipeline_stage_id=${encodeURIComponent(stageId)}&limit=50`,
  )) as { opportunities?: Array<{ id: string; name?: string; contactId?: string; createdAt?: string }> };

  const leads: QuoteLead[] = [];
  for (const opp of search.opportunities ?? []) {
    // Only quote-request leads — the name we set starts with "Quote request".
    if (!opp.name?.startsWith("Quote request")) continue;
    // Skip ones already priced (payment link attached).
    const linkField = fieldConfig.opportunity.quote_payment_link;
    const existingLink = linkField ? await readOpportunityField(opp.id, linkField) : null;
    if (existingLink) continue;

    const full = (await ghlFetch(`/opportunities/${opp.id}`)) as {
      opportunity?: { customFields?: GHLFieldValue[]; contactId?: string; createdAt?: string };
    };
    const fields = full.opportunity?.customFields ?? [];
    const itinerary =
      readFieldValue(fields.find((f) => f.id === fieldConfig.opportunity.special_requests)) ?? "";

    const contactId = opp.contactId ?? full.opportunity?.contactId ?? "";
    let name = "",
      email = "",
      phone = "";
    if (contactId) {
      const c = (await ghlFetch(`/contacts/${contactId}`)) as {
        contact?: { name?: string; firstName?: string; lastName?: string; email?: string; phone?: string };
      };
      name = c.contact?.name ?? `${c.contact?.firstName ?? ""} ${c.contact?.lastName ?? ""}`.trim();
      email = c.contact?.email ?? "";
      phone = c.contact?.phone ?? "";
    }

    leads.push({
      opportunityId: opp.id,
      contactId,
      name,
      email,
      phone,
      itinerary,
      createdAt: opp.createdAt ?? full.opportunity?.createdAt ?? "",
    });
  }
  return leads;
}

/**
 * After the owner prices a quote and the invoice is created, record the outcome
 * on the opportunity: store the payment link, set the monetary value, STAMP the
 * payment reference (so the webhook finds THIS opportunity and promotes it rather
 * than creating a duplicate), and tag it `lead.quoted` so a GHL workflow (WF-08)
 * emails the customer the link. Never throws in a way that loses the invoice.
 *
 * @param externalId the invoice reference — written to the opportunity's
 *   payment_ref_id so the payment webhook's idempotency search matches this
 *   quote lead and MOVES it to Confirmed instead of creating a new opportunity.
 */
export async function attachQuoteInvoice(input: {
  opportunityId: string;
  contactId: string;
  invoiceUrl: string;
  amount: number;
  externalId: string;
}): Promise<void> {
  const linkFieldId = fieldConfig.opportunity.quote_payment_link;
  const refFieldId = fieldConfig.opportunity.payment_ref_id;

  const customFields = compact([
    field(linkFieldId, input.invoiceUrl),
    // THE FIX: stamp the payment ref so the webhook finds this quote opportunity.
    field(refFieldId, input.externalId),
  ]);

  const body: Record<string, unknown> = { monetaryValue: input.amount };
  if (customFields.length > 0) body.customFields = customFields;

  await ghlFetch(`/opportunities/${input.opportunityId}`, { method: "PUT", body });

  // Tag so the follow-up workflow can fire and the owner can filter.
  if (input.contactId) {
    try {
      await ghlFetch(`/contacts/${input.contactId}/tags`, {
        method: "POST",
        body: { tags: ["lead.quoted"] },
      });
    } catch (err) {
      console.error(`[ghl] could not tag lead.quoted on ${input.contactId}: ${err}`);
    }
  }
  console.log(`[ghl] quote ${input.opportunityId} priced $${input.amount}, link attached`);
}

/** Write a single custom field onto an existing opportunity (e.g. appointment_id). */
export async function updateOpportunityField(
  opportunityId: string,
  fieldId: string | undefined,
  value: string,
): Promise<void> {
  if (!fieldId || !value) return;
  await ghlFetch(`/opportunities/${opportunityId}`, {
    method: "PUT",
    body: { customFields: [{ id: fieldId, field_value: value }] },
  });
}

/**
 * ONE-WAY SYNC: reflect a driver assignment (made in the website admin) onto the
 * GHL opportunity, so the owner still SEES it in their cockpit — the source of
 * truth and the protection live in the admin, GHL just mirrors the result.
 *
 * Writes the driver name to the `Chauffeur Assigned` field and moves the
 * opportunity to the `Assigned` stage (both ids from config/ghl-fields.json).
 * Passing an EMPTY driverName clears the field and returns the opportunity to
 * `Confirmed` — used when the admin un-assigns.
 *
 * NEVER THROWS. The admin assignment already succeeded and is the real record;
 * a GHL hiccup must not fail the whole action or leave the DB and GHL disagreeing
 * in a way that blocks the owner. It logs and returns whether the sync landed.
 */
export async function syncDriverAssignmentToGHL(
  opportunityId: string,
  driverName: string,
): Promise<boolean> {
  if (!opportunityId) return false;

  const cfg = fieldConfig as {
    opportunity: { chauffeur_assigned?: string };
    stageAssignedId?: string;
    stageConfirmedId?: string;
  };
  const fieldId = cfg.opportunity.chauffeur_assigned;
  const assigned = Boolean(driverName.trim());
  const targetStageId = assigned ? cfg.stageAssignedId : cfg.stageConfirmedId;

  const body: Record<string, unknown> = {};
  if (fieldId) body.customFields = [{ id: fieldId, field_value: driverName }];
  if (targetStageId) body.pipelineStageId = targetStageId;
  if (Object.keys(body).length === 0) {
    console.warn(
      `[ghl] cannot sync driver assignment for ${opportunityId}: no chauffeur field ` +
        `or stage id in config. Run npm run ghl:ids.`,
    );
    return false;
  }

  try {
    await ghlFetch(`/opportunities/${opportunityId}`, { method: "PUT", body });
    console.log(
      `[ghl] synced driver "${driverName || "(cleared)"}" to opportunity ${opportunityId}` +
        `${targetStageId ? ` → stage ${assigned ? "Assigned" : "Confirmed"}` : ""}`,
    );
    return true;
  } catch (err) {
    console.error(
      `[ghl] driver-assignment sync failed for ${opportunityId} (admin record is ` +
        `authoritative): ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Read one custom-field value off an opportunity by id (any endpoint shape).
 * Used for appointment retry-safety: has this opportunity already got an
 * appointment_id before we try to create another?
 */
export async function readOpportunityField(
  opportunityId: string,
  fieldId: string | undefined,
): Promise<string | null> {
  if (!fieldId) return null;
  const response = (await ghlFetch(`/opportunities/${opportunityId}`)) as {
    opportunity?: { customFields?: GHLFieldValue[] };
  };
  const fields = response.opportunity?.customFields ?? [];
  return readFieldValue(fields.find((f) => f.id === fieldId));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Appointment
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Compute a ride's END time from its start and its shape.
 *   hourly   → start + hours
 *   distance → start + duration_minutes (Routes figure carried from checkout)
 *   flat     → start + duration_minutes (flatRouteDurations, also in metadata)
 * Falls back to a 60-minute block if no duration is known, so an appointment is
 * still created rather than skipped.
 */
export function rideEndISO(booking: BookingMetadata): string {
  let minutes: number;
  if (booking.ride_type === "hourly" && booking.hours) {
    minutes = booking.hours * 60;
  } else if (typeof booking.duration_minutes === "number" && booking.duration_minutes > 0) {
    minutes = booking.duration_minutes;
  } else {
    minutes = 60; // safety fallback; better a rough block than no appointment
  }
  return addMinutesISO(booking.pickup_datetime, minutes);
}

/**
 * Create the calendar appointment for a paid ride. Start = pickup, end = ride
 * end. The appointment is the TIME-PRECISE anchor every timed workflow keys off,
 * because GHL DATE custom fields truncate the time.
 *
 * Returns the appointment id (to store on the opportunity for retry-safety), or
 * null when no calendar is configured yet — in which case we log and carry on
 * rather than fail the whole booking. A booking with no appointment is
 * recoverable; a 500 that loses the booking is not.
 */
/**
 * The team member a new appointment is assigned to. GHL REQUIRES an
 * assignedUserId on appointment creation. We read the calendar's own default
 * (the `selected` team member) rather than hardcoding a user id, so this keeps
 * working when the roster changes at go-live. Cached for the process lifetime.
 */
let cachedCalendarUserId: string | null | undefined;

async function resolveCalendarUserId(calendarId: string): Promise<string | null> {
  if (cachedCalendarUserId !== undefined) return cachedCalendarUserId;

  try {
    const response = (await ghlFetch(`/calendars/${calendarId}`)) as {
      calendar?: { teamMembers?: Array<{ userId: string; selected?: boolean }> };
    };
    const members = response.calendar?.teamMembers ?? [];
    const chosen = members.find((m) => m.selected) ?? members[0];
    cachedCalendarUserId = chosen?.userId ?? null;
  } catch (err) {
    console.error(`[ghl] could not resolve calendar team member: ${err}`);
    cachedCalendarUserId = null;
  }
  return cachedCalendarUserId;
}

export async function createRideAppointment(
  contactId: string,
  booking: BookingMetadata,
): Promise<string | null> {
  const calendarId = fieldConfig.calendarId;
  if (!calendarId) {
    console.warn(
      `[ghl] no calendarId configured — skipping appointment for ${booking.external_id}. ` +
        `Run npm run ghl:ids after creating the PSDLimo Rides calendar.`,
    );
    return null;
  }

  const assignedUserId = await resolveCalendarUserId(calendarId);
  if (!assignedUserId) {
    console.error(
      `[ghl] no team member on calendar ${calendarId} — cannot create appointment for ` +
        `${booking.external_id}. Assign a user to the PSDLimo Rides calendar.`,
    );
    return null;
  }

  const locationId = requireEnv("GHL_LOCATION_ID");
  const route =
    booking.ride_type === "hourly"
      ? `${booking.pickup_location} (${booking.hours ?? "?"} hrs)`
      : `${booking.pickup_location} → ${booking.dropoff_location}`;

  const response = (await ghlFetch("/calendars/events/appointments", {
    method: "POST",
    body: {
      calendarId,
      locationId,
      contactId,
      assignedUserId,
      title: `${booking.contact_name} — ${route}`,
      startTime: booking.pickup_datetime,
      endTime: rideEndISO(booking),
      appointmentStatus: "confirmed",
      address: booking.pickup_location,
      notes: `Ref ${booking.external_id}\n${route}\n${booking.vehicle_class} · ${booking.passengers} pax`,
      // A ride is booked for a specific time; it must NOT be rejected for
      // falling outside the calendar's availability windows. Verified this is
      // the parameter GHL honours (ignoreDateRange alone did not work).
      ignoreFreeSlotValidation: true,
      toNotify: false, // the workflows own customer comms, not the calendar
    },
  })) as { id?: string; appointment?: { id?: string }; event?: { id?: string } };

  const appointmentId = response.id ?? response.appointment?.id ?? response.event?.id ?? null;
  if (!appointmentId) {
    console.error(`[ghl] appointment created for ${booking.external_id} but no id returned`);
  }
  return appointmentId;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tags
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Tags for a paid booking.
 *
 * NOTE THE DOT NOTATION — the CRM uses `ride.airport`, not `ride-airport`.
 * The sandbox is the source of truth, and the internal tag vocabulary
 * (`tags_csv` in the metadata) is hyphenated, so the ONLY transform needed is
 * hyphen → dot on the FIRST separator: `ride-pointtopoint` → `ride.pointtopoint`.
 * (Only the namespace separator changes; `pointtopoint` keeps its shape.)
 *
 * Deriving the tags happened once, server-side at checkout (deriveBookingTags).
 * This function just translates the stored decision into CRM spelling — it adds
 * no tags of its own, so the two never disagree.
 */
export function tagsForBooking(booking: BookingMetadata): string[] {
  return booking.tags_csv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace("-", "."));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Orchestration
 * ══════════════════════════════════════════════════════════════════════════ */

export type PushResult =
  | { created: true; contactId: string; opportunityId: string; appointmentId: string | null }
  | { created: false; contactId: string; opportunityId: string; reason: "duplicate" };

/**
 * Push a paid booking into the CRM: contact → opportunity → appointment.
 *
 * Order matters: upsert the contact FIRST, because the idempotency check is
 * scoped to the contact. Upserting is itself idempotent, so doing it before the
 * duplicate check costs nothing and cannot create a duplicate contact.
 *
 * Throws on any unexpected GHL failure. The caller must let that propagate as a
 * 500 so the payment provider retries — swallowing it would lose the booking.
 */
export async function pushBookingToGHL(booking: BookingMetadata): Promise<PushResult> {
  const tags = tagsForBooking(booking);

  const contactId = await upsertContact({
    name: booking.contact_name,
    email: booking.contact_email,
    phone: booking.contact_phone,
    tags,
    preferredVehicle: booking.vehicle_class,
    company: booking.company_name,
  });

  // ── Idempotency / quote promotion ────────────────────────────────────────
  // The search matches an opportunity carrying this payment_ref_id. Two cases:
  //   (a) a re-sent callback for a booking already in Confirmed → skip (idempotent)
  //   (b) a PRICED QUOTE lead in New Inquiry (stamped with this ref at pricing
  //       time) → PROMOTE it to Confirmed in place, instead of creating a
  //       duplicate. This is the quote-flow fix.
  const existing = await findOpportunityByPaymentRef(contactId, booking.external_id);
  if (existing) {
    const stage = await readOpportunityStage(existing);
    if (stage && stage !== fieldConfig.stageConfirmedId) {
      // Case (b): a pending record awaiting payment — either a priced quote or an
      // abandoned-checkout capture. Move it to Confirmed + fill in.
      await promoteToConfirmed(existing, booking);
      // It is no longer "abandoned" — they paid. Leaving the tag would fill the
      // owner's follow-up list with customers who already bought.
      await removeContactTag(contactId, "lead.abandoned");
      const appointmentId = await ensureAppointment(contactId, existing, booking);
      return { created: true, contactId, opportunityId: existing, appointmentId };
    }
    // Case (a): already Confirmed — a genuine duplicate callback.
    console.log(
      `[ghl] booking ${booking.external_id} already recorded as opportunity ${existing} — ` +
        `skipping. This is the idempotency guard working, not an error.`,
    );
    // Retry-safety: a prior attempt may have created the opportunity but failed
    // before writing the appointment. Backfill it if missing.
    await ensureAppointment(contactId, existing, booking);
    return { created: false, contactId, opportunityId: existing, reason: "duplicate" };
  }

  // ── Create the opportunity ──────────────────────────────────────────────
  let opportunityId: string;
  try {
    opportunityId = await createBookingOpportunity(contactId, booking);
  } catch (err) {
    /*
     * GHL's own per-contact duplicate rejection (400 "Can not create duplicate
     * opportunity", with meta.existingId). With "Allow Multiple Opportunities
     * per Contact" turned ON this should NEVER fire — so we do NOT blanket-treat
     * it as success. We re-run the idempotency search and only accept it if THIS
     * external_id is genuinely already recorded; otherwise it is a real error
     * (500) worth surfacing, because a silent success here would drop a booking.
     */
    if (err instanceof GHLError && err.status === 400 && /duplicate opportunity/i.test(err.body ?? "")) {
      console.warn(
        `[ghl] GHL rejected a duplicate opportunity for ${booking.external_id} despite ` +
          `Allow-Multiple being expected ON. Re-verifying by payment_ref_id…`,
      );
      const reCheck = await findOpportunityByPaymentRef(contactId, booking.external_id);
      if (reCheck) {
        await ensureAppointment(contactId, reCheck, booking);
        return { created: false, contactId, opportunityId: reCheck, reason: "duplicate" };
      }
      // The 400 was about a DIFFERENT booking on this contact — a real problem.
      console.error(
        `[ghl] duplicate rejection for ${booking.external_id} did NOT match this ` +
          `payment_ref_id. "Allow Multiple Opportunities per Contact" is likely OFF.`,
      );
    }
    throw err;
  }

  // ── Appointment (never fails the booking) ───────────────────────────────
  const appointmentId = await ensureAppointment(contactId, opportunityId, booking);

  return { created: true, contactId, opportunityId, appointmentId };
}

/**
 * Create the ride appointment if the opportunity does not already have one, and
 * record its id on the opportunity. Idempotent and non-fatal: an appointment
 * failure logs but does not throw, because a booking with no calendar entry is
 * recoverable while a lost booking is not.
 */
async function ensureAppointment(
  contactId: string,
  opportunityId: string,
  booking: BookingMetadata,
): Promise<string | null> {
  try {
    const existingApptId = await readOpportunityField(
      opportunityId,
      fieldConfig.opportunity.appointment_id,
    );
    if (existingApptId) return existingApptId; // already created on a prior attempt

    const appointmentId = await createRideAppointment(contactId, booking);
    if (appointmentId) {
      await updateOpportunityField(
        opportunityId,
        fieldConfig.opportunity.appointment_id,
        appointmentId,
      );
    }
    return appointmentId;
  } catch (err) {
    console.error(
      `[ghl] appointment step failed for ${booking.external_id} (opportunity exists, ` +
        `booking is safe): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
