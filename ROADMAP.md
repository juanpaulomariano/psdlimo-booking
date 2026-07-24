# PSD LIMO — REVISED ROADMAP

The complete build plan after absorbing the client's July 2026 contract
requirements. Focus: **website + CRM booking/dispatch system.** AI assistant and
extra lead channels are deferred (named as future phases in the proposal).

Built the same way as everything so far: **thin, shippable, tested slices.** After
every slice: `npm run build` + tests green, live-verified, committed. If a slice
surprises us, we stop and reassess before it becomes a mess — we are never more
than one small step from a working system.

Legend: ✅ done · 🔨 to build · ⏸ deferred/future-phase · 👤 owner action

---

## Where we are today (✅ already built & live-verified)
Booking wizard (one-way, hourly, flat) · Google Routes distance+duration · live
rules-based pricing engine (pure function) · Places autocomplete · Xendit hosted
payment (test) · verified webhook · GHL contact+opportunity+18 fields+tags ·
calendar appointments with retry-safety · idempotency · route map · Vercel deploy.
**~70% of the contract's Phase 1-5 technical scope already exists.**

---

## The architecture after this roadmap
```
WEBSITE  (Next.js on Vercel Pro  +  Neon database, both PSD-owned, $0 DB cost)
  Customer:  booking (one-way/round-trip/hourly/airport/quote-request), payment
  Owner:     admin PWA — rates/zones/fees, drivers/vehicles, dispatch, reporting
  Driver:    driver PWA — my trips, accept/reject, status updates
  Bridge:    /api/xendit-webhook  → GHL   (unchanged)

GOHIGHLEVEL  (existing subscription)
  Contacts · sales pipeline · the 12 communication workflows · reviews · win-back
  (NOT pricing, NOT dispatch logic — those live in the website+DB)
```
**Guardrails from the capability audit (non-negotiable):**
- Auth via **Auth.js library**, never hand-rolled. Roles start simple (owner, driver).
- PWA = **installable + online**. NOT offline-first (that's the rabbit hole we skip).
- Dispatch = **Model 2**: driver records + owner assigns + notify + one-tap
  accept/reject. NOT a full real-time portal (the ambitious trap we avoid).

---

## ⚠️ SEQUENCING REVERSED (2026-07-24, per ARCHITECTURE-AUDIT.md)
The GHL workflows (old Stage A) now come AFTER the database + dispatch, NOT next.
Reason: several workflows are tied to GHL-native dispatch (drag card → Assigned),
which moves to the DB. Building them before GHL's reduced role is settled = building
some twice. New order: **B (DB) → webhook rewrite → E (dispatch) → then GHL finalize +
workflows.** The old "Stage A" is now **Stage A′** below, moved to the end of the CRM work.

---

## STAGE A′ (MOVED TO AFTER DISPATCH) — GHL finalize + communications
Build ONCE, against the final GHL field/stage shape the DB+dispatch settle.

- **A′0** 🔨👤 Surgical GHL edit (D-10): drop dead fields (D-2), simplify stages to
  message-milestones (D-5: New Inquiry/Quoted/Confirmed/Completed/Cancelled), add
  service.roundtrip. `ghl:ids` re-verifies.
- **A′1** 🔨👤 Verification Gate (5 throwaway workflows prove GHL behaves).
- **A′2** 🔨👤 Build the communication workflows against the final shape. Dispatch-tied
  ones (assignment notify, chauffeur-assigned) trigger off a DB→GHL push (D-9), not a
  card drag. Communication workflows (confirm/remind/thank-you/review/win-back) unaffected.
- **A′3** 🔨👤 Email/SMS templates written + approved (contract §3).

*Acceptance:* a paid booking flows end-to-end and the right messages fire, driven by
the DB, not by GHL-native dispatch.

---

## STAGE B — The database backbone (the foundation everything else needs)
Thin slices. Each is independently shippable; the booking system keeps working
throughout because we ADD beneath it, never replace.

- **B1** 🔨👤 Provision **Neon** DB under PSD's business email; connection string into
  Vercel env. (I write the setup sheet.) *Start on the **Free** plan for the demo;
  flip to **Launch** at production — an in-place plan toggle in the Neon console, same
  DB + connection string, no migration, no code change.* *Verify: site reads a test query.*
- **B2** 🔨 Move rates from `config/rates.ts` into a DB table; pricing engine reads
  from DB at quote time with **last-good fallback** (a DB blip never breaks quoting).
  *This is the ONLY change to existing pricing — behaviour identical, source moves.*
- **B3** 🔨 **Zones** table + zone-aware pricing (contract wants zone-based rates).
  Engine extended; flat + per-mile still supported. Tests pin every rule.

*Acceptance:* quotes still correct and live; rates now come from the DB.

---

## STAGE C — Owner admin (the "PSD Limo can adjust rates/fees" requirement)
- **C1** 🔨 **Auth.js** set up. One role to start: `owner`. 2FA-capable (contract §7).
- **C2** 🔨 `/admin/rates` — edit base/per-mile/per-hour/multipliers/add-ons/fees/
  zones through validated forms. Bad input can't break pricing (validation + fallback).
- **C3** 🔨 `/admin/settings` — the other owner-editable knobs (lead time, min fare,
  service areas, cancellation window). Everything the contract says they can change.

*Acceptance:* owner changes a rate in the admin, next quote reflects it. No developer, no redeploy.

---

## STAGE D — Booking completeness (the missing types + quote path)
- **D1** 🔨 **Round-trip** booking (the one missing type; contract lists it 4×).
  Pricing model: return leg + optional return-discount rule (owner-editable). Own
  appointment(s). Tests pin it.
- **D2** 🔨 **Manual "Request a Quote"** path for complex trips — creates a lead in
  GHL `New Inquiry`/`Quoted`, no forced payment. "Instant where rules allow, manual
  where not" (contract Phase 2).
- **D3** 🔨 Legal/customer pages: privacy, terms, cancellation policy (contractual,
  not marketing). SEO/schema/Analytics/Search Console (contract Phase 2, small).

*Acceptance:* all booking types work; complex trips route to a manual quote.

---

## STAGE E — Driver & ride management (GHL-central, DB silent — see AUDIT-2 §G)
CORRECTED 2026-07-24: the owner's cockpit is GHL, not a website dashboard. The DB
works SILENTLY. No owner-facing dispatch UI on the website.

- **E1** 🔨 **Driver + vehicle records.** Owner manages these where they assign —
  in GHL (a drivers list / custom field). The DB keeps a mirror ONLY so it can run
  the clash check. No website driver-admin screen.
- **E2** 🔨 **Assignment happens IN GHL** (dropdown/drag). Not on the website.
- **E3** 🔨 **Silent double-booking check.** On assignment, GHL fires a webhook →
  website queries the DB for a driver/vehicle time clash across all trips → **if
  clash, EMAIL the owner** (via GHL). Warning-after, not a hard block (GHL can't be
  prevented from assigning) — the honest trade for GHL-central assignment.
- **E4** 🔨 **Trips stored silently in the DB** (for the clash query + reporting).
  Never shown to the owner on the website — GHL is the trips view. Removes the
  "two dashboards / redundant" problem.
- **E5** 🔨 **Trip statuses + customer/driver notifications** live in GHL workflows
  (Stage A′). Accept/reject and En-Route/Arrived/On-Board = ⏸ future (would need a
  driver view — named as future phase).

*Acceptance:* owner assigns a driver IN GHL; if it clashes, an email lands; trips
are queryable in the DB for reporting; the owner never touches a website dashboard.

---

## STAGE F — ⏸ DEFERRED / RECONSIDERED (PWA + driver view)
CORRECTED 2026-07-24: with the owner's cockpit in GHL and no website operational
dashboard, the ONLY owner-facing website screen is the rates/settings admin — which
CAN be made installable (PWA) if wanted, but there is no big dashboard to appify.
A DRIVER view/portal is explicitly a future phase (accept/reject in-app needs it).
For now: no driver PWA. The rates admin can optionally be a PWA later; not core.

~~Old F1/F2 (driver PWA):~~ deferred.
- **F1 (optional, later)** 🔨 Make the rates/settings admin installable as a PWA.
- **F2** ⏸ Driver view/portal — future phase (with accept/reject + live statuses).

*Acceptance (revised):* the rates/settings admin optionally installs to the home
screen; there is no driver PWA in this scope (driver portal is a future phase).

---

## STAGE G — Reporting + data protection (contract §7)
- **G1** 🔨 **Reporting** — inquiries, quotes, bookings, conversion, revenue,
  abandoned bookings, source. Simple counts/sums first; charts if useful.
- **G2** 🔨 **Data export** — CRM + DB records exportable (contract §7, monthly).
- **G3** 🔨 **Role-based access** rounded out (dispatcher, customer-service if wanted);
  least-privilege; 2FA confirmed on all admin accounts.

*Acceptance:* owner sees their numbers and can export their data unaided.

---

## STAGE H — Payment ownership swap
- **H1** 🔨👤 Swap Xendit → **PSD-owned US processor (Stripe US)** — funds settle to
  PSD's account, USD-native, the PHP conversion vanishes. **One file (`lib/payments.ts`)**
  by design. Needs PSD's Stripe account (their business email).

*Acceptance:* a real (or Stripe-test) payment settles to PSD's own processor.

---

## STAGE I — Hardening, cleanup, de-trace, handover (the final pass)
Per HANDOVER-PREP.md. Nothing functional changes.
- **I1** 🔨 Code cleanup (test-guarded). **I2** 🔨 Security hardening (rate limits,
  headers, input caps, `npm audit`, `/security-review`, rotate Google key, 2FA).
- **I3** 🔨 Staging environment formalized; 20+ scenario end-to-end test pass
  (contract Phase 5). **I4** 🔨 Docs: admin/ops guide, training material.
- **I5** 🔨 **De-trace**: strip Co-Authored-By from all commits (backup branch,
  force-push, verified safe — metadata only); remove meta-docs from repo (keep local).
- **I6** 👤 Visual review of the whole UI by a human.

*Acceptance:* clean repo, all critical/high defects resolved, credentials handed over.

---

## Deferred (⏸ named as future phases in the proposal — NOT now)
AI assistant (GHL Conversation AI) · extra lead channels (chat/social ingestion) ·
full driver portal with real-time En-Route/Arrived/On-Board · offline-first PWA ·
native app · commission/payout reporting · driver document-expiry alerts ·
feeder-company ingestion.

---

## Ownership provisioning (contract §3 — do as we go, not at the end)
Every account under **PSD Limo's business email from the start**: GitHub · Vercel ·
Google Cloud · GoHighLevel · **Neon** · domain/DNS/SSL · Stripe. Where something is
currently under a personal/Ally account, transfer or recreate under PSD's email as
part of the relevant stage — never "promise to transfer later" (the contract
explicitly forbids that).

## Cost summary (for the proposal — all verified against source, no placeholders)
- **Neon DB (Launch plan): ~$0–$1/mo** at current volume. No fixed fee; usage-metered
  (compute $0.106/CU-hr, storage $0.35/GB-mo); invoices under $0.50 not collected;
  scale-to-zero. Under $1/mo at 10× growth, a few $/mo at 100×. (Free tier exists but
  SUSPENDS the DB on hitting a limit — unsafe for a live booking business, so Launch.)
- **Google Maps: $0** (≈3% of the free tier).
- **Vercel Pro: ~$20/mo** (Hobby is non-commercial by licence; the only fixed infra cost).
- **GoHighLevel:** existing subscription. **Stripe:** per-transaction. **SMS/A2P:** at
  go-live (needs client EIN).
- **The entire DB + dispatch + admin + reporting backbone adds ~$0–$1/mo** — not a
  meaningful cost. Honest line for the client, NOT "$0 forever".
