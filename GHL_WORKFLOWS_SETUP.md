# GHL Workflows Setup — Stage A′ (the build-sheet)

This is the **activation** stage. Everything the workflows react to is already
built and live in the code — the payment webhook writes the contact, the
opportunity (in **Confirmed**), the calendar appointment, and every tag. The
dispatch endpoint already detects double bookings. **GHL's job here is to REACT,
never to re-create.** A workflow that tries to create the opportunity, set the
price, or apply the service tags would fight the webhook and produce duplicates.

Read that paragraph twice. It is the single rule that keeps every trigger below
accurate.

> **Ground truth this sheet is built against** (from `config/ghl-fields.json`,
> resolved by `npm run ghl:ids`, verified 2026-07-24):
> - Sub-account (location): `BhxPrWhgU4bdMXz6meYe`
> - Pipeline **PSDLimo Bookings**: `Ves6KZpNw5PZdVOQRKWS`
> - Stage **Confirmed**: `fb8d9242-d0dd-4c09-ace5-e7a4ea34f19b` (the ONLY stage that exists today)
> - Calendar **PSDLimo Rides**: `mbiZTjEQc8qtnVYl413q`
> - The one manual field: **Chauffeur Assigned** (`opportunity.chauffeur_assigned`)
> - Dispatch endpoint (already deployed): `POST https://psdlimo-booking.vercel.app/api/dispatch/assign`
>   authenticated by header `x-dispatch-token: <DISPATCH_WEBHOOK_TOKEN>`

---

## 0. Naming conventions (agree these FIRST — everything below uses them)

One convention, applied everywhere, so the account stays legible to whoever
inherits it. All lowercase except workflow display names; dot-separated
namespaces (matching the tag style already in the system).

### Workflow folders
`PSD · <Area>` — a middot separates brand from area. Four folders:

| Folder | Holds |
|---|---|
| `PSD · Booking Lifecycle` | Confirmation, reminders, completion |
| `PSD · Dispatch` | Driver assignment → our webhook, and the double-booking alert |
| `PSD · Customer Care` | Post-ride follow-up / review ask |
| `PSD · Internal Alerts` | Owner-facing notifications |

### Workflow names
`WF-<NN> <Area>: <Outcome>` — a zero-padded number for stable sort order, the
area, then the plain-English outcome.
Example: `WF-01 Booking: Send confirmation`.

### Pipeline stages
Plain Title Case, no prefix (stages are customer/owner-facing in the CRM board):
`Confirmed` (exists) · `Possible Double Booking` (we create it) · `Completed`
(optional, see §Checklist).

### Tags
Already established and **must not change** — lowercase, dot-separated namespaces:
`namespace.value`. The webhook writes `source.website`, `pay.card`, `pay.paid`,
`service.*`, `client.corporate`. **Workflows read these; they do not invent new
service tags.** The only NEW tags a workflow may add are lifecycle markers in a
new namespace:

| New tag | Set by | Means |
|---|---|---|
| `lifecycle.reminder-sent` | WF-02 | the 24h reminder went out (prevents re-sends) |
| `lifecycle.completed` | WF-04 | the ride was marked done |
| `ops.double-booking` | WF-06 | a clash was flagged (mirror of the stage, for filtering) |

### Trigger names (inside each workflow)
`TRG: <what fires it>` — e.g. `TRG: Opportunity entered Confirmed`.

### Action names (inside each workflow)
`ACT-<n>: <verb> <object>` — e.g. `ACT-1: Email customer confirmation`,
`ACT-2: Wait until 24h before pickup`. Numbered so support can refer to "ACT-3".

---

## THE CHECKLIST (do these in order)

Setup (once):
- [ ] **S1.** Create pipeline stage `Possible Double Booking` (after `Confirmed`)
- [ ] **S2.** Create pipeline stage `Completed` (after `Possible Double Booking`, at the end) — WF-05/06 need it
- [ ] **S3.** Create the four workflow folders (naming §0)
- [ ] **S4.** Add sub-account custom value `Dispatch Webhook Token` (holds the secret; never inline it in a workflow)
- [ ] **S5.** Run `npm run ghl:ids` and confirm it picks up `stagePossibleDoubleBookingId` and `stageCompletedId`
- [ ] **S6.** Add the two new stage ids to the code's config read (small edit — I do this, noted in §After)

