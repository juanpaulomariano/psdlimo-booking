# AUDIT FINDINGS — PSD Limo Booking System

**Auditor's position:** I built this. Every finding below is a defect I shipped.
**Date:** 2026-07-26 · **Audited commit:** current `main` · **Method:** code read + live API inspection.

**Scope corrections to the brief (flagged, not silently absorbed):**
- The brief cites "blueprint A4 (8 invariants)" and "D6". No such document exists in this repo. The governing docs are `CLAUDE.md` (**6** invariants, line 17–22) and `ARCHITECTURE.md`, both now git-ignored but present on disk. I audited the 6 that exist rather than invent two.
- "No database" is stale — Neon Postgres was added (`lib/db.ts`). "Manual dispatch" is stale — replaced by the admin hard-block (`lib/trips.ts:assignDriverForDay`).
- **65 bookings/month is unsourced.** I could not find it in any repo document. Every volume-dependent number below is marked **ASSUMED(65/mo)** and reasoned in ranges. If the real figure differs by 3×, findings F-08 and F-11 change materially.
- **I cannot read live GHL workflow internals** (triggers, filters, email bodies). The API exposes names/status only — verified: 7 workflows, all `published`. Every workflow-behaviour claim is marked **HUMAN-VERIFY**.

---

## 1. Executive verdict

**Over-built in the customer-account layer and the dispatch schema; under-built in revenue recovery and abuse resistance. Net: right-sized on the core booking path, wrong-sized at both edges.**

The booking→payment→CRM spine is genuinely good and live-proven. But three things are true and uncomfortable: (1) a whole authentication system exists so **one** person can log in — customer accounts grant customers literally nothing (F-01, VERIFIED); (2) the system creates **zero** record of an abandoned checkout, so every customer who reaches the payment page and hesitates is invisible and unrecoverable (F-08, VERIFIED) — at ASSUMED(65/mo) and a conservative 20% abandon rate that is ~13 lost enquiries/month the owner never sees; (3) there is **no rate limiting anywhere** on endpoints that spend real money per call (F-09, VERIFIED). Meanwhile the `vehicle` table, its FK, and its index are dead code (F-02, VERIFIED).

The single worst defect is F-06: **custom-quote payment links expire 1 hour after creation** but are delivered by email. That is a shipped, revenue-destroying bug on a feature built today.

---

## 2. Findings

