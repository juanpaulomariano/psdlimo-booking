# PSD Limo — Revised Project Proposal

**Prepared for:** PSD Limo (Mohammad)
**Prepared by:** Ally Virtual
**Date:** ____________  ·  **Valid for:** 30 days from the date above

> **⚠ WORKING DRAFT — read before sending.** Every TECHNICAL fact here is accurate
> and verified against the working system. Every COMMERCIAL figure marked
> **`[YOU DECIDE]`** is a business decision only you can set — your labour rate,
> margin, and support commitments. Fill those in, delete this banner and all
> `[YOU DECIDE]` tags, then send. The client explicitly requires "no placeholders,
> no internal notes" — this banner and those tags must be gone in the final.

---

## 1. Executive summary

PSD Limo will receive a complete, custom booking and customer-management system:
a high-performance website where customers book and pay for chauffeured rides,
connected automatically to a GoHighLevel CRM that manages every customer
relationship from first inquiry through post-trip follow-up — with the owner able
to adjust their own pricing at any time and no manual data entry at any step.

A working demonstration of the core system is already live and can be shown on
request: a customer books a ride, receives instant distance-based pricing, pays on
a secure page, and the booking appears in the CRM fully tagged, staged, and placed
on the operations calendar — untouched by hands. Owners log in to adjust rates and
see the change reflected in the very next quote.

The system is built so that **PSD Limo owns everything** — code, accounts, data —
under PSD Limo's own business email from the start, with no lock-in.

## 2. Technical architecture (plain-language)

| Layer | What it does | Technology |
|---|---|---|
| **Website** | Booking, live pricing, secure payment, owner admin | Next.js on Vercel |
| **Database** | Stores pricing, accounts, and operational records | Neon Postgres |
| **Maps** | Real driving distance + travel time | Google Routes + Places |
| **Payments** | Hosted, secure card payment | Client-owned processor (Stripe US) |
| **CRM** | Contacts, sales pipeline, all customer messaging | GoHighLevel |
| **The link** | Website writes bookings into the CRM automatically | The website's own secure webhook — no third-party automation tool |

**Design principle:** the CRM (GoHighLevel) is the owner's cockpit for customers
and communications. The website's database silently runs pricing and operational
logic. The owner manages customers in one familiar place (the CRM) and adjusts
pricing in one simple admin screen. There is no second dashboard to learn.

## 3. Scope by phase

Each phase has deliverables, acceptance criteria, and a payment milestone (§6, §7).

### Phase 1 — Discovery & specification
- Map the full customer journey (inquiry → quote → payment → assignment → trip →
  follow-up). Define booking types, pricing rules, vehicle categories, statuses,
  and user roles. Deliver an approved Functional Requirements Document before
  development continues.
- **Included:** written specification, architecture diagram, approved FRD.

### Phase 2 — Website & booking system
- Custom, mobile-responsive website (already substantially built and live in demo).
- Multi-step booking: pickup, destination, date/time, passengers, luggage,
  vehicle, contact details. Google Maps distance + travel-time pricing.
- **Booking types:** one-way (point-to-point), hourly, airport transfer, fixed
  routes. **Round-trip: included in this phase.** Complex trips → a manual
  "Request a Quote" path.
- Flight number, airport pickup details, meet-and-greet, child seats, extra stops.
- Rules-based pricing the owner can adjust (rates, vehicle multipliers, add-ons,
  fees) through a secure admin — **already working in the demo.**
- Online payment through **PSD Limo's own payment-processor account.**
- Automated booking confirmations and receipts (via the CRM).
- Customer-facing legal pages: privacy, terms, cancellation policy.
- Basic technical SEO, schema markup, Google Analytics, Search Console.
- Cross-browser + mobile testing (iPhone, Android, Chrome, Safari, Edge).

### Phase 3 — CRM, automation & communications
- Dedicated GoHighLevel sub-account with **full administrator access for PSD Limo.**
- Complete booking/sales pipeline with defined stages.
- Automatic lead creation from the website. (Chat/phone/social channels: **future
  phase**, see §12.)
- Automated acknowledgment, booking confirmation, pre-trip reminders (24h, 2h),
  thank-you, and review requests. Email + SMS templates written and approved
  before launch.
