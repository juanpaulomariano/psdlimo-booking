# ARCHITECTURE AUDIT — after the DB pivot

Full audit of the current build against the new target architecture (website+DB
as the operational backbone, GoHighLevel as the communications layer). Answers:
what changes, and every decision the owner must make.

Ground truth pulled live 2026-07-24. Nothing here changes code yet — it is the
map we build from.

---

## 0. The core inversion (why anything changes at all)

**Before:** GHL was the system of record. The webhook wrote EVERYTHING into GHL
(18 opportunity fields) because there was no database. GHL held booking data,
dispatch data, and drove communications.

**After:** the website + Neon DB is the system of record for **operations**
(bookings, rates, drivers, dispatch, trips, reporting). GHL becomes the
**communications + sales-pipeline** layer.

This is a genuine inversion, and it means: **GHL should stop being asked to store
operational detail it no longer owns.** Much of what the webhook writes to GHL
today becomes redundant once the DB is the source of truth. Keeping both in sync
is the classic dual-write trap — so the audit's job is to decide, field by field,
**who owns each piece of data** and **what GHL still needs a copy of (and why).**

Guiding rule for the new split:
> The DB owns the TRUTH. GHL holds only what a WORKFLOW or a HUMAN-IN-GHL needs to
> send a message or work the pipeline. If no workflow and no GHL user reads a
> field, it does not belong in GHL anymore.

---

## 1. LAYER-BY-LAYER AUDIT

### 1.1 Booking / pricing engine (website)
| | |
|---|---|
| Now | Pure function, rates in `config/rates.ts` (code). One-way, hourly, flat. |
| Changes | Rates move to DB (owner-editable). Add round-trip. Add zones. Add "request a quote". |
| Risk | Low — engine stays a pure function; only the SOURCE of numbers moves. Last-good fallback so a DB blip never breaks quoting. |
| Breaks anything? | No. Behaviour identical; source relocates. Tests pin every rule. |

### 1.2 Payments (`lib/payments.ts`)
| | |
|---|---|
| Now | Xendit test, PHP conversion, isolated boundary. |
| Changes | Swap to PSD-owned Stripe US (Stage H). One file by design. |
| Risk | Low — the boundary was built for exactly this swap. |
| Breaks anything? | No, until we deliberately swap. |

### 1.3 The webhook (`/api/xendit-webhook`)
| | |
|---|---|
| Now | Verifies token → fetches invoice metadata → upserts GHL contact + creates opportunity (18 fields) + tags + appointment. |
| Changes | **This is the biggest rewrite.** After the DB exists, the booking is written to the DB FIRST (system of record). GHL then receives only the SUBSET needed for communications (see §2). Appointment creation may move or stay — decision below. |
| Risk | Medium — it is the hinge. But we have full test coverage + idempotency + it is one well-understood file. |
| Breaks anything? | Only if done carelessly. Built in a slice with the DB write added before the GHL write is trimmed, so there is never a gap. |

### 1.4 GoHighLevel (the layer that changes MOST in shape)
See §2 and §3 — the whole field/tag/pipeline reckoning.

### 1.5 Calendar / appointments
| | |
|---|---|
| Now | Webhook writes an appointment to the GHL "PSDLimo Rides" calendar; timed workflows anchor on it. |
| Decision | With dispatch moving to the DB, do trips live on the GHL calendar, the DB, or both? The GHL calendar is still the natural anchor for GHL's timed reminder workflows. Leaning: KEEP the GHL appointment (workflows need it) AND store the trip in the DB (dispatch needs it). One-way sync DB→GHL at booking. Decision D-7 below. |

### 1.6 Auth / roles (NEW layer)
| | |
|---|---|
| Now | None — no logins anywhere. |
| Changes | Auth.js. Roles: owner, driver (dispatcher/CS later). Gates the admin + driver views. |
| Risk | Moderate (the one real new muscle) — mitigated by using the library, never hand-rolling. |

### 1.7 Data / reporting (NEW)
| | |
|---|---|
| Now | GHL's built-in reporting only. |
| Changes | DB-driven reporting (bookings, revenue, conversion, abandoned, source). Export. |
| Risk | Low-moderate; scope to useful counts first. |

---

## 2. GHL CUSTOM FIELDS — the field-by-field reckoning