| ID | Lens | Finding | Evidence | Status | Severity |
|---|---|---|---|---|---|
| **F-01** | REMOVE | Customer accounts deliver **zero** customer value. `BookingWizard.tsx` has no session import — no prefill, no history, no repeat-booking. Register/login/logout + `app_user` table + public registration exist to serve one admin login. | `grep session app/components/BookingWizard.tsx` → no matches. `app/api/auth/register/route.ts` public. | VERIFIED | margin-leak |
| **F-02** | REMOVE | `vehicle` table, `trip.vehicle_id` column, its FK and `trip_vehicle_time` index are **never written or read**. Sole occurrence is a TypeScript field declaration. `assignDriverForDay` takes `{externalId, driverId}` only. | `lib/trips.ts:43` (only ref); `scripts/db-migrate.ts:168,177`; `lib/trips.ts` assign signature. | VERIFIED | cosmetic |
| **F-03** | BREAK | **Invariant 2 is dead.** `CLAUDE.md:18` states "GHL writes happen only inside the verified Xendit callback. No CRM calls from any other route, ever." Three routes now write to GHL: quote-request, admin dispatch assign, admin quote price. | `CLAUDE.md:18` vs `app/api/quote-request/route.ts`, `app/api/admin/dispatch/assign/route.ts`, `app/api/admin/quotes/price/route.ts`. | VERIFIED | margin-leak |
| **F-04** | BREAK | **JWT role never re-checked.** Role is baked in at login with a 7-day expiry. Demoting an admin in the DB leaves them fully admin until the cookie expires. No revocation path exists. | `lib/auth.ts:29` (7d), `:68` (role in token), `:126` `requireAdmin` reads token only. | VERIFIED | go-live-blocker |
| **F-05** | BREAK | Rate-card cache is **per-serverless-instance module state**. `invalidateRateCache()` clears only the instance that served the admin POST. Other warm instances serve stale rates for up to 60s. Owner raises prices, next booking may quote the old price. | `lib/rates-source.ts:28-31,85,103`; `lib/rates-admin.ts:85`. | VERIFIED | margin-leak |
| **F-06** | MONEY | **Quote payment links expire in 1 hour.** Custom quotes are delivered by *email* (WF-08). A customer opening the email next morning gets a dead link and no recovery path. Same constant serves instant checkout (where 1h is correct). | `lib/payments.ts:25` `INVOICE_DURATION_SECONDS = 60*60`, used at `:165` by both `createInvoice` callers incl. `lib/quotes.ts`. | VERIFIED | go-live-blocker |
| **F-07** | BREAK | `listConfirmedBookings` has **no WHERE and no LIMIT** — returns every trip ever, oldest first, all rendered. At ASSUMED(65/mo) the dispatch board is ~780 rows after 12 months, with completed rides from last January at the top. | `lib/trips.ts` `listConfirmedBookings` full body. | VERIFIED | margin-leak |
| **F-08** | MONEY | **Abandoned checkouts leave no trace.** `/api/checkout` creates an invoice and *no* CRM record. A customer who reaches the payment page and stops is invisible — no lead, no follow-up, no remarketing. | `grep upsertContact\|pushBooking app/api/checkout/route.ts` → no matches. `CLAUDE.md:33` documents this as intended. | VERIFIED | margin-leak |
| **F-09** | BREAK | **No rate limiting on any endpoint.** `/api/quote` calls the billed Google Routes API per request (`cache: "no-store"`, `lib/maps.ts:122`); `/api/checkout` creates real invoices. Both unauthenticated. A script can burn the Maps quota or flood Xendit. | `grep -r "rateLimit\|throttle" app/ lib/` → zero matches. | VERIFIED | go-live-blocker |
| **F-10** | SIMPLIFY | `listQuoteLeads` is N+1: **3 GHL API calls per lead** (field read, opportunity read, contact read) inside the loop, on a page load. 10 pending quotes = 31 sequential calls. | `lib/ghl.ts` `listQuoteLeads` — 3 `await ghlFetch` inside the `for` loop. | VERIFIED | margin-leak |
| **F-11** | BREAK | Dispatch rule is **one driver = one trip per LA day**, enforced hard. At ASSUMED(65/mo) ≈ 2.2 bookings/day against a 2-driver seeded roster, the owner will hit refusals on ordinary days and have no override. | `lib/trips.ts` `assignDriverForDay` atomic guard; `scripts/db-seed.ts` 2 drivers. | VERIFIED | margin-leak |
| **F-12** | GO-LIVE | Charging currency is **PHP** with a hardcoded FX env var. Production must settle USD to a US account. The conversion path (`toChargeAmount`) is exercised; the USD path is **never tested** in any suite. | `lib/payments.ts:87,105-117`; `.env.local XENDIT_CURRENCY=PHP`. | VERIFIED | go-live-blocker |
| **F-13** | DEMO | `/success` is fire-and-forget: it renders the reference from the URL and confirms nothing. If the webhook is slow or fails, the customer sees "Your ride is confirmed" while **nothing exists in GHL**. | `app/success/page.tsx:5` (documented intent), reads `searchParams` only. | VERIFIED | demo-blocker |
| **F-14** | GO-LIVE | Home page footer reads **"Demonstration build · Test payments only"** and the Xendit link is `checkout-staging.xendit.co`. Both ship to whatever URL you show the client. | `app/page.tsx` footer literal; observed invoice URLs this session. | VERIFIED | cosmetic |
| **F-15** | BREAK | Round-trip creates **one** appointment (outbound). WF-02 fires off appointments, so the **return leg never gets a 24h reminder**. A customer is reminded for the outbound and silently not for the return. | `lib/ghl.ts` `ensureAppointment` — single call; `return_datetime` carried in metadata only. | VERIFIED | margin-leak |

---

## 3. Top recommendations (ranked by impact ÷ effort)

### R-1 · Fix quote-link expiry (F-06)
Split the constant: instant checkout keeps 1h, quote invoices get 7 days.
- **EFFORT:** 0.5h · **WHO PAYS:** nobody (one parameter) · **EARNS:** prevents dead links on *every* emailed custom quote. Custom quotes are the highest-value bookings ($1,500 in test vs ~$200 standard) — one recovered quote/month ≈ **$1,500/mo**. · **RISK:** a longer-lived invoice can be paid after the owner mentally cancelled it; mitigate by letting the owner re-price (which issues a new invoice).
- **Do this before the demo.** It is a live bug on a feature you will demo.

