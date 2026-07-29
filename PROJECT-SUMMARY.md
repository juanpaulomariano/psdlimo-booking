# PSD Limo — Booking, Payment & Dispatch Platform
### Full project summary (for résumé / portfolio use)

---

## One-line description

A production-grade booking, payment, dispatch and CRM-automation platform for a
San Francisco chauffeur company — built solo, end to end, from live-priced
booking through online payment, driver assignment, and automated customer
communication.

---

## Scale (verified, not estimated)

| Metric | Value |
|---|---|
| Lines of TypeScript / TSX | ~11,200 (excl. dependencies) |
| API routes | 15 |
| Git commits | 80 |
| Automated test checks | 79 (44 pricing · 18 payments · 17 dispatch) |
| CRM workflows configured | 7 |
| Deployed | Live on Vercel, verified end-to-end |

---

## The problem

A limousine operator was running bookings manually: phone and email enquiries,
prices quoted by hand, bookings tracked in a spreadsheet, drivers assigned from
memory. The failure modes were expensive — mispriced trips, double-booked
drivers, and enquiries lost between channels.

The brief (a formal contract-requirements document) demanded a single system
covering the full lifecycle: *"from the first customer inquiry through payment,
driver assignment, trip completion and post-service follow-up."*

---

## What I built

### 1. Live-priced booking engine
A multi-step booking flow that prices rides in real time from actual driving
distance (Google Routes API) and returns a full itemised breakdown.

- Four booking types: point-to-point, hourly, fixed-route, and **round-trip**
  (with a configurable return-leg discount)
- Pricing implemented as a **pure function** — no I/O — making it unit-testable
  and guaranteeing the displayed quote and the charged amount can never diverge,
  since both routes call the same engine
- Google Places autocomplete for addresses; live route map

### 2. Payment → CRM automation
Payment through a hosted provider page, with a verified server-to-server callback
as the only path that creates a booking.

- The booking payload travels in invoice metadata and is schema-validated on the
  way back out
- One verified callback creates the CRM contact, the opportunity, the calendar
  appointment, and applies all classification tags
- **Idempotent**: a re-sent or duplicated payment notification never creates a
  second booking

### 3. Dispatch with hard double-booking prevention
The operator assigns drivers in a purpose-built admin. The rule — **one driver,
one trip per calendar day** — is enforced in a single atomic SQL statement whose
`WHERE` clause excludes any conflicting same-day trip, so the check and the write
cannot race.

An assignment that would double-book is **refused**, not merely flagged, and the
UI names the conflicting booking. Assignments sync one-way to the CRM so the
owner still sees everything in their existing cockpit.

### 4. Owner self-service (no developer required)
- **Rates**: base fare, per-mile, per-hour, service fee, minimums, vehicle
  multipliers — all editable in the admin, live on the next quote
- **Add-ons**: the owner *creates and retires* them; a new add-on appears on the
  public booking form with no deployment
- **Drivers**: full roster management with soft-retire (history preserved)

Achieved by moving the product catalogue out of compiled code into the database
and making the rate card the single source of truth for the site, the pricing
engine, and validation.

### 5. Custom-quote pipeline for complex trips
Not every trip fits a form (a wedding with four stops, flexible timing, multiple
vehicles). Contract requirement: *"instant quotation where rules allow, and
manual quotation requests for complex bookings."*

- Customer describes the trip → becomes a CRM lead
- Owner prices it in the admin, setting an **anchor** (amount + one primary
  date/time) while the full itinerary stays free text — deliberately *not*
  forcing a flexible trip into rigid fields
- Customer receives a payment link; paying **promotes the existing lead** to a
  confirmed booking rather than creating a duplicate

### 6. Abandoned-checkout recovery
A customer who reaches the payment page and doesn't finish previously vanished.
Now they become a tagged lead the owner can follow up — and if they return and
pay, the same record is promoted and the "abandoned" tag self-clears.

### 7. CRM automation (7 workflows)
Booking confirmation (with a separate variant for custom trips), 24-hour
pre-trip reminder, ride-completion, review request, quote acknowledgement, and
payment-link delivery.

---

## Engineering decisions worth defending

**Pricing is never trusted from the browser.** The checkout request schema has no
`total` field at all — there is nowhere to put a client-supplied price. The server
recomputes from raw ride details. Verified live by editing the displayed price in
DevTools and confirming the real amount was charged.

**Payment callbacks are authenticated before the body is read.** Constant-time
token comparison; a forged notification is rejected without its payload ever being
parsed.

