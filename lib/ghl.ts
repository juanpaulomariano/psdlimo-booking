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
  const opportunityFields = fieldConfig.opportunity;

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

/** The tag a detected double booking is marked with. Contact-scoped (GHL tags
 *  live on contacts). A GHL workflow watching for this tag emails the owner. */
export const DOUBLE_BOOKING_TAG = "ops.double-booking";

/**
 * Flag a detected double booking by TAGGING the contact, not by moving the
 * opportunity's stage.
 *
 * WHY A TAG, NOT A STAGE MOVE (decided 2026-07-24): the pipeline already has a
 * meaningful stage lifecycle (New Inquiry → … → Assigned → In Progress →
 * Completed → Cancelled). Moving a clashing booking to a dedicated stage would
 * DESTROY the record of where it actually was (e.g. "Assigned"), and an
 * opportunity can only occupy one stage. A tag layers the warning ON TOP of the
 * real stage instead — nothing is overwritten, and the booking stays exactly
 * where it belongs.
 *
 * The tag is added to the CONTACT because GHL tags are contact-scoped. A GHL
 * workflow (WF-04) watches for this tag and emails the owner — that is the
 * primary alert; the tag is also the durable, filterable backstop.
 *
 * Resilient: never throws. A tagging failure must not turn a detected clash into
 * a 500 that makes the caller retry (the clash is already logged). Returns
 * whether the tag was applied.
 */
export async function flagPossibleDoubleBooking(contactId: string): Promise<boolean> {
  if (!contactId) {
    console.warn("[ghl] cannot flag a double booking: no contactId on the trip.");
    return false;
  }
  try {
    await ghlFetch(`/contacts/${contactId}/tags`, {
      method: "POST",
      body: { tags: [DOUBLE_BOOKING_TAG] },
    });
    console.log(`[ghl] contact ${contactId} tagged "${DOUBLE_BOOKING_TAG}" (possible double booking)`);
    return true;
  } catch (err) {
    console.error(
      `[ghl] failed to tag contact ${contactId} as a double booking (clash still ` +
        `detected + logged): ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
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
 * NOTE THE DOT NOTATION — the CRM uses `source.website`, not `source-website`.
 * The sandbox is the source of truth, and the internal tag vocabulary
 * (`tags_csv` in the metadata) is hyphenated, so the ONLY transform needed is
 * hyphen → dot on the FIRST separator: `service-pointtopoint` → `service.pointtopoint`.
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

  // ── Idempotency ─────────────────────────────────────────────────────────
  const existing = await findOpportunityByPaymentRef(contactId, booking.external_id);
  if (existing) {
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