The 18 opportunity fields were written because GHL was the database. Now the DB
is. Each field gets a verdict:
- **KEEP-IN-GHL** — a workflow or GHL user reads it to send a message / work the pipeline.
- **DROP-FROM-GHL** — pure operational data the DB now owns; no GHL consumer.
- **KEEP (reference)** — small denormalized copy so a message can render or a human can glance, even though the DB is the truth.

### Opportunity fields
| Field | Verdict | Why |
|---|---|---|
| `pickup_location` | **KEEP (reference)** | Reminder/confirmation emails render it; ride card shows it. |
| `dropoff_location` | **KEEP (reference)** | Same. |
| `pickup_datetime` | **KEEP (reference)** | Message copy + human glance (time truly lives on the appointment/DB). |
| `ride_type` | **KEEP (reference)** | Some message branching; reporting moves to DB. |
| `vehicle_class` | **KEEP (reference)** | Chauffeur-intro + ride-card copy. |
| `passenger_count` | **KEEP (reference)** | Ride card. |
| `luggage_count` | **DROP candidate** | Only the ride card used it; DB has it. Marginal. **Decision D-2.** |
| `flight_number` | **KEEP (reference)** | 2-hour reminder copy when present. |
| `addons` | **DROP candidate** | Ride card only. DB owns. **Decision D-2.** |
| `hours_booked` | **KEEP (reference)** | Ride-card / appointment context for hourly. |
| `quoted_price` | **DROP** | Reporting field; DB owns all revenue reporting now. |
| `final_price` | **KEEP (reference)** | Receipt/thank-you email renders it. |
| `booking_source` | **DROP** | Reporting; DB owns. (Tag `source.website` still marks it for GHL segmentation.) |
| `special_requests` | **KEEP (reference)** | Ride card. |
| `payment_ref_id` | **KEEP** | Still the idempotency key for the GHL-side write + the DB↔GHL join key. |
| `chauffeur_assigned` | **CHANGES MEANING** | Was owner-typed in GHL. Now the DB assigns the driver; this becomes a REFERENCE copy pushed DB→GHL so the ride-card/customer message can name the driver. **Decision D-3.** |
| `chauffeur_phone` | **CHANGES MEANING** | Same — reference copy from the DB driver record. |
| `appointment_id` | **KEEP** | Appointment retry-safety, if we keep GHL appointments (D-7). |

**Net:** likely ~10-12 GHL opportunity fields survive as reference copies; ~4-6
drop because the DB now owns reporting/operational detail. **This is a decision
you sign off on, field by field (D-2), not something I trim unilaterally.**

### Contact fields
| Field | Verdict | Why |
|---|---|---|
| `client_type` | **KEEP** | Owner-set (individual/corporate/vip); RETN-02 VIP branch. |
| `preferred_vehicle` | **KEEP** | Personalization in win-back. |
| `lifetime_rides` | **DECISION D-4** | The DB can now compute this authoritatively. Keep in GHL for the `client.repeat` workflow branch, OR compute in DB and push. Leaning: DB computes, pushes a copy to GHL for the workflow. |
| `last_ride_date` | **DECISION D-4** | Same reasoning. |

---

## 3. GHL PIPELINE & STAGES — the dispatch-model collision

Live stages today: New Inquiry · Quoted · Confirmed · Assigned · In Progress ·
Completed · Cancelled.

**The problem:** these stages were designed when GHL DROVE dispatch (owner drags
card Confirmed→Assigned→In Progress). In the new model, **the DB drives dispatch**
— assignment, accept/reject, statuses all happen in the website. So GHL stages
partly duplicate DB trip-status.

Two coherent options — **Decision D-5:**

**Option 5A — GHL stages mirror DB status (one-way DB→GHL).**
The DB is the source of truth for trip status; when status changes, we push the
opportunity to the matching GHL stage so GHL workflows still fire on stage change
and the owner sees a familiar board. Stages become a *reflection*, not a *driver*.

**Option 5B — Simplify GHL stages to communication-relevant milestones only.**
GHL keeps only the stages that TRIGGER a message: e.g. Confirmed (→ confirmation),
Completed (→ thank-you/review), Cancelled (→ cancellation). Fine-grained dispatch
statuses (Assigned/Accepted/En-Route…) live ONLY in the DB. Fewer moving parts;
GHL stops pretending to be a dispatch board.

Leaning: **5B** — cleaner, matches the inversion, less dual-state. But 5A keeps the
owner's existing GHL muscle memory. Your call.

---

## 4. GHL TAGS — mostly survive, some move