### R-2 · Rate-limit `/api/quote` and `/api/checkout` (F-09)
Per-IP cap (e.g. 30 quotes/min, 5 checkouts/min).
- **EFFORT:** 2h · **WHO PAYS:** our maintenance (small) · **EARNS:** caps the blast radius on a **billed** Google Maps key and prevents invoice flooding. Google Maps is currently ~3% of free tier (`COSTS.md`); one scripted loop moves that to a real bill. · **RISK:** a too-tight limit blocks a legitimate customer editing addresses rapidly — the UI already debounces 400ms (`BookingWizard.tsx:48`), so 30/min is generous.

### R-3 · Capture the abandoned checkout (F-08)
On `/api/checkout` success, create a GHL lead in `New Inquiry` tagged `lead.abandoned`; the paid webhook promotes it (the promote path **already exists** — built today for quotes, `lib/ghl.ts` promote branch).
- **EFFORT:** 3h · **WHO PAYS:** our maintenance; owner gains a follow-up queue · **EARNS:** at ASSUMED(65/mo) and 20% abandonment ≈ **13 recoverable enquiries/month**. At a ~$200 average booking, recovering 2 = **$400/mo**. · **RISK:** pollutes New Inquiry with tyre-kickers; mitigate with the `lead.abandoned` tag so the owner can filter. **This directly contradicts `CLAUDE.md:33`** ("abandoned invoices are not errors… don't fix it") — I am arguing against that decision. It was correct when there was no CRM-lead concept; it is now leaving money on the floor.

### R-4 · Delete customer accounts, keep admin login (F-01)
Remove public registration; keep `app_user` + login for admins only.
- **EFFORT:** 2h · **WHO PAYS:** nobody · **EARNS:** removes a public write endpoint, an unbounded user table, and a support surface ("I can't log in") that returns **zero** customer value today. · **RISK:** if the client wants customer portals later this is rework — but building the wrong thing now and maintaining it on retainer is worse. **Ask the client first** (Q-2).

### R-5 · Scope the dispatch board (F-07)
`WHERE pickup_at > now() - 7 days` + `LIMIT 200`.
- **EFFORT:** 0.5h · **WHO PAYS:** nobody · **EARNS:** keeps the board usable at month 6 instead of ~400 rows of history above today's work. · **RISK:** none material; a past-bookings view can be added if asked.

### R-6 · Re-check role from DB in `requireAdmin` (F-04)
One indexed lookup per admin request.
- **EFFORT:** 1h · **WHO PAYS:** ~10ms/admin request · **EARNS:** makes revocation immediate. Named failure: owner fires a dispatcher, dispatcher retains full pricing/dispatch access for up to 7 days. · **RISK:** admin pages fail if the DB is down — acceptable (they are DB-backed anyway).

### R-7 · Return-leg reminder (F-15)
Create a second appointment for `return_datetime`.
- **EFFORT:** 2h · **WHO PAYS:** our maintenance · **EARNS:** prevents a named, concrete failure: **a customer stranded because nobody reminded them of the return pickup.** That is the complaint that costs a client relationship, not a booking. · **RISK:** two appointments per round trip could double-fire WF-05/06 — **HUMAN-VERIFY** WF-05's trigger before building, or gate the second appointment out of the completion workflow.

### R-8 · Batch `listQuoteLeads` (F-10)
Drop the per-lead field pre-check; fetch contacts once.
- **EFFORT:** 1.5h · **WHO PAYS:** nobody · **EARNS:** admin Quotes page stops making ~31 sequential API calls; removes a plausible GHL rate-limit ticket. · **RISK:** low.

### R-9 · Reconcile or delete Invariant 2 (F-03)
Rewrite `CLAUDE.md:18` to "**paid-booking** CRM writes happen only in the verified callback; lead/admin writes are explicitly permitted."
- **EFFORT:** 0.25h · **WHO PAYS:** nobody · **EARNS:** the invariant list is the handover contract. A rule the code openly violates trains the next developer to ignore all six. · **RISK:** none.

### R-10 · Drop the dead vehicle schema (F-02)
Remove `vehicle` table, `trip.vehicle_id`, FK, index, seed rows.
- **EFFORT:** 1h · **WHO PAYS:** nobody · **EARNS:** removes a table the next developer will assume is load-bearing. · **RISK:** if vehicle-level dispatch is genuinely coming, this is churn — **Q-3**. Cheaper to re-add than to maintain a lie.

---