Workflows (build each, test, then publish — recommended order):
- [ ] **WF-01** Booking: Send confirmation
- [ ] **WF-02** Booking: 24-hour reminder
- [ ] **WF-03** Dispatch: Driver assigned → notify our system  *(the one that powers double-booking detection)*
- [ ] **WF-04** Dispatch: Possible double booking → alert owner
- [ ] **WF-05** Booking: Ride completed
- [ ] **WF-06** Care: Post-ride review request

Suggested order: build **WF-01 to WF-04** first and test them, then **WF-05/06**
(which depend on the `Completed` stage from S2). All six are in scope.

---

## S1 — Create the `Possible Double Booking` stage

**What we'll do:** In **PSDLimo Bookings** pipeline (Settings → Pipelines), add a
stage named exactly `Possible Double Booking`, positioned right after `Confirmed`.

**What it's for:** The dispatch webhook moves an opportunity here the moment it
detects a driver/vehicle time clash. It's the visible backstop so the owner sees
a double booking on the board even if the alert email is missed. The code already
tries to move opportunities here (`flagPossibleDoubleBooking()`); it currently
no-ops because the stage doesn't exist yet. Creating it is what turns that on.

No trigger/action — this is a pipeline setting, not a workflow.

---

## S2 — Create the `Completed` stage

**What we'll do:** In the same **PSDLimo Bookings** pipeline, add a stage named
exactly `Completed`, positioned last (after `Possible Double Booking`).

**What it's for:** Marks a ride as finished. WF-05 moves an opportunity here when
its appointment has ended, and WF-06 asks for a review off the back of it. Having
it as a real stage keeps the board readable — the owner can see at a glance what's
upcoming vs. done.

Final stage order on the board: `Confirmed` → `Possible Double Booking` →
`Completed`.

No trigger/action — pipeline setting.

---

## S4 — Store the dispatch token as a Custom Value

**What we'll do:** Settings → Custom Values → Add. Name: `Dispatch Webhook Token`.
Value: the `DISPATCH_WEBHOOK_TOKEN` string (same one set in Vercel). Reference it
in WF-03 as `{{ custom_values.dispatch_webhook_token }}` instead of pasting the
secret into the webhook action.

**What it's for:** Keeps the shared secret in one place, out of the workflow body,
and easy to rotate. WF-03's outbound webhook sends it so our endpoint trusts the
call.

---

# WF-01 — Booking: Send confirmation

**Folder:** `PSD · Booking Lifecycle`

**What it's for:** The customer just paid; the webhook has already created the
opportunity in **Confirmed** with every detail. This workflow sends the "your ride
is confirmed" email/SMS. It does NOT create or price anything — it only greets a
record that already exists.

### TRG: Opportunity Status Changed → entered `Confirmed`
- **Trigger type:** *Opportunity Status Changed* (a.k.a. "Pipeline Stage Changed"
  in newer UI).
- **Filters:**
  - Pipeline **is** `PSDLimo Bookings`
  - Stage **is** `Confirmed`
- **Why this trigger, not "Opportunity Created":** the webhook creates the
  opportunity DIRECTLY in Confirmed, so "entered Confirmed" fires exactly once per
  paid booking and never for a manual draft sitting in an earlier stage.

### Actions
- **ACT-1: Email customer confirmation** — *Send Email* to the contact. Body pulls
  from opportunity fields by merge tag: pickup `{{opportunity.pickup_location}}`,
  dropoff `{{opportunity.dropoff_location}}`, date `{{opportunity.pickup_datetime}}`,
  vehicle `{{opportunity.vehicle_class}}`, total `{{opportunity.quoted_price}}`,
  reference `{{opportunity.payment_ref_id}}`.
- **ACT-2: SMS customer confirmation** *(optional, needs A2P at go-live)* — short
  "Booking {{opportunity.payment_ref_id}} confirmed for {{opportunity.pickup_datetime}}".
- **Do NOT** add tags here — `pay.paid` etc. are already on the record from the webhook.

---

# WF-02 — Booking: 24-hour reminder

**Folder:** `PSD · Booking Lifecycle`

**What it's for:** Remind the customer (and set up the chauffeur hand-off) the day
before pickup. It anchors on the **calendar appointment** the webhook created,
because GHL date fields truncate the time — the appointment is the only
time-precise anchor.

