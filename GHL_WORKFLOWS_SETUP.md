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
> - Stages (all 7 exist): New Inquiry · Quoted · **Confirmed** (`fb8d9242…`, where
>   the webhook writes paid bookings) · **Assigned** (`021498e1…`) · In Progress ·
>   **Completed** (`c6e15f34…`) · **Cancelled** (`520f0c7c…`)
> - Calendar **PSDLimo Rides**: `mbiZTjEQc8qtnVYl413q`
> - Double-booking flag: contact TAG `ops.double-booking` (no dedicated stage)
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
Plain Title Case, no prefix (stages are customer/owner-facing in the CRM board).
All 7 already exist — **none are created in this sheet**:
`New Inquiry · Quoted · Confirmed · Assigned · In Progress · Completed · Cancelled`.
A double booking is a TAG, not a stage.

### Tags
Already established and **must not change** — lowercase, dot-separated namespaces:
`namespace.value`. The webhook writes `source.website`, `pay.card`, `pay.paid`,
`service.*`, `client.corporate`. **Workflows read these; they do not invent new
service tags.** The only NEW tags a workflow may add are lifecycle markers in a
new namespace:

| New tag | Set by | Means |
|---|---|---|
| `lifecycle.reminder-sent` | WF-02 | the 24h reminder went out (prevents re-sends) |
| `lifecycle.completed` | WF-05 | the ride finished (its appointment ended) |
| `ops.double-booking` | **our dispatch code** (not a workflow) | a driver/vehicle time clash was detected; WF-04 emails the owner on it |

### Trigger names (inside each workflow)
`TRG: <what fires it>` — e.g. `TRG: Opportunity entered Confirmed`.

### Action names (inside each workflow)
`ACT-<n>: <verb> <object>` — e.g. `ACT-1: Email customer confirmation`,
`ACT-2: Wait until 24h before pickup`. Numbered so support can refer to "ACT-3".

---

## THE CHECKLIST (do these in order)

> **Reality check (verified live 2026-07-24):** the pipeline ALREADY has 7 stages —
> `New Inquiry → Quoted → Confirmed → Assigned → In Progress → Completed →
> Cancelled`. **No stages need creating.** A double booking is flagged with the
> `ops.double-booking` TAG, not a stage, so there is no "Possible Double Booking"
> stage. All 11 tags now exist (the 3 missing `service.*` were created). The
> resolver already captured the real stage ids into `config/ghl-fields.json`.

Setup (once):
- [ ] **S1.** Create the four workflow folders (naming §0)
- [ ] **S2.** Add sub-account custom value `Dispatch Webhook Token` (holds the secret; never inline it in a workflow)

That's the entire setup — the stages and tags are already in place, so we go
straight to building workflows.

Workflows (build each, test, then publish — recommended order):
- [ ] **WF-01** Booking: Send confirmation
- [ ] **WF-02** Booking: 24-hour reminder
- [ ] **WF-03** Dispatch: Driver assigned → notify our system  *(the one that powers double-booking detection)*
- [ ] **WF-04** Dispatch: Double booking detected → alert owner
- [ ] **WF-05** Booking: Ride completed
- [ ] **WF-06** Care: Post-ride review request

Suggested order: build **WF-01 to WF-04** first and test them, then **WF-05/06**.
All six are in scope.

---

## Stages & tags — ALREADY DONE (nothing to create)

The pipeline's 7 stages and all 11 tags already exist (verified/created
2026-07-24). There is deliberately **no** "Possible Double Booking" stage — a
clash is a `ops.double-booking` TAG layered on top of whatever real stage the
booking is in (Assigned, In Progress, …), so nothing about where the booking
actually is gets destroyed. Skip straight to the setup below.

---

## S1 — Create the four workflow folders

**What we'll do:** Automation → Workflows → Folders (or the folder icon) → create:
`PSD · Booking Lifecycle`, `PSD · Dispatch`, `PSD · Customer Care`,
`PSD · Internal Alerts` (naming §0).

**What it's for:** Keeps the six workflows organized by area so the account stays
legible for whoever inherits it.

---

## S2 — Store the dispatch token as a Custom Value

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
the clash check; on a clash it TAGS the contact `ops.double-booking` (which fires
WF-04). GHL cannot itself compare times across bookings — that's why the check
lives in our DB and this workflow just forwards the assignment.

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
- **ACT-2 (optional): Move opportunity to `Assigned` stage** — *Update
  Opportunity* → Stage `Assigned`. Purely cosmetic (keeps the board tidy). Safe
  because the clash flag is a TAG, not a stage — tagging never fights this move.
  Skip it if you'd rather move cards manually.
- **Our endpoint does the recording, the clash check, and (on a clash) the
  contact tagging.** GHL must not try to detect clashes itself.

> **Field-name accuracy note:** our endpoint validates the body with zod and
> rejects anything else with **400**. The keys are exactly `external_id` and
> `driver_name`. `external_id` MUST be the payment reference
> (`{{opportunity.payment_ref_id}}`), because that's the key the trip was stored
> under by the payment webhook.

---

# WF-04 — Dispatch: Double booking detected → alert owner

**Folder:** `PSD · Internal Alerts`

**What it's for:** Our endpoint has just tagged a clashing booking's contact
`ops.double-booking`. This workflow emails the owner so a conflict is never
silent. This is the "email the owner" half of the double-booking safeguard — sent
by GHL, which is why the system needs no email service of its own.