## 4. DO-NOT-DO (evaluated and rejected)

| Rejected | Reason |
|---|---|
| Build the driver portal now | Three features (auth role, scoped access, status write-back) on a dispatch flow that is one day old. Correctly deferred. |
| Auto-price complex trips | The reason quotes are manual is that a wrong auto-quote on a multi-stop job loses real money. Contract Phase 2 mandates manual. |
| Travel-time buffer between rides | The one-trip-per-day rule already over-covers it. Adding drive-time modelling solves a problem the stricter rule prevents. |
| Zone pricing | Client has not defined how they price by area; three incompatible models exist. Building any one is a coin flip. |
| Replace hosted payment page with embedded fields | Hosted page keeps card data entirely off our infrastructure. Embedded fields add PCI scope for cosmetic gain. **Sacred cow re-justified: keep.** |
| Add n8n | Every integration is 1:1 HTTP. n8n adds a subscription, a failure point, and a second place to debug. **Sacred cow re-justified: keep it out.** |
| Make `/success` verify payment server-side | Tempting (F-13) but wrong: a URL the customer can edit must never be evidence, and polling the CRM from a public page leaks booking existence. Fix the *copy*, not the architecture — see QW-2. |
| Retry queue for failed GHL writes | Xendit's retry + manual resend already covers it, and idempotency makes resend safe. A queue is infrastructure to maintain for an event that has not happened. |

---

## 5. Pre-demo quick wins (≤1h each, demo-risk only)

| ID | Action | Why | Time |
|---|---|---|---|
| **QW-1** | Change quote invoice duration to 7 days (R-1) | Highest-probability live embarrassment: you demo a quote, the link is dead. | 0.5h |
| **QW-2** | Soften `/success` copy: "Payment received — your confirmation is on its way" instead of "Your ride is confirmed" | If the webhook lags, the current wording is a claim the CRM cannot back (F-13). Copy change only, no architecture. | 0.25h |
| **QW-3** | Remove "Demonstration build · Test payments only" from the footer (F-14) | Reads as unfinished to management. | 0.1h |
| **QW-4** | Seed 3–4 drivers, not 2 (F-11) | With 2 drivers a same-day demo booking hits the block on the *second* assignment and looks broken rather than protective. | 0.25h |
| **QW-5** | Run `npm run seed:bookings` then verify the Quotes tab loads under 3s | F-10's N+1 on a cold GHL connection is the most likely "why is it spinning" moment. | 0.5h |

**Top 5 demo risks, ranked probability × embarrassment:**
1. **Dead quote payment link** (F-06) — near-certain if any time passes between pricing and paying. Fix = QW-1.
2. **"Your ride is confirmed" with nothing in GHL** (F-13) — moderate probability, high embarrassment. Fix = QW-2.
3. **Quotes tab slow/spinning** (F-10) — moderate.
4. **Dispatch block fires on a legitimate second booking** (F-11) — moderate; reads as a bug unless you narrate it as the feature.
5. **Footer says "Demonstration build"** (F-14) — certain, low.

---

## 6. Questions only you can answer

1. **Is 65 bookings/month real?** F-07, F-08, F-11 and every dollar figure above rest on it. If it is 200/mo, F-11 (one-trip-per-day) becomes a **go-live-blocker**, not a margin leak.
2. **Does the client want customer accounts?** (R-4) They currently do nothing. Delete, or is a customer portal contracted for a later phase?
3. **Is vehicle-level dispatch coming?** (R-10) If yes within 3 months, leave the dead schema. If not, delete it.
4. **How many drivers will PSD Limo actually have?** Two makes the per-day rule near-unworkable; six makes it comfortable.
5. **HUMAN-VERIFY — WF-05's trigger:** does it fire on *appointment ended* or *stage → Completed*? R-7 (return-leg appointment) is safe under the stage trigger and double-fires under the appointment trigger. I cannot read this via API.
6. **HUMAN-VERIFY — WF-01 / WF-01b filters:** are they genuinely mutually exclusive (`None of` vs `Any of` on `ride.custom`)? If both fire, every custom booking sends two contradictory confirmations.
7. **HUMAN-VERIFY — do any published workflows have re-entry ON?** WF-02 is tag-guarded and safe; WF-01/04/08 are not. Re-entry ON means duplicate customer emails.
8. **Will the production processor be Xendit or a US processor?** F-12: the USD path has never executed. If USD, budget a full re-test of the payment leg — the currency branch is untested code.