### TRG: Appointment booked on `PSDLimo Rides`
- **Trigger type:** *Customer Booked Appointment* (a.k.a. "Appointment Status" →
  scheduled).
- **Filters:** Calendar **is** `PSDLimo Rides`.
- **Why:** every paid ride gets exactly one appointment here (start = pickup), so
  this is the reliable per-ride entry point for time-relative waits.

### Actions
- **ACT-1: Wait until 24 hours before appointment** — *Wait* → "Wait until" →
  relative to the appointment start time, offset −24 hours.
- **ACT-2: If reminder not already sent** — *If/Else* on tag
  `lifecycle.reminder-sent` **does not exist** (guards against duplicate sends if
  the workflow re-enters).
- **ACT-3: Email + SMS reminder** — same merge tags as WF-01.
- **ACT-4: Add tag `lifecycle.reminder-sent`** — *Add Tag*, so a re-run is a no-op.

---

# WF-03 — Dispatch: Driver assigned → notify our system

**Folder:** `PSD · Dispatch`
**This is the workflow that powers double-booking detection.** It's the bridge
from "owner typed a driver name in GHL" to our `/api/dispatch/assign` endpoint.

**What it's for:** When the owner assigns a chauffeur, GHL calls our webhook with
the booking reference + the driver name. Our code records the assignment and runs
the clash check; on a clash it moves the opportunity to `Possible Double Booking`
(which fires WF-04). GHL cannot itself compare times across bookings — that's why
the check lives in our DB and this workflow just forwards the assignment.

### TRG: `Chauffeur Assigned` field updated
- **Trigger type:** *Opportunity Changed* (a.k.a. "Custom Field Updated" on the
  opportunity, depending on UI).
- **Filters:**
  - Pipeline **is** `PSDLimo Bookings`
  - `{{opportunity.chauffeur_assigned}}` **is not empty**
- **Why:** `Chauffeur Assigned` is the ONE manual field the owner fills. Firing on
  its change is exactly "the owner assigned a driver". Guarding on not-empty stops
  it firing when the field is cleared.

### Actions
- **ACT-1: Webhook → our dispatch endpoint** — *Webhook* action (this is a GHL
  **outbound** webhook / "Custom Webhook", NOT the paid "Inbound Webhook"
  trigger).
  - **Method:** `POST`
  - **URL:** `https://psdlimo-booking.vercel.app/api/dispatch/assign`
  - **Headers:**
    - `Content-Type: application/json`
    - `x-dispatch-token: {{ custom_values.dispatch_webhook_token }}`
  - **Body (JSON) — field names must match our schema EXACTLY:**
    ```json
    {
      "external_id": "{{opportunity.payment_ref_id}}",
      "driver_name": "{{opportunity.chauffeur_assigned}}"
    }
    ```
    *(`vehicle_id` is optional and omitted — the owner assigns by driver name; the
    same-car check is available later if you start recording vehicles.)*
- **No other action.** Our endpoint does the recording, the clash check, and (on a
  clash) the stage move. GHL must not also move the stage here.

> **Field-name accuracy note:** our endpoint validates the body with zod and
> rejects anything else with **400**. The keys are exactly `external_id` and
> `driver_name`. `external_id` MUST be the payment reference
> (`{{opportunity.payment_ref_id}}`), because that's the key the trip was stored
> under by the payment webhook.

---

# WF-04 — Dispatch: Possible double booking → alert owner

**Folder:** `PSD · Internal Alerts`

**What it's for:** Our endpoint has just moved a clashing booking into
`Possible Double Booking`. This workflow emails the owner so a conflict is never
silent. This is the "email the owner" half of the double-booking safeguard — sent
by GHL, which is why the system needs no email service of its own.

### TRG: Opportunity entered `Possible Double Booking`
- **Trigger type:** *Opportunity Status Changed*.
- **Filters:**
  - Pipeline **is** `PSDLimo Bookings`
  - Stage **is** `Possible Double Booking`
- **Why:** the stage move is done by our code the instant a clash is detected, so
  "entered this stage" == "a double booking was just found".

### Actions
- **ACT-1: Add tag `ops.double-booking`** — *Add Tag*, so clashes are filterable
  in search/reporting.
