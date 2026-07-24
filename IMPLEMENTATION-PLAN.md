# IMPLEMENTATION PLAN — building the full architecture

Turns `PSDLIMO-MASTER-BLUEPRINT.md` into an ordered, phased build. The blueprint
is the WHAT; this is the WHEN and WHO.

**Ground truth, checked against the live system on 2026-07-24:**
- Website booking flow, payments, and the basic webhook→GHL push are **built and
  live-verified** (see `STATE.md`).
- `lib/maps.ts` already returns `durationMinutes` — appointment-end is plumbing,
  not new logic.
- We currently write **14 opportunity fields**; the blueprint wants 18 (+ chauffeur
  name/phone, + appointment_id) and one new contact field (company_name).
- The GHL token **already has calendar-write scope** (verified: 422 not 403). It
  needs the calendar *read* scopes added so `ghl:ids` can resolve the calendar ID.
- **No GHL MCP exists** — the 12 workflows, calendar, and templates are built by
  the owner in the GHL UI. My role there is precise build-sheets + API verification.

## Division of labour

| I (Claude) build in code | You build in the GHL UI |
|---|---|
| Webhook appointments, retry-safety | The calendar `PSDLimo Rides` |
| Tag expansion (service.*, client.*) | Custom fields 16–18, 23 |
| Company field capture | Token scopes (calendar read) |
| Manifest cron | The 12 workflows |
| 400-duplicate tightening | Message templates |
| zod extension (durationMinutes) | Sub-account settings (D1) |
| Verification of everything above | — |

## Working agreement (decided 2026-07-24)

1. **Code first, GHL foundation in parallel**, then verify, then gate, then workflows.
2. **Verification Gate (blueprint G2) is mandatory** before ANY of the 12 workflows.
   No workflow is built on an unverified GHL capability.
3. For GHL UI work I write a build-sheet; you build; I verify via REST API.

---

## PHASE 8 — Code foundation for operations *(I build; you add GHL fields in parallel)*

Everything code-side that the workflows will later stand on. Nothing here depends
on a workflow existing, so it can all land first.

**8.1 — Extend the booking payload with duration** *(code)*
- Carry `durationMinutes` (already computed in `maps.ts`) through `/api/checkout`
  into invoice metadata; extend `bookingMetadataSchema`. This is what lets the
  webhook compute a distance ride's appointment END.
- Flat routes: add `flatRouteDurations` to `config/rates.ts` (SFO→Downtown 35m,
  OAK→FiDi 30m, SF→Napa 90m — PLACEHOLDERS).

**8.2 — Expand tag derivation** *(code)*
- In checkout's `service_tag` logic, add: `service.intercity` (≥50 mi or far
  city), `service.winetour` (Napa/Sonoma), `service.group` (≥7 pax),
  `service.corporate` (company filled). Keep the internal hyphen enum; map to
  dotted tags in `tagsForBooking()`.
- `bookingMetadata` currently carries ONE `service_tag`; the blueprint wants
  potentially several tags. Change to a `tags` array derived server-side.

**8.3 — Company field** *(code)*
- Optional "Company (for receipts)" field in Step 3 (never required). Thread
  through schema → metadata → `company_name` contact field + `service.corporate`
  / `client.corporate` tags when present.

**8.4 — Appointments in the webhook** *(code — the biggest piece)*
- `createRideAppointment()` in `lib/ghl.ts`: start = pickup (LA), end = pickup +
  {hours | durationMinutes | flatRouteDuration}. Write `appointment_id` back onto
  the opportunity.
- Retry-safety: before creating, check the opportunity's `appointment_id` field.
- Needs `GHL_CALENDAR_ID` (from 8.7).

**8.5 — Tighten the 400-duplicate handling** *(code)*
- With duplicates now ALLOWED in GHL, the 400 "duplicate opportunity" should
  never fire. Current code treats it as success unconditionally. Change: on that
  400, re-run the idempotency search; return 200 ONLY if THIS external_id is
  confirmed present, else 500. Never blanket-success.

