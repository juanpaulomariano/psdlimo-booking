# ARCHITECTURE.md — PSD Limo System (current reference)

**This is the single source of truth for the architecture.** It supersedes the
scattered planning docs (ROADMAP, REVISED-SCOPE-NOTES, ARCHITECTURE-AUDIT,
ARCHITECTURE-AUDIT-2) — where any of those disagrees with this file, THIS WINS.
Last reconciled with the live code + DB on 2026-07-24.

> History note: an earlier version of this file described a "no database" design.
> That was correct for the original demo but is now superseded — the project took
> a deliberate DB pivot (below). The old planning docs are kept for their
> reasoning but are not the current spec.

---

## 1. What this is
A booking + operations system for PSD Limo (SF Bay Area chauffeur service):
customer books a ride on a custom website → live auto-priced → pays on a hosted
page → the booking flows into GoHighLevel for customer communications. Owners can
edit their own pricing through an admin area. The database silently backs
operations (rates, users, and — later — drivers/trips/dispatch).

**Live:** https://psdlimo-booking.vercel.app · **Repo:** github.com/juanpaulomariano/psdlimo-booking (private)

## 2. The core principle (read once, remember)
> **The database owns operational TRUTH. GoHighLevel is the customer-communication
> and sales-pipeline layer. The owner's one cockpit for operations is GHL; their
> one website screen is the rates/settings admin (because GHL can't do pricing
> math). The DB is invisible infrastructure the owner never logs into.**

This "GHL-central, DB-silent" split is deliberate — it keeps GHL (the recurring
offer) as the star, avoids a second competing dashboard, and puts each capability
where it belongs.

## 3. Stack
| Layer | Technology | Owned by (go-live) |
|---|---|---|
| Website | Next.js 16 (App Router, TS, Tailwind 4), Vercel | PSD Limo |
| Database | **Neon Postgres** (Free for demo → Launch for prod, ~$0–1/mo) | PSD Limo (their business email) |
| Auth | bcrypt + jose (signed-JWT session), NOT a heavy library | — |
| Distance & addresses | Google Routes API `computeRouteMatrix` · Places (New) · Static Maps (display only) | PSD Limo |
| Payments | Xendit Invoice API, test mode, PHP | — |
| Payments (future, IF the client asks) | A client-owned US processor for USD settlement; the swap is isolated to `lib/payments.ts` and NOT scheduled — see §12a | PSD Limo |
| CRM & comms | GoHighLevel sub-account | PSD Limo |
| Glue | NONE — the site's own webhook writes to GHL REST (no n8n) | — |

## 4. End-to-end flow (current)
```
CUSTOMER (guest — no login required to book)
  → booking wizard → /api/quote (Routes API + pricing engine, rates from DB)
  → /api/checkout (server RE-prices from DB rates · external_id minted · Xendit invoice)
  → Xendit hosted page → /success

XENDIT → callback → /api/xendit-webhook
  → token verify → PAID/SETTLED only → FETCH invoice metadata (callback carries none)
  → [current] upsert GHL contact + opportunity + fields + tags + calendar appointment
  → [planned] ALSO write the booking to the DB (system of record); push only the
    communication subset to GHL (one-way DB→GHL) — see §8 webhook rewrite

ADMIN (logged in, role=admin)
  → top-bar "Admin Dashboard" button → /admin (server-guarded)
  → rates editor: edit pricing → save → next quote reflects it (cache invalidated)

GHL → communication workflows (confirmation, reminders, thank-you, review, win-back)
```