### TRG: Tag `ops.double-booking` added
- **Trigger type:** *Contact Tag* → *Tag Added*.
- **Filter:** tag **is** `ops.double-booking`.
- **Why a tag, not a stage:** our code flags a clash by tagging the CONTACT (GHL
  tags are contact-scoped), NOT by moving the opportunity — moving it would
  destroy the record of the real stage (Assigned / In Progress / …). So "this tag
  was just added" == "a double booking was just detected".

### Actions
- **ACT-1: Email the owner** — *Send Internal Notification* / *Send Email* to the
  owner's address. Include: customer `{{contact.name}}`, phone `{{contact.phone}}`,
  driver `{{contact.first_name}}`… — note that per-booking fields
  (`{{opportunity.*}}`) are only available if this workflow is opportunity-aware;
  a Contact-Tag trigger is contact-scoped, so prefer contact merge fields here and
  point the owner to the contact record for booking detail. Subject e.g.
  `⚠ Possible double booking — {{contact.full_name}}`.
- **ACT-2 (optional): SMS the owner** for urgency.

> **Merge-field note:** because the trigger is a *contact* tag, opportunity merge
> fields may not resolve in this workflow. Keep the email pointing to the contact
> (name/phone) and let the owner open the contact to see the clashing bookings —
> both trips are on the same contact record. If you want full booking detail in
> the email, an alternative is to trigger WF-04 off the `Assigned` stage instead
> and filter to contacts that have the `ops.double-booking` tag; tell me and I'll
> spell that variant out.

---

# WF-05 — Booking: Ride completed

**Folder:** `PSD · Booking Lifecycle`
**Prerequisite:** the `Completed` stage — **already exists** in the pipeline.

**What it's for:** When a ride is marked **Completed**, drop the
`lifecycle.completed` tag that WF-06 (the review request) keys off.

> **IMPORTANT — do NOT trigger this on a timer (decided 2026-07-25).** An earlier
> draft fired this when the appointment's *scheduled* end time passed. That is
> WRONG: traffic and delays mean the real ride often ends much later, so a timer
> could ask a customer to review a ride they're still sitting in. "Completed" must
> mean the ride ACTUALLY ended — a human/driver signal, never a clock. Today that
> signal is the opportunity entering the `Completed` stage (the owner moves it, or
> the future driver portal marks it done). This is what makes post-ride automation
> trustworthy.

### TRG: Opportunity entered `Completed`
- **Trigger type:** *Opportunity Status Changed* (a.k.a. "Pipeline Stage Changed").
- **Filters:**
  - Pipeline **is** `PSDLimo Bookings`
  - Stage **is** `Completed`
- **Why:** the stage moves to Completed only when a real person confirms the ride
  is done, so "entered Completed" == "the ride genuinely finished" — delay-proof.

### Actions
- **ACT-1: Add tag `lifecycle.completed`** — this is what triggers WF-06. (No stage
  move here — the trigger already IS the stage change.)

---

# WF-06 — Care: Post-ride review request

**Folder:** `PSD · Customer Care`

**What it's for:** The moment a ride is marked completed, thank the customer and
ask for a review — while the experience is fresh. Chained off WF-05's tag so it
only fires for genuinely completed rides.

### TRG: Tag `lifecycle.completed` added
- **Trigger type:** *Contact Tag* → *Tag Added* → tag `lifecycle.completed`.
- **Why this and not the `Completed` stage directly:** keying off the tag WF-05
  sets keeps the two workflows loosely coupled — if you ever change how completion
  is decided, only WF-05 changes and WF-06 keeps working.

### Actions
- **ACT-1: Email review request** — sent IMMEDIATELY, no wait (decided 2026-07-25).
  A prompt "how was your ride?" the moment they step out reads as attentive and
  premium; an arbitrary multi-hour delay reads as a mass-market automated nag.
  Address `{{contact.first_name}}`, include the review link.

---

## Global settings to confirm before publishing

| Setting | Where | Value | Why |
|---|---|---|---|
| Workflow timezone | each workflow → Settings | **America/Los_Angeles** | time-relative waits (WF-02) must use SF time |
| Re-entry | each workflow → Settings | **OFF** for WF-01/03/04; **ON** allowed for WF-02 (tag-guarded) and WF-04 (a contact can clash more than once) | prevents duplicate confirmations |
| Sender email/domain | Settings → Email Services | verified domain | so confirmations don't spam-foldered |

---

## The code side — ALREADY DONE (verified live 2026-07-24)

No code change is pending for this sheet. The dispatch endpoint and the clash
tagging already work against live GHL:

- `flagPossibleDoubleBooking()` tags the contact `ops.double-booking` (no longer a
  no-op). Proven: seeded two overlapping trips on a real test contact, hit the
  deployed endpoint → `{clash:true, flagged:true}`, and the contact came back
  tagged `["ops.double-booking"]`.
- `npm run ghl:ids` already resolved the real stage ids (`stageAssignedId`,
  `stageCompletedId`, `stageCancelledId`) into `config/ghl-fields.json`.

So the ONLY remaining work is building the six workflows in the GHL UI (this
sheet). Once WF-03 exists, the loop is closed: assign a driver → our endpoint runs
the clash check → on a clash the contact is tagged → WF-04 emails the owner.

---

## What we are deliberately NOT doing (so it's on the record)

- **No workflow creates or prices an opportunity.** The webhook owns that.
- **No workflow applies `service.*` / `pay.*` tags.** The webhook owns those.
- **No inbound "Inbound Webhook" trigger** (GHL bills those). WF-03 uses an
  OUTBOUND webhook action, which is free.
- **No n8n / external glue.** GHL calls our endpoint directly.
```