- Reporting on inquiries, bookings, revenue, conversion, abandoned bookings, and
  source.
- **AI assistant: future phase** (§12) — designed for, not built now.

### Phase 4 — Driver & ride management
Stated plainly per your requirement — this is real ride management, not only
"assisted dispatch," with an honest now-vs-later split:

**Included now:**
- Driver and vehicle records; assignment of a booking to a driver/vehicle (in the
  CRM the owner already uses).
- **Automated double-booking protection:** the system checks every assignment
  against all trips for a driver or vehicle time-clash. On a clash, the owner gets
  an immediate email **and** the booking is flagged in a "Possible Double Booking"
  pipeline stage so it cannot be missed.
- Driver notifications with trip details; customer notification when a driver is
  assigned.
- Trip statuses: Assigned, Accepted, Completed, Cancelled, No-Show.
- Trip history and operational reporting.

**Future phase (§12):** driver self-service portal with live statuses (En Route,
Arrived, Passenger On Board), driver accept/reject in-app, driver document records
+ expiry alerts, commission reporting, partner/owner-driver management.

### Phase 5 — Testing, training & handover
- Staging environment for review before launch.
- End-to-end testing of **20+ booking scenarios**; successful/failed/pending/
  abandoned payments; every booking type; modification, cancellation, driver
  rejection; email/SMS/CRM/maps/payment integrations.
- Written defect list; all critical + high-priority defects resolved before launch.
- Live staff training + recorded videos; written admin/operations documentation.
- Handover of **all credentials, code, configuration, and integration keys.**
- **Post-launch warranty: [YOU DECIDE — 60 or 90 days]** for in-scope defects.

## 4. Included vs excluded (summary)

**Included:** everything in Phases 1–5 above, including round-trip, editable
pricing, automated double-booking protection, the full communication automations,
and complete ownership handover.

**Excluded (future phases, separately quoted):** AI assistant · chat/phone/social
lead channels · driver self-service portal + live statuses · driver document
management · commission reporting · zone-to-zone pricing matrix · native mobile
app · offline capability · feeder-company ingestion.

## 5. Pricing

> **`[YOU DECIDE]` — this entire section is your commercial call.** The
> INFRASTRUCTURE costs below are verified and real. The DEVELOPMENT FEE and
> MANAGEMENT FEE are your labour/margin decisions.

### One-time setup & development
| Item | Fee |
|---|---|
| Complete build (Phases 1–5) | **`[YOU DECIDE]`** |
| *(Optional: itemise per phase if you prefer)* | |