## 5. Repository layout (actual, 2026-07-24)
```
app/
  page.tsx                     3-step booking wizard (the demo site)
  layout.tsx                   reads session → renders TopBar
  login/ register/             auth pages (guests still book without these)
  admin/page.tsx               SERVER-GUARDED rates editor (role=admin)
  success/ cancelled/          post-payment pages
  components/                  BookingWizard, PricePanel, RouteMap, AddressAutocomplete,
                               TopBar, AuthForm, RatesEditor, ui
  api/
    quote/         POST → price breakdown (DB rates + Routes API)
    checkout/      POST → Xendit invoice (server re-prices from DB)
    xendit-webhook/ POST → verify, idempotency, GHL push (+ appointment)
    route-map/     Static Maps proxy (display only)
    auth/{register,login,logout}/   session auth
    admin/rates/   GET/POST rates (admin-only, guarded)
lib/
  pricing.ts       pure engine: (ride, miles, rateCard) → breakdown
  rates-source.ts  READ path: rate card from DB, cached, last-good/code fallback
  rates-admin.ts   EDIT path: read/write rates for the admin, whitelisted writes
  db.ts            Neon connection (LAZY — created on first query, never on import)
  auth.ts          bcrypt + jose JWT, cookie, getSession, requireAdmin (server guard)
  users.ts         user DB access (constant-time login, no enumeration)
  auth-schema.ts / booking-schema.ts   zod schemas
  maps.ts          Routes API (server-only) · payments.ts   PROVIDER BOUNDARY (Xendit)
  ghl.ts           GHL v2 client · datetime.ts   LA timezone utils
config/
  rates.ts         PLACEHOLDER defaults + CODE_RATE_CARD + tag derivation
  ghl-fields.json  generated key→ID map · map-style.ts
scripts/
  db-migrate.ts / db-seed.ts    schema + seed-from-code (re-run vs prod DB)
  set-admin-password.ts · fetch-ghl-ids.ts · test-pricing.ts · test-payments.ts
```

## 6. Database (Neon Postgres)
Tables live now: `rate_config` (editable scalar knobs), `vehicle_class`,
`add_on`, `app_user`, `driver`, `vehicle`, `trip` (Stage E — the silent dispatch
backend; see §10).

- **Seeded FROM `config/rates.ts`** so the DB starts an exact mirror of the code —
  moving pricing to the DB changed the SOURCE of numbers, not the numbers.
- **Resilient:** the pricing engine reads rates via `rates-source.ts` with a
  three-level fallback (DB → last-good → code defaults). A DB outage NEVER breaks
  a quote — verified with a dead connection string.
- **Lazy connection** (`db.ts`): created on first query, never on import, so a
  build without `DATABASE_URL` never fails (this bit us once; now fixed).
- Demo DB = throwaway personal Neon (GitHub sign-in fine). Production DB = a fresh
  Neon account under PSD Limo's business email (email sign-up, Launch). Not a
  migration — the schema/seed scripts re-run against the client-owned account.

## 7. Auth & roles
- bcrypt (cost 12) password hashes; jose-signed JWT session in an httpOnly +
  Secure(prod) + SameSite=Lax cookie. `AUTH_SECRET` ≥32 chars or signing fails.
- Roles: `user` (default, self-register) and `admin` (seeded/console only —
  public registration can NEVER self-elevate).
- The "Admin Dashboard" button is UX; the `/admin` route + `/api/admin/*` are
  guarded SERVER-SIDE by role. Verified: forged/tampered token rejected, no user
  enumeration, SQL-injection safe, non-admin → 403.
- Guests still book with NO account — auth sits beside the booking flow, never in
  front of it.

## 8. The non-negotiable invariants
1. **The browser never dictates a price.** `/api/checkout` re-prices from raw
   details using DB rates; the checkout schema has no `total` field.
2. **CRM writes happen only inside the verified payment callback.** Paid ⇔ in GHL.
3. **Idempotent on `payment_ref_id`** (= Xendit `external_id`) across all of a
   contact's opportunities.
4. **All datetimes America/Los_Angeles** (IANA offsets). Time precision lives on
   appointments + opportunity names, never GHL date fields (they truncate).
5. **All payment-provider code in `lib/payments.ts` only.**
6. **Custom fields written by ID from `config/ghl-fields.json`** (`npm run ghl:ids`
   fails loudly on drift).
7. **The pricing engine stays a PURE function** — rates are passed IN (a RateCard),
   never fetched inside it.
8. **Admin surfaces are guarded on the server by role**, not by hiding a button.
9. **No automation depends on data that has no producer.**