**Failure modes chosen deliberately, not by default.** Each HTTP status is a
decision: 401 for a bad token (don't retry), 200 for a non-actionable event
(stop retrying), 500 for a CRM outage (*do* retry — the payment succeeded and
must not be lost), 400 for malformed data (retrying cannot help).

**Resilience without fragility.** Pricing reads rates through a three-level
fallback — database → last-known-good → code defaults — so a database outage
degrades to slightly stale prices rather than a broken quote.

**Timezone correctness as an invariant.** The business operates in
America/Los_Angeles while the servers run in UTC and I develop in UTC+8. Every
datetime carries an explicit offset; the double-booking rule computes the LA
calendar day in SQL, so a 9 PM pickup is never counted as the following day.

**Non-fatal by design where it matters.** Writing the dispatch record and syncing
to the CRM are isolated in their own error boundaries: a hiccup there can never
fail a booking the customer has already paid for.

---

## Self-audit (the part I'm most pleased with)

After the build, I audited my own system against explicit lenses — *remove,
simplify, break, revenue leakage, demo risk, production gaps* — and documented 15
findings with file-level evidence, each marked **verified** (read the code, ran
the test) or **assumed** (platform behaviour never proven).

The audit attacked my own earlier decisions rather than defending them, and
several findings were real defects I had shipped:

- Custom-quote payment links expired in **1 hour** but were delivered by *email* —
  killing every emailed quote on the highest-value bookings
- A success page asserting *"your ride is confirmed"* when it could only know that
  *payment* succeeded — a lie in exactly the case that mattered
- Unbounded queries and zero rate limiting on endpoints that spend real money per
  request (a billed Maps API and live invoice creation)
- Admin role read from a 7-day token and never re-checked, so revoking access
  took up to a week to take effect
- Dead database schema that nothing read or wrote

All were fixed and verified live. Where a mitigation was imperfect — the rate
limiter is per-instance on serverless and therefore approximate — I **documented
the limitation in the code** with its upgrade path rather than claiming
protection I could not prove.

---

## Security posture (attack-tested, results verified)

| Attack | Result |
|---|---|
| Price tampering via browser dev tools | Real price charged; client total is structurally unrepresentable |
| Forged payment notification | 401 — rejected before the payload is read |
| Unauthorised admin access (pages + APIs) | 403 on every action; pages redirect |
| Brute-force login (14 attempts) | 10 rejected, then rate-limited |
| SQL injection (`' OR 1=1 --`, `DROP TABLE`) | 400 at validation; database intact |

Additionally: card data never touches the application (hosted payment page — no
card-handling code exists), passwords stored as bcrypt hashes at cost 12, sessions
in httpOnly + Secure + SameSite cookies, admin role re-verified from the database
on every privileged request, and all SQL parameterised.

---

## Stack

**Next.js (App Router) · TypeScript (strict) · React · Tailwind · Vercel ·
Neon Postgres · Zod · Google Routes & Places APIs · Hosted payment provider ·
GoHighLevel CRM API · bcrypt + JWT (jose)**

---

## Suggested résumé bullets

> **Chauffeur Booking & Dispatch Platform** — designed and built a full-stack
> booking, payment and dispatch system (Next.js, TypeScript, Postgres) handling
> live distance-based pricing, online payment, CRM automation and driver
> assignment; ~11k lines, 15 API routes, 79 automated checks, deployed and
> verified end-to-end.

> Engineered **atomic double-booking prevention** in SQL, making it impossible to
> assign a driver to two trips on the same day — the check and write occur in one
> statement, eliminating the race condition a read-then-write would introduce.

> Built an **idempotent payment-to-CRM pipeline** where a re-sent or duplicated
> payment notification can never create a second booking, and a CRM outage
> triggers provider retries rather than silently losing a paid booking.

> Made pricing **owner-editable without deployment** by moving the product
> catalogue from compiled constants into the database, with a three-level
> fallback (database → last-known-good → defaults) so quoting never breaks.

> Conducted a **structured self-audit** of my own system, documenting 15 findings
> with file-level evidence and explicit verified/assumed labelling; fixed a
> revenue-losing payment-link expiry bug, a false booking confirmation, and
> missing rate limiting on billed endpoints.

> **Attack-tested** the deployed system — price tampering, forged payment
> callbacks, brute-force login, SQL injection, unauthorised admin access — and
> documented residual limitations honestly rather than overstating protection.