- **ACT-2: Email the owner** — *Send Internal Notification* / *Send Email* to the
  owner's address. Include: customer `{{contact.name}}`, reference
  `{{opportunity.payment_ref_id}}`, pickup `{{opportunity.pickup_datetime}}`,
  driver `{{opportunity.chauffeur_assigned}}`. Subject e.g.
  `⚠ Possible double booking — {{opportunity.payment_ref_id}}`.
- **ACT-3 (optional): SMS the owner** for same-day clashes.

---

# WF-05 — Booking: Ride completed

**Folder:** `PSD · Booking Lifecycle`
**Prerequisite:** the `Completed` stage from **S2**.

**What it's for:** Marks a ride done — moves the board to `Completed` and drops the
`lifecycle.completed` tag that WF-06 keys off. Anchors on the appointment ending,
so it needs no manual step from the owner.

### TRG: Appointment on `PSDLimo Rides` has ended
- **Trigger type:** *Appointment Status* → the appointment's end time has passed
  (a.k.a. an "appointment ended" / end-time-relative wait).
- **Filters:** Calendar **is** `PSDLimo Rides`.
- **Why not "owner drags to Completed":** the appointment end is already the
  precise ride-end time the webhook computed, so completion is automatic and can't
  be forgotten. (If the owner prefers manual control, swap to *Opportunity Status
  Changed → Stage is `Completed`* — but then WF-05 only tags, it doesn't move.)

### Actions
- **ACT-1: Move opportunity to `Completed` stage** — *Update Opportunity* → Stage
  `Completed`.
- **ACT-2: Add tag `lifecycle.completed`** — this is what triggers WF-06.

---

# WF-06 — Care: Post-ride review request

**Folder:** `PSD · Customer Care`

**What it's for:** Ask a happy customer for a review a few hours after the ride.
Chained off WF-05's tag so it only fires for genuinely completed rides.

### TRG: Tag `lifecycle.completed` added
- **Trigger type:** *Contact Tag* → *Tag Added* → tag `lifecycle.completed`.
- **Why this and not the `Completed` stage directly:** keying off the tag WF-05
  sets keeps the two workflows loosely coupled — if you ever change how completion
  is decided, only WF-05 changes and WF-06 keeps working.

### Actions
- **ACT-1: Wait 3 hours** — *Wait* (gives the ride time to actually finish).
- **ACT-2: Email/SMS review request** with the review link, addressed to
  `{{contact.name}}`, referencing `{{opportunity.pickup_datetime}}`.

---

## Global settings to confirm before publishing

| Setting | Where | Value | Why |
|---|---|---|---|
| Workflow timezone | each workflow → Settings | **America/Los_Angeles** | time-relative waits (WF-02) must use SF time |
| Re-entry | each workflow → Settings | **OFF** for WF-01/03/04; **ON** allowed for WF-02 (tag-guarded) | prevents duplicate confirmations/alerts |
| Sender email/domain | Settings → Email Services | verified domain | so confirmations don't spam-foldered |

---

## After the sheet — the one code change

Once **S1/S2** (both stages created) are done and `npm run ghl:ids` (**S5**) has
run, the resolver needs to WRITE the new stage ids into `config/ghl-fields.json`
as `stagePossibleDoubleBookingId` and `stageCompletedId`. Today the resolver only
looks for the `Confirmed` stage, so I'll add `Possible Double Booking` and
`Completed` to its expected-stages list (**S6**, a small edit to
`scripts/fetch-ghl-ids.ts`). After that:

- `flagPossibleDoubleBooking()` stops no-op-ing and actually moves the opportunity
- a clash flips from `opportunityFlagged: false` → `true` with **zero** other
  change
- WF-04 fires and the owner gets the email

That's the whole activation. Nothing about the booking, pricing, or dispatch code
changes — only the GHL config catches up to what the code already does.

---

## What we are deliberately NOT doing (so it's on the record)

- **No workflow creates or prices an opportunity.** The webhook owns that.
- **No workflow applies `service.*` / `pay.*` tags.** The webhook owns those.
- **No inbound "Inbound Webhook" trigger** (GHL bills those). WF-03 uses an
  OUTBOUND webhook action, which is free.
- **No n8n / external glue.** GHL calls our endpoint directly.
```
