# ARCHITECTURE AUDIT — SECOND PASS (double-audit)

> ⚠️ SUPERSEDED as the current spec by **ARCHITECTURE.md** (single source of truth).
> Its conclusions (GHL-central model, auth timing, double-booking flag,
> cancellation popup) are folded into that file; kept for the reasoning and
> decision log. Where it disagrees, ARCHITECTURE.md wins.

Requested re-audit after two new requirements landed:
1. **Role-aware UI:** logged-in admins see an "Admin Dashboard" button at the top
   of the site — no typing `/admin`. Regular users don't see it. Same site.
2. **Demo strip:** for the demo, only the **booking system + login/register at the
   top**. No homepage, no marketing sections. The booking page IS the demo site.

Plus three answers that shape it:
- **Guests can still book** — login optional; booking flow UNCHANGED.
- **One pre-seeded admin account** — everyone else who registers is a regular user.
- **The booking page is the whole demo site** — top bar adds login + (admins) the
  dashboard button.

This pass RE-CHECKS the first audit's conclusions against these, and states what
moves. Ground truth pulled live: 4 pages (page/success/cancelled/layout), no auth
anywhere yet, layout body is where a top bar goes. Neon CLI (neonctl) IS available
but needs interactive auth — web-console + paste connection string is the path.

---

## A. WHAT THE NEW REQUIREMENTS CHANGE vs the first audit

### A1. Auth arrives EARLIER and SMALLER than the roadmap had it
- First audit put Auth.js in Stage C (owner admin), after the whole DB + dispatch.
- **New reality: the DEMO needs auth NOW** — you can't show "admin sees a dashboard
  button, user doesn't" without login working. So a MINIMAL auth (register/login +
  one role flag + one pre-seeded admin) moves to the FRONT, right after the DB
  exists to store users.
