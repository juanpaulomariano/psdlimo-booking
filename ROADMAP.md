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

## STAGE A — Finish what's in flight (GHL communications)
Close out the workflow layer we already started before pivoting to the DB, so
nothing is left half-done.

- **A1** 🔨👤 Verification Gate (5 throwaway workflows prove GHL behaves). *In progress.*
- **A2** 🔨👤 Build the 12 communication workflows (owner builds from build-sheets;
  I verify data effects via API). Confirmation, reminders, dispatch notify, thank-you,
  review request, win-back, high-value alert, cancellation.
- **A3** 🔨👤 Email/SMS templates written + approved (contract §3 requires approval before launch).

*Acceptance:* a paid booking flows end-to-end and the right messages fire.

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

## STAGE E — Driver & ride management (contract Phase 4, Model 2)
The core dispatch the contract insists is "not only assisted dispatch." Built in slices.

- **E1** 🔨 **Driver + vehicle records** in DB (name, phone, vehicle, status,
  availability). Admin CRUD. Owner-driver / partner-driver flag.
- **E2** 🔨 **Assignment** — owner assigns a booking to a real driver+vehicle from
  the admin (replaces the free-text chauffeur field with a real record).
- **E3** 🔨 **Double-booking protection** — assignment blocked if driver OR vehicle
  has an overlapping trip. One query; explicitly required.
- **E4** 🔨 **Driver notification + one-tap accept/reject** — driver gets a link
  (SMS when the number is live, email meanwhile), taps Accept/Decline on their
  phone; no login. Timeout → owner alerted to reassign.
- **E5** 🔨 **Trip statuses** (owner/dispatcher-driven now): Assigned · Accepted ·
  Completed · Cancelled · No-Show, some automated. En-Route/Arrived/On-Board =
  ⏸ future (need the driver portal — named as future phase).
- **E6** 🔨 **Customer notification** when a driver is assigned/changed (via GHL).

*Acceptance:* owner assigns a driver, can't double-book, driver accepts by tapping a link, customer is told.

---

## STAGE F — Make it app-like (PWA) + driver view
- **F1** 🔨 **PWA shell** — manifest + icons + installable. Owner admin installs as
  "PSD Admin"; installable + online (no offline-first).
- **F2** 🔨 **Driver view** (`/driver`, role `driver`) — a driver logs in (Auth.js),
  sees their assigned trips, accepts/rejects, marks Completed. Installable as
  "PSD Driver". This is where accept/reject can move in-app (E4's link still works as fallback).

*Acceptance:* owner and driver can install the app to their home screen and operate it on a phone.

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