### Recurring monthly (verified infrastructure costs)
| Item | Cost | Notes |
|---|---|---|
| Website hosting (Vercel Pro) | **~$20/mo** | Only fixed infra cost. Free tier is non-commercial by licence. |
| Database (Neon) | **~$0–$1/mo** | Usage-based, no fixed fee; scales to a few dollars only at ~100× current volume. |
| Google Maps | **$0/mo** | ~3% of the free tier at stated volume (~65 bookings/mo). |
| GoHighLevel CRM | **[client's existing/chosen GHL plan]** | Paid directly by PSD Limo. |
| Ongoing management/support (Ally Virtual) | **`[YOU DECIDE]`/mo** | Your recurring management fee. |

### Usage-based (pass-through, not marked up)
- Payment processing: per-transaction, set by the chosen processor (e.g. Stripe).
- SMS / phone: carrier per-segment rates + A2P 10DLC registration (needs PSD Limo's
  EIN). Google Maps beyond free tier: only at ~30× current volume (~$25/mo then).

**Written commitment:** no additional charge will be incurred without PSD Limo's
prior written approval.

## 6. Payment milestones
Tied to verified deliverables (per your requested structure):
- 15% — contract signing + approved Functional Requirements Document
- 20% — approved design + booking-flow prototype
- 25% — booking system functional on staging
- 20% — CRM, automations, communications complete + tested
- 10% — maps, payment, end-to-end integration testing passed
- 10% — live launch, training, documentation, final handover

Monthly software subscriptions begin only when the relevant system is available
for practical use. **[YOU DECIDE: state any free implementation period.]**

## 7. Acceptance criteria
A phase is accepted only when demonstrated, tested, and approved **in writing** by
PSD Limo. Silence or partial use is not acceptance. Acceptance requires: all
critical/high defects resolved · all required booking + payment scenarios pass ·
mobile + desktop approved · required automations trigger correctly · all ownership
accounts + credentials delivered · training + documentation complete.

## 8. Revisions
**[YOU DECIDE:** number of design revisions and development revisions included per
phase — e.g. "up to 3 design revisions per phase."]** Additional revisions beyond
the included count follow the change-control process (§11).

## 9. Support & Service Level Agreement

> **`[YOU DECIDE]` — the SLA is a commitment you must be able to keep.** The
> framework below matches the client's requested minimum; confirm each figure you
> can genuinely honour before sending.

- **Support hours / timezone / channels:** **[YOU DECIDE]**
- **Weekend / holiday / after-hours policy:** **[YOU DECIDE]**

| Priority | Example | Initial response | Target resolution |
|---|---|---|---|
| Critical | Site down, booking/payment fully down | Within 1 hour | 4 hours or continuous work until workaround |
| High | Major booking/CRM/dispatch function down | Within 4 business hours | 1 business day |
| Medium | Partial error with workaround | 1 business day | 3 business days |
| Low | Minor / non-critical | 2 business days | By mutual agreement |

- **Uptime commitment (Ally-controlled components):** **[YOU DECIDE]** (note:
  Vercel and Neon publish their own platform uptime; commit only to what you control).
- Backups: the database provider (Neon) retains point-in-time backups; **[YOU
  DECIDE: your additional backup/export cadence]**. Procedures for payment/booking/
  downtime/CRM failures are documented at handover.

## 10. Ownership & account control
PSD Limo will own and control, under its own business email from the start:
website design, code, database structure, content, and custom features · the
GitHub repository and full source history · the Vercel project + hosting · domain,
DNS, SSL, business email · Google Cloud + Maps accounts and keys · the Neon
database account · the payment-gateway account · all customer/booking/payment/
communication/analytics data · branding, forms, workflows, and documentation.

Credentials are delivered to PSD Limo directly; nothing is held solely by Ally
Virtual with a promise to transfer later.

## 11. Data protection, change control & transition
- **Data protection:** PSD Limo owns all data; Ally uses it only to provide the
  service. Two-factor authentication on all admin accounts. Role-based,
  least-privilege access. A Data Processing Agreement available on request. Breach
  notification without undue delay. Standard data exports at no additional fee.
- **Change control:** defects and incomplete agreed deliverables are corrected at
  no charge. New features/redesign require a written quote and PSD Limo's written
  approval before work begins. PSD Limo may appoint another provider without
  unreasonable technical restriction.
- **Transition:** on termination, standard data export and account handover are
  included at no professional fee; a 30-day minimum export/transition period
  applies; cancelling CRM services does not disable the independently hosted
  website.

## 12. Assumptions, dependencies & limitations
- Google Maps / Neon / Vercel free-and-paid tiers are as published at proposal date
  (verified 2026-07-24); pricing there is set by those providers.
- SMS requires PSD Limo's EIN for A2P 10DLC registration (a US carrier requirement).
- Go-live payment processing requires PSD Limo's own processor account (e.g. Stripe
  US) so funds settle to PSD Limo directly.
- GoHighLevel platform features and limits are set by GoHighLevel.
- Some GoHighLevel assets (certain workflow internals) are not portable between
  accounts; these are documented at handover for rebuilding if the client ever
  moves CRM.
- Future-phase items in §4 are designed-for but not built under this proposal.

## 13. What is already demonstrable today
A live demonstration is available now showing: the customer booking journey,
instant distance-based quotation, add-on re-pricing, secure hosted payment, the
booking appearing automatically in the CRM (contact, opportunity, all ride
details, tags, calendar appointment), owner-editable pricing reflected in the next
quote, secure role-based admin access, and the safety behaviours (a tampered price
is ignored, a duplicate payment never double-books, an abandoned payment leaves no
record). A relevant reference/example can be provided on request.

---

*Ally Virtual · Prepared for PSD Limo · This proposal contains no obligation until
countersigned by both parties.*