- But it stays SMALL: two roles (user, admin), no dispatcher/CS yet, no 2FA yet
  (that's a production hardening item, not a demo item). The library (Auth.js) still
  does the scary parts.

### A2. The "admin button" changes the UI shell, not the security model
- Security is STILL server-side: the dashboard's data and pages are protected by
  the session role on the server. The button is just UX — it renders when
  `session.role === "admin"`.
- IMPORTANT (correctness): a hidden button is NOT security. `/admin` (or wherever the
  dashboard lives) must be guarded on the SERVER by the role, so a regular user who
  guesses the URL is still blocked. The button removes the NEED to know the URL; the
  server guard is what actually protects it. Both exist.

### A3. Booking flow: UNCHANGED (guests still book)
- This is the reassuring part. Because guests can still book without an account, the
  entire existing booking → payment → webhook → GHL flow is UNTOUCHED. Auth sits
  BESIDE it (a top bar), not IN FRONT of it. Lowest-risk possible integration.

### A4. Demo page structure: a top bar + the existing booking page
- No new marketing pages. `app/layout.tsx` gets a top bar (brand left, auth control
  right). `app/page.tsx` (booking) stays the main content.
- New pages needed for the demo: `/login`, `/register` (or a modal), and the admin
  dashboard route (guarded). That's it.

---

## B. DOES THE FIRST AUDIT STILL HOLD? (double-check each conclusion)

| First-audit conclusion | Still valid? | Note |
|---|---|---|
| DB-first, one-way DB→GHL | **YES** | Unaffected by auth/demo-strip. |
| Build DB before the 12 workflows | **YES** | Still correct; the demo-strip makes it MORE true (workflows are even further off). |
| Simplify GHL stages (5B) | **YES** | Unaffected. |
| Surgical GHL edit, later | **YES** | Unaffected. |
| GHL field drops (D-2) | **YES** | Unaffected. |
| Auth in Stage C | **CHANGED** | Auth moves EARLIER (minimal version) for the demo. Full role-based access still finalizes later. |

**Verdict: the first audit's architecture decisions all stand. The only change is
TIMING — a minimal auth slice jumps forward to enable the demo.** Nothing is
contradicted; one thing is resequenced.

---

## C. NEW DECISIONS THIS PASS SURFACES

- **DD-1 — Users table + auth needs the DB.** Auth.js stores users somewhere. That's
  the SAME Neon DB we're adding for rates. So the DB genuinely comes first — it now
  serves BOTH rates AND users. Good — one foundation, two uses.
- **DD-2 — Login/register: dedicated pages or a modal?** A modal on the booking page
  is slicker for a single-page demo; dedicated `/login` `/register` pages are simpler
  to build and more standard. (Leaning: simple pages for the demo; modal is polish.)
- **DD-3 — Where does the admin dashboard live for the demo?** It can be near-empty
  for now — a placeholder page proving the ROLE GATE works ("You're an admin, here's
  where rates/drivers/reporting will go"), OR we start it with the rates admin (the
  first real feature). Leaning: start it WITH the rates admin, so the button leads
  somewhere real, not a stub.
- **DD-4 — Session storage.** Auth.js supports JWT (stateless, no DB reads per
  request) or database sessions. For a demo, JWT is simplest and fine. (Leaning JWT.)
- **DD-5 — Does the customer's booking get linked to their account if logged in?**
  Guests book anonymously; a logged-in customer COULD have the booking attached to
  their user. For the DEMO this is optional polish — leaning: not now, keep booking
  identical for everyone; attach-to-account is a later convenience.

---

## D. RESHAPED NEAR-TERM SEQUENCE (the concrete change)

The roadmap's Stage B (DB) is still first, but it now carries the auth + admin-button
demo scope folded in, because that's what you want to SEE next. Reordered demo path:

1. **B1 — Provision Neon** (Free, demo). You: web console + paste connection string
   (or `neonctl auth`). Me: everything after.
2. **B2 — DB client + first table + rates moved to DB** with last-good fallback.
   (Booking keeps working; source of numbers moves.) 
3. **NEW B2.5 — Users table + Auth.js (minimal)**: register/login, `role` field,
   ONE pre-seeded admin. JWT sessions.
4. **NEW B2.6 — Top-bar UI**: brand + auth control on `app/layout.tsx`. Logged-out →
   Login/Register. Logged-in → account menu. Admin → PLUS an "Admin Dashboard" button.
5. **NEW B2.7 — Guarded admin dashboard route**: server-role-checked. Starts with the
   rates admin (DD-3) so the button leads somewhere real.
6. Then continue the roadmap: zones, round-trip, dispatch, then GHL finalize+workflows.

**This gives you a demoable thing FAST:** register a normal user (no button), log in
as the seeded admin (button appears → dashboard → edit a rate → next quote reflects
it). That's a complete, impressive demo slice — and it's the natural first use of the
DB anyway.

---

## E. WHAT STILL DOES NOT CHANGE (reassurance, re-confirmed)
- The booking wizard, pricing math, Google Maps, payment boundary, webhook security,
  route map, GHL tags/most fields, deploy — all intact.
- Guests book exactly as today; auth sits beside the flow, never in front.
- The DB is added BENEATH the working system; nothing is torn down.
- All 57 tests still relevant; new tests added for auth-role gating + rates-from-DB.

---

## G. CORRECTED OPERATIONAL MODEL (2026-07-24) — GHL is the ONLY cockpit

The owner made the offer-defining call: **GHL is the single face of the operation.
The DB is invisible backend plumbing the owner never logs into.** This overrides
the earlier "website admin dashboard for dispatch" thinking — that risked a second
cockpit that makes the owner ask "why do I need GHL?".

The rule:
> The owner sees ONLY GoHighLevel for operations. The database works silently. The
> ONLY owner-facing website screen is the rates/settings editor — unavoidable
> because GHL cannot do pricing math. Nobody logs into a website "dashboard".

| Owner sees it in | What |
|---|---|
| **GHL (the cockpit)** | Trips, driver assignment, comms, pipeline, reviews, win-back — everything operational + relational |
| **Website (unavoidable minimum)** | ONLY the rates/settings editor (pricing math can't live in GHL) |
| **Nowhere (silent DB)** | Trip storage + double-booking check → surfaces ONLY as an EMAIL to the owner on conflict |

**Driver assignment:** happens IN GHL (dropdown/drag). On assignment, a webhook
fires to the website; the DB checks for a driver/vehicle time clash across all
trips; IF clash → email alert to the owner. It is a WARNING-AFTER, not a hard
block (GHL can't be physically prevented from assigning) — the honest trade for
keeping assignment in GHL. Satisfies the contract's "double-booking protection"
as automated detection + alert.

**Trip storage:** the DB stores trips SILENTLY (needed to run the clash query and
for reporting). Not shown to the owner anywhere — no second dashboard. This is
what removes the "redundant / why two places" objection: nothing visible to BE
redundant. The DB is infrastructure, like the payment processor or Google Maps —
it just works, unseen.

**Consequence for the roadmap:** there is NO owner-facing website "admin dashboard"
beyond the rates/settings page. Stage E's dispatch UI is DELETED from the website;
assignment + trips live in GHL; the DB's dispatch role is a silent webhook-driven
double-booking check + email. The website's entire owner-facing surface = the
rates/settings admin (behind the role-gated login) + the customer booking page.

**The role-gated "Admin Dashboard" button** now leads to the rates/settings editor
(the one owner screen), NOT a big operational dashboard. Simpler and on-message.

## H. DOUBLE-BOOKING FLAG + CANCELLATION (decided 2026-07-24)

### Double-booking: email AND a pipeline stage (belt + suspenders)
An email can be missed; a stage is a persistent flag in the cockpit the owner
already scans. So on a detected clash the website tells GHL to do BOTH:
1. Email the owner ("⚠ possible double-booking: {driver}, {time}, clashes with {other trip}").
2. Move the JUST-ASSIGNED opportunity to a new **"Possible Double Booking"** stage.
- Only the LATEST booking flags (the action to review); the email names the clash.
- Resolution is HUMAN: owner calls to confirm which booking is real, then drags the
  card back. No auto-message to the customer (an internal dispatch clash is not the
  customer's business).
- New GHL stage needed: **Possible Double Booking** (operational holding stage, no
  customer comms). Added at the GHL-finalize step.

### Request Cancellation — a CONTACT popup, not an automated flow (owner's design)
A "Request Cancellation" button on the customer's side opens a small popup offering
**Email / WhatsApp / Call**, then redirects:
- Email → `mailto:` the business address
- WhatsApp → `https://wa.me/<number>`
- Call → `tel:<number>`
Business contact details come from the editable settings (owner-controlled).
Why this design (owner's call, and it's the right one):
- Cancellation touches REFUNDS — a human should handle it via a real conversation,
  not an automated flow. Correct for a luxury service and anything touching money.
- Pure redirects (mailto/wa.me/tel) — no backend, no DB, near-zero risk.
- Fits guest booking (no login needed). Satisfies the contract's cancellation
  requirement by giving a clear immediate path to request one.
- NOT an automated cancellation, NOT a new GHL stage — just a contact popup.
- Where the button appears: on /success after booking, and (later) in the
  confirmation email. TIMING: later slice, after the core DB + rates admin.

## F. THE ONE RISK TO WATCH (honest)
Auth is the single new muscle (flagged in the capability audit). The mitigations
hold: use Auth.js (never hand-roll), keep to two roles, JWT sessions, and — the
correctness point from A2 — **guard the dashboard on the SERVER by role, not just by
hiding a button.** A hidden button with an unguarded route would be a security hole
that looks fine in a demo and fails in an audit. We do both: button for UX, server
guard for safety.