Tags are for SEGMENTATION and workflow triggers — still GHL's job. Most stay.
| Tag family | Verdict |
|---|---|
| `source.*` | **KEEP** — segmentation. |
| `service.*` (airport/hourly/intercity/winetour/group/corporate/pointtopoint) | **KEEP** — still derived at booking, still used for GHL segmentation + high-value alert. Add `service.roundtrip`. |
| `pay.*` | **KEEP** — payment segmentation. |
| `client.*` (corporate/repeat/vip) | **KEEP** — win-back + owner branches. |
| `status.*` (cancelled/noshow) | **DECISION D-6** — the DB now owns trip status. Keep the tags for GHL analytics, or drop and let the DB report? Leaning: keep as lightweight GHL analytics markers, DB is the truth. |
NEW tag needed: `service.roundtrip` (once round-trip ships).

---

## 5. THE DECISIONS YOU OWN (numbered, so we can work through them)

- **D-1 — Sync direction & timing.** Confirm: DB is written FIRST (system of record),
  then a one-way push DB→GHL for communications. GHL never writes back to the DB.
  (Strongly recommended — avoids the dual-write trap.)
- **D-2 — Which GHL opportunity fields to DROP.** Sign off the drop list
  (candidates: luggage_count, addons, quoted_price, booking_source). Everything
  else stays as a reference copy.
- **D-3 — Driver data in GHL.** Confirm chauffeur_assigned/phone become DB→GHL
  reference copies (DB owns the driver record; GHL gets a name/phone so messages
  can render).
- **D-4 — lifetime_rides / last_ride_date ownership.** DB computes, pushes a copy
  to GHL for the repeat/win-back workflows? (Recommended) Or keep GHL's Math action?
- **D-5 — Pipeline stages: 5A mirror DB status, or 5B simplify to message milestones.**
- **D-6 — status.cancelled/noshow tags: keep as GHL analytics or drop (DB owns)?**
- **D-7 — Appointments: keep GHL calendar appointment (workflows anchor on it) AND
  store trip in DB? Or move timing anchor into the DB and rebuild reminders around
  DB timestamps?** (Leaning keep-both, one-way DB→GHL — least disruption to the
  workflows we already designed.)
- **D-8 — When to rewrite the webhook.** After the DB + rates are in (Stage B), the
  webhook changes from "write everything to GHL" to "write DB, push subset to GHL".
  Confirm this lands as its own slice in Stage B/E, not now.
- **D-9 — Do the 12 workflows change?** Most are communication workflows and are
  unaffected (they read reference fields that survive). The DISPATCH-related ones
  (assignment nudges, chauffeur-assigned) change because assignment now happens in
  the DB, not by dragging a GHL card. Decision: rebuild those few around a DB→GHL
  trigger (a webhook INTO GHL on assignment) vs keep them GHL-native. **This is why
  we PAUSED before building workflows — good timing.**
- **D-10 — Rebuild vs adapt the GHL sandbox.** Given the field drops + stage change,
  do we (a) surgically edit the existing sandbox, or (b) rebuild the GHL config
  clean now that we know the final shape? Leaning (a) surgical — the existing
  fields/tags are 80% right.

---

## 6. WHAT DOES *NOT* CHANGE (reassurance)
- The booking wizard, pricing math, Google Maps, the payment boundary pattern,
  the webhook's SECURITY (token verify, idempotency), the route map — all intact.
- Most GHL tags and communication workflows survive.
- The `.env`, deploy, and Vercel setup are unaffected.
- Everything live-verified in Phases 0-8 keeps working; we ADD the DB beneath it
  and TRIM GHL's operational duplication — we do not tear anything down.

---

## 7. RECOMMENDED SEQUENCING (given the audit)
The audit REINFORCES the roadmap order, with one change:
1. **Stage B (DB + rates) FIRST** — nothing can be decided about GHL's reduced role
   until the DB exists to take over. Do NOT build the 12 workflows yet.
2. Then the **webhook rewrite** (DB-first, GHL-subset) as a Stage-B slice.
3. Then **Stage E dispatch** in the DB.
4. **THEN** finalize GHL fields/stages/tags (surgical edit) and build the workflows
   (Stage A) — now that GHL's final role is known.
   → i.e. **move Stage A to AFTER the DB + dispatch**, because building 12 workflows
   before knowing GHL's reduced shape would mean building some of them twice.

**This is the single biggest sequencing change the audit surfaces: do NOT build the
GHL workflows next. Build the database first, let GHL's role settle, then build the
workflows once — against the final field/stage shape.**
