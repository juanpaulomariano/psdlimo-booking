/**
 * Resolve GoHighLevel custom-field, pipeline, and stage IDs into
 * config/ghl-fields.json.
 *
 * WHY THIS EXISTS: custom fields must be written by ID at runtime, never by key
 * — key-writes are unreliable across v2 endpoints and fail silently, which in a
 * CRM means a blank field nobody notices until the client asks where the pickup
 * address went. Resolving IDs once, up front, also validates the entire sandbox
 * setup in a single command.
 *
 * THIS SCRIPT IS SUPPOSED TO BE LOUD. If a field is missing, misnamed, or has
 * the wrong dropdown options, it prints exactly what is wrong and exits 1. Do
 * not soften it — a silent pass here is a broken demo later.
 *
 * Run: npm run ghl:ids
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADD_ON_IDS, FLAT_ROUTES, VEHICLE_CLASS_IDS } from "@/config/rates";

const GHL_API = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

const OUTPUT_PATH = resolve(process.cwd(), "config/ghl-fields.json");

/* ── What the sandbox must contain ────────────────────────────────────────── */

/** Opportunity fields. Per-booking data lives here so repeat bookings never
 *  overwrite each other. `expectedOptions` is checked for dropdowns. */
const OPPORTUNITY_FIELDS: Record<string, { expectedOptions?: readonly string[] }> = {
  pickup_location: {},
  dropoff_location: {},
  pickup_datetime: {},
  ride_type: { expectedOptions: ["distance", "hourly", "flat"] },
  vehicle_class: { expectedOptions: VEHICLE_CLASS_IDS },
  passenger_count: {},
  luggage_count: {},
  flight_number: {},
  addons: {},
  hours_booked: {},
  quoted_price: {},
  final_price: {},
  booking_source: { expectedOptions: ["website", "phone", "email", "referral"] },
  special_requests: {},
  // The idempotency key. Without it a re-sent callback creates a duplicate
  // booking — the exact failure this build is meant to prove impossible.
  payment_ref_id: {},
  // Phase 8: operations fields.
  chauffeur_assigned: {}, // owner-written; the one manual field
  chauffeur_phone: {},
  appointment_id: {}, // webhook-written; appointment retry-safety
};

/** Contact fields describe the PERSON, so overwriting on a repeat booking is fine. */
const CONTACT_FIELDS: Record<string, { expectedOptions?: readonly string[] }> = {
  client_type: { expectedOptions: ["individual", "corporate", "vip"] },
  preferred_vehicle: { expectedOptions: VEHICLE_CLASS_IDS },
  lifetime_rides: {},
  last_ride_date: {},
  // NOTE: company is GHL's STANDARD `companyName` contact field, NOT a custom
  // field — it is written on the contact body in lib/ghl.ts, so it is not
  // resolved here.
};

/** Calendar the webhook writes ride appointments to (Phase 8). */
const CALENDAR_NAME = "PSDLimo Rides";

const PIPELINE_NAME = "PSDLimo Bookings";
const STAGE_NAME = "Confirmed";

/**
 * Additional pipeline stages the Stage A′ workflows reference. These already
 * exist in the pipeline (verified 2026-07-24), so they resolve normally; if one
 * is ever renamed/removed the resolver WARNS rather than failing, since the
 * booking flow itself only hard-depends on `Confirmed`.
 *   - Assigned:   where WF-03 optionally moves a booking once a driver is set
 *   - Completed:  where WF-05 moves a finished ride
 *   - Cancelled:  referenced by cancellation handling
 * NOTE: a double booking is flagged with the `ops.double-booking` TAG, not a
 * stage move (decided 2026-07-24), so there is deliberately NO
 * "Possible Double Booking" stage.
 */
const OPTIONAL_STAGES: Record<string, string> = {
  stageAssignedId: "Assigned",
  stageCompletedId: "Completed",
  stageCancelledId: "Cancelled",
};

/**
 * Tags. NOTE THE DOT NOTATION — the sandbox uses `source.website`, not
 * `source-website` as ARCHITECTURE.md originally specified. The CRM is the
 * source of truth for tag names, so the code matches the CRM.
 */
const REQUIRED_TAGS = [
  "source.website",
  "service.airport",
  "service.hourly",
  "service.intercity",
  "service.winetour",
  "service.group",
  "service.corporate",
  "service.pointtopoint",
  "pay.card",
  "pay.paid",
  "client.corporate",
] as const;

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const problems: string[] = [];
const warnings: string[] = [];

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

type CustomField = {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
  picklistOptions?: string[];
};

async function ghl(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${GHL_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: API_VERSION,
      Accept: "application/json",
    },
  });

  const body = await response.text();

  if (!response.ok) {
    // GHL's errors are only useful in the body — always print it.
    fail(
      `GHL returned ${response.status} for ${path}\n\n${body}\n\n` +
        (response.status === 401
          ? "The token was rejected. Check GHL_PRIVATE_TOKEN in .env.local."
          : response.status === 403
            ? "The token lacks a required scope. This script needs\n" +
              "  locations.readonly, locations/customFields.readonly, opportunities.readonly"
            : ""),
    );
  }

  try {
    return JSON.parse(body);
  } catch {
    fail(`GHL returned an unreadable response for ${path}:\n${body.slice(0, 400)}`);
  }
}