## 9. GoHighLevel — current vs planned role
**Current (from the earlier demo build):** the webhook writes 18 opportunity
fields + 4 contact fields + tags + a calendar appointment. Pipeline: New Inquiry,
Quoted, Confirmed, Assigned, In Progress, Completed, Cancelled.

**Planned reshape (decided this session — see ARCHITECTURE-AUDIT-2 for detail):**
- **DB-first, one-way DB→GHL.** GHL never writes back. The webhook writes the
  booking to the DB, then pushes only the COMMUNICATION subset to GHL.
- **Drop redundant GHL fields** the DB now owns (reporting fields like
  quoted_price, booking_source; likely luggage/addons). Keep reference copies the
  MESSAGES render (pickup, dropoff, price, vehicle, etc.).
- **Simplify stages to message-milestones** (Confirmed / Completed / Cancelled +
  New Inquiry/Quoted for manual quotes) + a new **Possible Double Booking** flag
  stage. Fine-grained dispatch statuses live in the DB only.
- **Tags mostly survive** (segmentation is GHL's job).
- This reshape is done SURGICALLY, AFTER the DB + dispatch settle GHL's final
  shape — which is why the 12 workflows are built LAST, not next.

## 10. Dispatch model (driver assignment in the ADMIN, with a HARD block) — BUILT
**Redesigned 2026-07-25.** The owner assigns a driver to a confirmed booking IN
THE WEBSITE ADMIN (not in GHL), and the system PREVENTS double-booking at the
source rather than warning after the fact.

- **The rule: one driver = one trip per LA calendar day.** Assigning a driver who
  already has a trip that day is REFUSED (the UI shows which booking blocks it).
  This is a real block — possible because it happens in our own UI + API, where a
  GHL-side flow could only warn (GHL can't veto a keystroke in its own field).
- **"Per day" is deliberately stricter than "no time overlap"** — a same-day
  second trip is refused even if the clock says it fits, because delays make
  same-day doubles risky. The owner's explicit v1 choice.
- **The admin is the source of truth; GHL mirrors it one-way.** On assign, the
  driver name is written to the `Chauffeur Assigned` field and the opportunity
  moves to the `Assigned` stage, so the owner still sees it in GHL.
- **Why this replaced the earlier "assign-in-GHL, detect-overlap, tag+email" design:**
  free-text names in GHL caused typo mismatches; GHL could only warn, not block;
  and a flag tag went stale after the owner fixed the conflict. The admin model
  removes all three problems. That old warn-path (the `/api/dispatch/assign`
  webhook, the overlap engine, the `ops.double-booking` tag, and workflows
  WF-03/WF-04) is RETIRED — WF-03/WF-04 to be deleted in the GHL UI.

**How it's implemented:**
- Tables `driver`, `vehicle`, `trip` (`scripts/db-migrate.ts`); demo roster seeded
  (PLACEHOLDER) but the owner manages drivers in the admin.
- The payment webhook records every PAID ride as a `trip` (`lib/trips.ts`
  `upsertTrip`) — idempotent on `external_id`, NON-FATAL (a DB hiccup never fails a
  booking already in GHL).
- **Admin API** (`/api/admin/dispatch*`, all `requireAdmin` + zod): `GET` returns
  the bookings board + roster; `POST /assign` assigns/unassigns (409 on a block);
  `POST /drivers` adds/edits/retires (soft-retire only — past trips keep their
  driver).
- **The block is atomic** (`assignDriverForDay`): a single `UPDATE` whose `WHERE`
  excludes any OTHER same-LA-day trip for that driver, so the check and the write
  can't race. The LA day is computed in SQL via `AT TIME ZONE 'America/Los_Angeles'`.
- **UI:** `/admin` is a two-tab hub (Rates · Dispatch); `/admin/dispatch` has the
  bookings list (a driver dropdown per row, inline block message) + a roster panel.
- **GHL sync:** `syncDriverAssignmentToGHL()` (`lib/ghl.ts`) writes the name +
  moves to `Assigned`; never throws (admin DB is authoritative).
- Verified: `npm run test:dispatch` (17 checks against the live DB — the per-day
  block, LA-day boundaries, roster CRUD, retired-driver rules, unassign-frees-day,
  bookings join) + live GHL sync confirmed against a real opportunity.

**Known limits (v1, disclose during the demo):** the rule is per-DAY, so it does
not model travel time between rides on different days; ride duration is estimated;
vehicle-level assignment is not yet surfaced (drivers only). Driver accept/reject,
live statuses (En-Route/Arrived), and a driver portal are FUTURE phases.

## 11. Cancellation (customer-facing)
A "Request Cancellation" button opens a contact popup — Email / WhatsApp / Call.
The email address is copyable (a Copy button, since desktop `mailto:` often has no
registered handler) with `mailto:` / `tel:` still offered for devices that have
one; WhatsApp renders disabled until a number exists. NOT an automated cancellation
and NOT a new stage: cancellation touches refunds and belongs in a human
conversation. Contact details come from editable settings.

**Legal pages (Privacy · Terms · Cancellation Policy) — DEFERRED (decided
2026-07-24).** Intentionally not written yet. The actual terms — refund windows,
cancellation cut-offs, data handling — are the client's business decisions and
possibly a lawyer's, not ours to invent. We will discuss what goes in them WITH
the client during the demo, then add the pages with their confirmed wording (and a
"template text, not legal advice — review before go-live" note). Footer links can
be stubbed or hidden until then.

## 12. Cost (verified, for the proposal — no placeholders)
Neon **~$0–1/mo** (Launch, usage-based, no fixed fee) · Google Maps **$0** (~3% of
free tier) · Vercel Pro **~$20/mo** (only fixed cost; Hobby is non-commercial) ·
GHL existing subscription · payment processor per-transaction · SMS/A2P at go-live
(needs client EIN). The DB + auth + admin backbone adds ~$0–1/mo.

## 12a. Payments — Xendit stays (decided 2026-07-24)
The system runs on **Xendit** (Invoice API, test mode, PHP), and it STAYS there for
now. A swap to a US processor is **NOT scheduled** — we have no access to a US
payment method to build or test against, so introducing one would be untestable
guesswork. This is a deliberate hold, not an oversight.

The architecture already makes this cost-free to defer: every line of Xendit code
lives in `lib/payments.ts` behind a neutral vocabulary (`createInvoice` /
`verifyCallback` / `parseCallback`), so IF the client later wants funds to settle
to a US account, the swap touches that ONE file and nothing else. Until they ask —
and until a US method exists to test with — Xendit is the payment processor,
full stop.

## 13. Build status & what's next
See `ROADMAP.md` for the staged plan. Current position:
- ✅ Booking, payments, webhook→GHL, appointments (Phases 0–8)
- ✅ Neon DB + owner-editable rates (with fallback)
- ✅ Hardened auth + role-aware top bar + guarded admin rates editor
- ✅ Round-trip booking · Request-Cancellation contact popup
- ✅ Dispatch: driver assignment in the ADMIN with a HARD one-trip-per-day block ·
  roster management · one-way GHL sync (name + Assigned stage). Old GHL warn-path
  retired (§10).
- ⏭ Zones · legal pages (pending demo discussion) · GHL finalize + the "Possible
  Double Booking" stage + workflows (Stage A') · reporting · hardening/handover
- ⏸ Payment swap — ON HOLD, not scheduled (no US payment method to build/test
  against; Xendit stays). Isolated to `lib/payments.ts` if ever needed. See §12a.

## 14. Out of scope (say it before the client assumes it)
Marketing site/content · AI receptionist · extra lead channels · full driver
portal + real-time statuses · offline-first PWA · native app · commission
reporting · driver document-expiry alerts · feeder ingestion. Named as future
phases in the proposal, not built now.

**Zones — DEFERRED (decided 2026-07-24).** The demo already shows editable rates +
vehicle multipliers + add-ons. Zone-based pricing is deferred until the client
confirms HOW they actually price by area (surcharge-on-distance vs zone-to-zone
matrix vs editable fixed routes — the design differs a lot per model). The DB and
admin are built to accept a `zone` concept later without rework. Currently the
system supports distance, hourly, and fixed flat routes — which covers the common
cases.