**8.6 — Manifest cron** *(code)*
- `/api/cron/manifest` guarded by `CRON_SECRET`; `vercel.json` daily ~6 AM PT.
  Searches today's rides, composes one owner email. Needs an email-send path —
  see open question Q3.

**8.7 — GHL foundation** *(YOU, in parallel — build-sheet: `GHL_OPS_SETUP.md`)*
- Create calendar **PSDLimo Rides**.
- Add opportunity fields: **Chauffeur Assigned**, **Chauffeur Phone**,
  **Appointment Id**; contact field: **Company Name**.
- Add token scopes: `calendars.readonly`, `calendars/events.readonly`,
  `calendars/events.write` (write is already present, but re-issue cleanly).
- Apply sub-account settings (blueprint D1): timezone LA (confirm), workflow
  re-entry, etc.

**8.8 — Update `fetch-ghl-ids.ts` + verify** *(code, then live)*
- Teach the resolver the 4 new fields + the calendar ID. `npm run ghl:ids` must
  pass clean — that's the gate that proves 8.7 was done right.

**Phase 8 done when:** `npm run build` + `npm test` clean, `ghl:ids` resolves
everything, and a simulated PAID callback creates an opportunity **with an
appointment on the calendar** and all 18 fields — verified via API.

---

## PHASE 9 — The Verification Gate *(YOU build throwaway workflows; I tell you exactly what to test)*

Blueprint G2. Five throwaway workflows in the sandbox, each proving one GHL
capability the real workflows depend on. **If any fails, we redesign before
building the 12.** This is the step that would have caught our earlier wrong
assumptions.

| Gate | Proves | If it fails |
|---|---|---|
| V1 | Appointment-anchored Waits fire on time | STOP — redesign timing |
| V2 | `{{opportunity.*}}` fields merge into messages | carry values on the name |
| V3 | Guards read the ENROLLED opportunity (round-trip safety) | per-workflow removal |
| V4 | Failed SMS doesn't halt the workflow | email-first ordering |
| V5 | Two concurrent enrollments per contact | consolidate workflows |

I'll write `GATE-TESTS.md` with click-by-click setup and the exact pass/fail
observation for each. You run them, tell me the results, I record them.

**Phase 9 done when:** all five recorded PASS (or a documented fallback chosen).

---

## PHASE 10 — The 12 workflows *(YOU build from build-sheets; I verify data effects)*

Built in blueprint D6 order — **OPS-04 (cancellation) first**, then confirm/nudge/
dispatch/reminders/lifecycle/retention/review/high-value. Each gets a build-sheet
with exact triggers, waits, guards, and template copy. You build + publish +
smoke-test one before the next.

I verify the *data* side via API after each: correct tags applied, fields read,
stages advanced, appointment timings honoured. I cannot see the workflow canvas,
but I can prove its effects on the CRM.

Templates (blueprint D7) are built alongside the workflows that send them.

**Phase 10 done when:** all 12 published and each smoke-tested.

---

## PHASE 11 — Master test pass + demo readiness *(joint)*

Blueprint G3 — the 12 end-to-end scenarios, with the **round-trip cancellation
(G3#3)** as the signature test. Shrink wait offsets temporarily to test fast,
then restore.

Then pre-demo (blueprint J): delete sandbox test data, rotate the Google server
key, **visual review of the wizard** (still never seen by any reviewer), rehearse
the Part H script.

**Phase 11 done when:** all 12 scenarios pass and the demo script runs clean.

---

## Open questions I need answered before Phase 8 (see chat)

- **Q1 — RESOLVED:** all email through GHL, no external tools. Consequence: the manifest cannot be a GHL workflow email (those merge one record, cannot aggregate a list) — see the manifest note below.
- **Q2 — RESOLVED:** move to a server-derived tags array now.
- **Q3 — RESOLVED (with a caveat):** GHL only. But a GHL workflow email cannot aggregate a daily ride list, so the manifest is either (a) deferred, or (b) reshaped — see below.
- **Q4 — RESOLVED:** existing token already has all three calendar scopes (verified 2026-07-24: readonly 200, events.readonly/write 422). No token change needed.