/** Match on the key's suffix — GHL prefixes keys with the model name. */
function findField(fields: CustomField[], key: string): CustomField | undefined {
  return fields.find((f) => {
    const bare = f.fieldKey.includes(".") ? f.fieldKey.split(".").pop() : f.fieldKey;
    return bare === key;
  });
}

function checkFields(
  label: string,
  fields: CustomField[],
  expected: Record<string, { expectedOptions?: readonly string[] }>,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [key, spec] of Object.entries(expected)) {
    const found = findField(fields, key);

    if (!found) {
      problems.push(
        `${label} field "${key}" was not found.\n` +
          `      Create it in GHL with Object = ${label}, and check the generated key.\n` +
          `      Existing ${label} keys: ${fields.map((f) => f.fieldKey).join(", ") || "(none)"}`,
      );
      continue;
    }

    resolved[key] = found.id;

    // Dropdown values are written verbatim by the code. GHL silently drops a
    // value that is not in the picklist, so a mismatch here means a blank field.
    if (spec.expectedOptions) {
      const actual = found.picklistOptions ?? [];
      const missing = spec.expectedOptions.filter((o) => !actual.includes(o));
      if (missing.length > 0) {
        problems.push(
          `${label} field "${key}" is missing dropdown option(s): ${missing.join(", ")}\n` +
            `      GHL has: ${JSON.stringify(actual)}\n` +
            `      The code writes these values verbatim; GHL silently drops anything\n` +
            `      not in the list, leaving the field blank.`,
        );
      }
    }
  }

  return resolved;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function main() {
  console.log("\nResolving GoHighLevel IDs…\n");

  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!token) fail("GHL_PRIVATE_TOKEN is not set. Add it to .env.local (see .env.example).");
  if (!locationId) fail("GHL_LOCATION_ID is not set. Add it to .env.local (see .env.example).");

  // ── Custom fields ───────────────────────────────────────────────────────
  const oppResponse = (await ghl(
    `/locations/${locationId}/customFields?model=opportunity`,
    token,
  )) as { customFields?: CustomField[] };
  const contactResponse = (await ghl(
    `/locations/${locationId}/customFields?model=contact`,
    token,
  )) as { customFields?: CustomField[] };

  const oppFields = oppResponse.customFields ?? [];
  const contactFields = contactResponse.customFields ?? [];

  console.log(`  found ${oppFields.length} opportunity fields, ${contactFields.length} contact fields`);

  const opportunity = checkFields("Opportunity", oppFields, OPPORTUNITY_FIELDS);
  const contact = checkFields("Contact", contactFields, CONTACT_FIELDS);

  // A field created on the wrong object is the most common setup mistake, and
  // the error above ("not found") does not explain it. Detect it explicitly.
  for (const key of Object.keys(OPPORTUNITY_FIELDS)) {
    if (!opportunity[key] && findField(contactFields, key)) {
      problems.push(
        `"${key}" exists but is a CONTACT field — it must be an OPPORTUNITY field.\n` +
          `      Per-booking data on a contact means a repeat customer's second\n` +
          `      booking overwrites their first. Recreate it with Object = Opportunity.`,
      );
    }
  }
  for (const key of Object.keys(CONTACT_FIELDS)) {
    if (!contact[key] && findField(oppFields, key)) {
      problems.push(`"${key}" exists but is an OPPORTUNITY field — it must be a CONTACT field.`);
    }
  }

  // ── Pipeline and stage ──────────────────────────────────────────────────
  const pipelineResponse = (await ghl(
    `/opportunities/pipelines?locationId=${locationId}`,
    token,
  )) as { pipelines?: Array<{ id: string; name: string; stages?: Array<{ id: string; name: string }> }> };

  const pipelines = pipelineResponse.pipelines ?? [];
  const pipeline = pipelines.find((p) => p.name.trim().toLowerCase() === PIPELINE_NAME.toLowerCase());

  let pipelineId = "";
  let stageConfirmedId = "";
  // key → resolved id for the Stage A′ stages; empty string until they exist.
  const optionalStageIds: Record<string, string> = {};

  if (!pipeline) {
    problems.push(
      `Pipeline "${PIPELINE_NAME}" was not found.\n` +
        `      Existing pipelines: ${pipelines.map((p) => `"${p.name}"`).join(", ") || "(none)"}`,
    );
  } else {
    pipelineId = pipeline.id;
    const stages = pipeline.stages ?? [];
    const findStage = (name: string) =>
      stages.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());

    const stage = findStage(STAGE_NAME);
    if (!stage) {
      problems.push(
        `Pipeline "${PIPELINE_NAME}" has no "${STAGE_NAME}" stage.\n` +
          `      Its stages: ${stages.map((s) => `"${s.name}"`).join(", ")}`,
      );
    } else {
      stageConfirmedId = stage.id;
    }

    // Stage A′ stages — resolved if present, WARNED if not (they are created
    // during the GHL workflow setup, so their absence is expected pre-setup).
    for (const [key, stageName] of Object.entries(OPTIONAL_STAGES)) {
      const found = findStage(stageName);
      if (found) {
        optionalStageIds[key] = found.id;
      } else {
        optionalStageIds[key] = "";
        warnings.push(
          `Pipeline "${PIPELINE_NAME}" has no "${stageName}" stage — ${key} left blank.\n` +
            `      This stage was expected to exist; if it was renamed, update either the\n` +
            `      stage name in GHL or OPTIONAL_STAGES here. Not fatal: the code that\n` +
            `      references it no-ops on a blank id.`,
        );
      }
    }
  }

  // ── Tags ────────────────────────────────────────────────────────────────
  // Missing tags are a WARNING, not a failure: GHL creates a tag on the fly
  // when one is applied. Pre-creating them just catches typos earlier.
  const tagResponse = (await ghl(`/locations/${locationId}/tags`, token)) as {
    tags?: Array<{ id: string; name: string }>;
  };
  const existingTags = (tagResponse.tags ?? []).map((t) => t.name.trim().toLowerCase());
  const missingTags = REQUIRED_TAGS.filter((t) => !existingTags.includes(t));
  if (missingTags.length > 0) {
    warnings.push(
      `Tags not pre-created: ${missingTags.join(", ")}\n` +
        `      GHL will create them on first use, so this is not fatal — but a typo\n` +
        `      would show up as a stray tag rather than an error.`,
    );
  }

  // ── Calendar ──────────────────────────────────────────────────────────────
  // A WARNING not a failure: the webhook skips the appointment gracefully when
  // no calendar is configured, so the site works without it. But the ride
  // lifecycle workflows anchor on appointments, so it IS needed before Phase 9.
  const calendarResponse = (await ghl(`/calendars/?locationId=${locationId}`, token)) as {
    calendars?: Array<{ id: string; name: string }>;
  };
  const calendar = (calendarResponse.calendars ?? []).find(
    (c) => c.name.trim().toLowerCase() === CALENDAR_NAME.toLowerCase(),
  );
  let calendarId = "";
  if (calendar) {
    calendarId = calendar.id;
  } else {
    warnings.push(
      `Calendar "${CALENDAR_NAME}" not found — appointments will be SKIPPED until it exists.\n` +
        `      Create it (Calendars → Create) and re-run. Required before the ride\n` +
        `      lifecycle workflows, which anchor their timing on appointments.\n` +
        `      Existing calendars: ${(calendarResponse.calendars ?? []).map((c) => `"${c.name}"`).join(", ") || "(none)"}`,
    );
  }

  // ── Report ──────────────────────────────────────────────────────────────
  if (problems.length > 0) {
    console.error(`\n✖ ${problems.length} problem(s) found:\n`);
    problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
    console.error("Fix these in GoHighLevel (see GHL_SETUP.md), then run this again.\n");
    process.exit(1);
  }

  const config = {
    _comment:
      "GENERATED by `npm run ghl:ids` — do not edit by hand. Re-run after any GHL sandbox change.",
    _generatedAt: new Date().toISOString(),
    locationId,
    pipelineId,
    stageConfirmedId,
    ...optionalStageIds,
    calendarId,
    tags: {
      source: "source.website",
      payCard: "pay.card",
      payPaid: "pay.paid",
      serviceAirport: "service.airport",
      serviceHourly: "service.hourly",
      serviceIntercity: "service.intercity",
      serviceWinetour: "service.winetour",
      serviceGroup: "service.group",
      serviceCorporate: "service.corporate",
      servicePointToPoint: "service.pointtopoint",
      clientCorporate: "client.corporate",
    },
    opportunity,
    contact,
    // Recorded so a future rate-card change that adds a vehicle class or add-on
    // shows up as a diff here, prompting the matching GHL dropdown update.
    _knownValues: {
      vehicleClasses: [...VEHICLE_CLASS_IDS],
      addOns: [...ADD_ON_IDS],
      flatRoutes: FLAT_ROUTES.map((r) => r.id),
    },
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  console.log(`  pipeline    ${PIPELINE_NAME} → ${pipelineId}`);
  console.log(`  stage       ${STAGE_NAME} → ${stageConfirmedId}`);
  console.log(`  resolved    ${Object.keys(opportunity).length} opportunity fields`);
  console.log(`  resolved    ${Object.keys(contact).length} contact fields`);

  if (warnings.length > 0) {
    console.log("");
    warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }

  console.log(`\n✓ Wrote ${OUTPUT_PATH}\n`);
}

main().catch((err) => {
  console.error("\n✖ Unexpected failure:\n", err);
  process.exit(1);
});
