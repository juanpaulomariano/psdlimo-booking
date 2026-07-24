# STATE.md — engineering handoff

Snapshot for the next engineer. Written to be read cold, with no access to the
build conversation. Everything here was checked against the running system on
**2026-07-21**, not recalled — where a claim is an assumption rather than a
verified fact, it says so explicitly.

- **Live:** https://psdlimo-booking.vercel.app
- **Repo:** https://github.com/juanpaulomariano/psdlimo-booking (private)
- **Build:** `npm run build` clean · **Tests:** 44 pass (`npm test`) · **Git:** clean, all pushed
- **Latest commit at time of writing:** `dd7eab0`

---

## 0. Read this first — a documentation discrepancy

The task that generated this file referenced **`PRODUCTION-ARCHITECTURE.md §2`**
as a specification of features to implement. **No such file exists in this repo.**

What exists is **`ARCHITECTURE.md`**, and its **§2 is "Repository layout"** — a
file tree, not a feature spec. The closest thing to a "what to build" spec is
spread across ARCHITECTURE.md §§3–9, and the "what NOT to build" list is §11.

This file is therefore written against `ARCHITECTURE.md` as it actually exists.
If a `PRODUCTION-ARCHITECTURE.md` was meant to be delivered and is missing, that
is itself an open item — see §4.

The governing documents that DO exist, and their roles:

| File | Role |
|---|---|
| `ARCHITECTURE.md` | Scope and flow. Source of truth for what the demo is. |
| `CLAUDE.md` | How to work in the codebase + the traps (imports `AGENTS.md`). |
| `AGENTS.md` | One rule: this is Next.js 16, read the bundled docs, do not trust training data. |
| `GHL_SETUP.md` | The GoHighLevel sandbox checklist. |
| `DEMO_NOTES.md` | Demo-only shortcuts to state out loud (currency, placeholders, key restrictions, "looks like a bug but isn't"). |
| `COSTS.md` | Client-facing running-cost breakdown. |
| `HOW_IT_WORKS.md` | Client-facing "why no n8n" explainer. |

---

## 1. Features — what exists, and how it was validated

Legend:
- **LIVE-VERIFIED** — exercised against the real third-party API and the result inspected
- **PROD-VERIFIED** — exercised against the deployed Vercel site specifically
- **TEST-VERIFIED** — covered by an assertion in `scripts/test-*.ts`
- **ASSUMED** — believed correct from code review, but NOT exercised end-to-end

### 1.1 Pricing engine — `lib/pricing.ts`
- Pure function `(ride, distanceMiles) => breakdown`. No fetch, no clock, no env. **TEST-VERIFIED** (26 assertions).
- Distance / hourly / flat ride types; vehicle multiplier; add-ons applied post-multiplier; 25% service fee; minimum-fare floor; whole-USD rounding. **TEST-VERIFIED** with hand-computed expected values.
- Throws rather than pricing a distance ride at 0 miles. **TEST-VERIFIED**.
- Road-vs-straight-line: two tests pin that road distance prices higher than the map's straight-line distance, so wiring the map into pricing would fail the suite. **TEST-VERIFIED**.

### 1.2 Shared schemas — `lib/booking-schema.ts`
- One zod schema, three consumers (quote, checkout, webhook). Discriminated union on `rideType`. **TEST-VERIFIED** + used in every route.
- `checkoutRequestSchema` deliberately has **no `total` field** — a client price has nowhere to go. **LIVE-VERIFIED** (injected `{"total":1}` → server charged the real amount).

### 1.3 Timezone — `lib/datetime.ts`
- America/Los_Angeles everywhere; offsets read from the IANA db via `Intl`, not hardcoded. **TEST-VERIFIED** (July → −07:00, January → −08:00; 9 AM SF renders as 9 AM on a UTC+8 build machine).
- **Note:** GHL DATE fields truncate the datetime to `YYYY-MM-DD`; the pickup TIME is preserved on the opportunity NAME and description. **LIVE-VERIFIED** (opportunity name reads "Jul 23, 7:29 PM PDT").

### 1.4 Google Routes API — `lib/maps.ts` + `/api/quote`
- `computeRouteMatrix`, server-only (imports `server-only`). Endpoint + request shape confirmed against Google's live docs. **LIVE-VERIFIED** (SFO → Ritz-Carlton = 14.9 mi; SFO → Hotel Zephyr = 16.0 mi).
- Errors are typed (`RoutingError`) and never fall back to a default distance. **LIVE-VERIFIED** (nonsense address → 400 `INVALID_ADDRESS`, not a $0-mile quote).
- `USE_MOCK_MAPS=1` gives a deterministic hash-derived distance for keyless local dev; refuses to run when a real key is present. **LIVE-VERIFIED** early in the build; still in the code.
- `/api/quote`: zod at the boundary, lead-time re-checked server-side, bad address → 400, API failure → 502, malformed JSON → 400, GET → 405. **LIVE-VERIFIED**.

### 1.5 Booking wizard — `app/components/*` + `app/page.tsx`
- 3-step single-page wizard, flat local state, quote DERIVED via debounced `/api/quote`. **PROD-VERIFIED** (renders, prices, re-prices).
- **Places (New) Autocomplete** called from the browser (referrer-locked key), session-tokened, 220 ms debounce, 3-char minimum. **LIVE-VERIFIED** (autocomplete returns real predictions).
- Vehicle capacity gating is DERIVED during render (`effectiveVehicleClass`), not corrected in an effect — a car too small for the party can never be the quoted one. **TEST-VERIFIED** (exhaustive sweep over all passenger/class pairs).
- ⚠️ **The actual visual design has NOT been seen by the builder.** No browser/screenshot tool was available. The map image was inspected (fetched as a PNG), but the page layout, spacing, and type were never visually reviewed. **ASSUMED** correct. First task for anyone who can open a browser: look at it.

### 1.6 Payments boundary — `lib/payments.ts` + `/api/checkout`
- The ONLY file that imports/knows Xendit. Neutral surface: `createInvoice` / `verifyCallback` / `parseCallback` / `fetchBookingMetadata` / `toChargeAmount`. **LIVE-VERIFIED**.
- Price recomputed at checkout from a FRESH Routes lookup; `external_id` generated exactly once. **LIVE-VERIFIED**.
- **Currency: PHP.** This Xendit account cannot issue USD invoices — confirmed by API (`USD → UNSUPPORTED_CURRENCY`, `PHP → 201`). USD is the source of truth everywhere (UI, metadata, CRM); PHP is used for the invoice only, converted in one function. **LIVE-VERIFIED** ($212 USD → 12,402 PHP). Conversion + token verification + callback parsing are **TEST-VERIFIED** (18 assertions).
- `/api/checkout`: creates no CRM record; only the webhook does. **LIVE-VERIFIED**.

### 1.7 Webhook — `/api/xendit-webhook`
The hinge of the system. Full ordering **LIVE- and PROD-VERIFIED**:
- Token verified (constant-time, `x-callback-token` header) BEFORE the body is read. Fails closed if the secret is unset. → **no token 401, forged 401, valid 200** (verified on production).
- Only PAID/SETTLED act; EXPIRED/PENDING → 200 no-op. **LIVE-VERIFIED** (EXPIRED → `{received:true, acted:false}`).
- **Metadata is FETCHED from the invoice, not read from the callback** — see §2.1, this was a real bug. **PROD-VERIFIED** (a real card payment landed in GHL end-to-end, unaided).
- Idempotency: search opportunities by `contact_id`, match `payment_ref_id`. A resent callback returns `already_recorded`, no duplicate. **PROD-VERIFIED** (same callback ×3 → one opportunity).
- GHL failure → 500 so Xendit retries; malformed metadata → 400 (retry can't fix bad data). **TEST- + LIVE-VERIFIED**.

### 1.8 GHL client — `lib/ghl.ts`
- Upsert contact → idempotency check → create opportunity in **Confirmed** → tags. Calls exactly `/contacts/upsert`, `/opportunities/`, `/opportunities/search`. **LIVE-VERIFIED** (contact + opportunity created, 15/15 opportunity fields populated where data existed, tags `source.website` `pay.card` `pay.paid` `service.airport`).
- Per-booking data on the opportunity, never the contact. **LIVE-VERIFIED** (contact carried only `preferred_vehicle` + `last_ride_date`, no trip data).
- `readFieldValue()` handles GHL's per-endpoint value-key differences (`fieldValue` vs `fieldValueString` vs `fieldValueNumber`/`Date`). See §2.2. **LIVE-VERIFIED**.
- GHL's own duplicate rejection (400 `Can not create duplicate opportunity`) is treated as already-recorded, not an error. **LIVE-VERIFIED**.
- `hours_booked` only written for hourly rides (Xendit returns absent numbers as `""` → coerces to 0). **LIVE-VERIFIED** (distance ride → field absent; hourly → 3).

### 1.9 Field-ID resolution — `scripts/fetch-ghl-ids.ts` → `config/ghl-fields.json`
- Resolves 15 opportunity + 4 contact fields, pipeline, Confirmed stage. Checks dropdown option values against `config/rates.ts`. **LIVE-VERIFIED** (all resolved).
- Fails loudly on missing field / bad dropdown value / bad token / field-on-wrong-object. **LIVE-VERIFIED** (deliberately broken three ways; each produced a named error and exit 1).

### 1.10 Route map — `/api/route-map` + `RouteMap.tsx` + `config/map-style.ts`
- Static Maps image, proxied server-side so the key never reaches the browser. Dark-styled to match. **LIVE-VERIFIED** (rendered PNG inspected: brass A pin, white B pin, brass line, no saturated colour).
- **DISPLAY ONLY.** Straight A→B line, not a Directions polyline. Receives only address strings + a `drivingMiles` prop for the caption (passed from the server quote, never computed). Fails invisibly (204 → renders nothing). **LIVE-VERIFIED** (browser key → 403 on Static Maps; endpoint → 204 before the API was enabled; page still loaded).
- Disclaimer under the map: "Route shown for reference. Pricing uses actual driving distance — 16.0 miles." **PROD-VERIFIED** (deployed).

### 1.11 Success / cancelled pages
- `/success?ref=` and `/cancelled?ref=` — intentionally dumb, confirm nothing, just display the reference. Next 16 async `searchParams`. **PROD-VERIFIED** (both 200).

---

## 2. Deviations from ARCHITECTURE.md — and why

### 2.1 Webhook reads metadata from the invoice, not the callback body — **REQUIRED FIX**
ARCHITECTURE.md §1/§6 implies the booking rides in on the callback. It does not:
**Xendit's invoice callback does NOT include the `metadata`** attached at
creation. Reading `event.metadata` yields `undefined`, every field fails
validation, and nothing reaches the CRM. This shipped broken and was caught only
by a real card payment (commit `4a6e2b8`). Fix: the callback gives the
`external_id`; `fetchBookingMetadata()` reads the booking from the invoice via an
authenticated API call. Side benefit — the payload now comes from an
authenticated read, not the request body, so it can't be spoofed. **This is the
single most important thing to understand about the webhook.**

### 2.2 Idempotency is contact-scoped search, not free-text — **REQUIRED FIX**
ARCHITECTURE.md §6 says "search for `payment_ref_id == external_id`". The obvious
implementations don't work, verified against the live API:
- `?q=` free-text does NOT search custom fields → 0 matches even when the record exists.
- `POST /opportunities/search` with a `customFields.*` filter → 422.
- Location-wide search omits `customFields` from results entirely.
The working approach: scope by `contact_id` (contacts dedupe by email, so a
duplicate callback resolves to the same contact), which DOES return
`customFields`, then match `payment_ref_id`. Plus GHL's own duplicate-create
rejection as a second line of defence. (commits `31cceaa`, and CLAUDE.md records all four GHL quirks.)

### 2.3 Currency is PHP, not USD — **ENVIRONMENT CONSTRAINT**
ARCHITECTURE.md §5 assumes USD. This Xendit account can't (`UNSUPPORTED_CURRENCY`).
USD stays the business/display/CRM currency; PHP is the invoice currency only.
Conversion (`XENDIT_USD_TO_PHP`, placeholder 58.5) lives in `lib/payments.ts`
and vanishes when the production processor (client-owned, USD) replaces Xendit.

### 2.4 GHL tags use DOTS, not hyphens — **CRM IS SOURCE OF TRUTH**
ARCHITECTURE.md §9 / original spec: `source-website`. The sandbox was built with
`source.website`. Code and all docs follow the CRM. The `service_tag` VALUES
inside `bookingMetadata` still use hyphens (`service-airport`) as an internal
enum; `tagsForBooking()` maps them to the dotted CRM tags. Don't "fix" one
without the other.

### 2.5 Route map added — **SCOPE ADDITION (client-requested)**
Not in ARCHITECTURE.md; §11 doesn't forbid it. Added on request, display-only,
with a hard rule (tests + comments) that it never feeds pricing. See §1.10.

### 2.6 Two API keys, per-service restricted — **stricter than spec, deliberate**
`GOOGLE_MAPS_SERVER_KEY` (Routes + Static Maps, no referrer restriction) and
`NEXT_PUBLIC_MAPS_BROWSER_KEY` (Places New only, referrer-locked to localhost +
*.vercel.app). Verified enforced: browser key → 403 on both Routes and Static
Maps. The server key also carries Static Maps but is never exposed.

### 2.7 Extra client-facing docs — **additive**
`COSTS.md`, `HOW_IT_WORKS.md`, `DEMO_NOTES.md`, `GHL_SETUP.md` are not in the
original plan. They exist to answer real client/boss questions and to make the
demo defensible. No code impact.

### 2.8 `next lint` → ESLint; Turbopack default — **framework, Next 16**
Not a choice; Next 16 removed `next lint` and defaults to Turbopack. `package.json`
scripts reflect this.

---

## 3. ARCHITECTURE.md §11 (out of scope) — status

§11 is the "do NOT build" list, and it has been honoured. Recording it here so
nobody re-derives the boundary:

| §11 item | Status |
|---|---|
| Marketing site & content | Not built (correct) |
| Feeder ingestion | Not built (correct — blocked on client ride sample) |
| Email/WhatsApp capture | Not built (correct) |
| AI receptionist | Not built (correct) |
| **Dispatch/reminder workflows (GHL-side)** | Not built (correct). **Auto-appointment creation was requested and explicitly declined** to keep this boundary — see §4. |
| Customer portal | Not built (correct) |
| Live charges | Not built (correct — Xendit test mode only) |
| Embedded card fields / tokenization | Not built (correct — Xendit hosted page) |
| PayPal / Cash payment methods | Rendered as DISABLED placeholders only (correct per §3) |

**Nothing in the ARCHITECTURE.md "definition of done" (CLAUDE.md) is unimplemented.**
The full demo path — form → live price → add-on re-price → pay → hosted page →
success → verified callback → GHL contact+opportunity+fields+tags → idempotent
resend → abandoned invoice leaves no trace — is complete and has been run end to
end on production.

---

## 4. Open questions & known weirdness

### 4.1 RESOLVED THIS SESSION — repeat bookings now work
`allowDuplicateOpportunity` was `false`, which made GHL reject a second booking
from the same contact. **The account owner has since flipped it to `true`**
(verified via the location API on 2026-07-21). Proof it works: the sandbox
currently holds **three opportunities under one "Juan Paulo Mariano" contact**
($212 / $548 / $199). The toggle lives at **Sub-Account Settings → Objects →
Opportunities → "Allow Multiple Opportunities per Contact"** (GHL moved it; it is
NOT in Business Profile or pipeline settings — this cost real search time).
`allowDuplicateContact` remains `false`, which is correct (repeat customers stay
one contact).

### 4.2 Test data is sitting in the sandbox — **cleanup needed before demo**
As of writing, the Confirmed pipeline holds **4 test bookings** (3× Juan Paulo
Mariano, 1× Fernan Ong). They are harmless but should be deleted for a clean
demo. Delete via `DELETE /opportunities/{id}` and `DELETE /contacts/{id}` with
the GHL token, or in the GHL UI.

### 4.3 The visual design is unreviewed — **highest-value next check**
See §1.5. The builder had no browser. The page is `ASSUMED` visually correct.
Open it and look before showing a client.

### 4.4 `PRODUCTION-ARCHITECTURE.md` does not exist
See §0. If it was expected, it's missing. If `ARCHITECTURE.md` is the intended
spec, then this is a naming mismatch in the request only.

### 4.5 Placeholder pricing — **must be confirmed before go-live**
Every number in `config/rates.ts` is invented (the `// PLACEHOLDER` banner is
load-bearing — keep it). `PRICING_ASSUMPTIONS` in that file lists the business
rules a client must sign off (notably: vehicle multiplier applies to flat routes;
25% fee after add-ons; minimum fare is a post-fee floor). Real pricing = edit
that one file, nothing else.

### 4.6 USD→PHP rate is a fixed placeholder
`XENDIT_USD_TO_PHP=58.5`, not a live FX feed. Irrelevant at go-live (USD processor).
Don't ship this to a real paying customer as-is.

### 4.7 GHL API rate limits — unverified assumption
GHL doesn't publish a hard API rate limit for Private Integrations on standard
plans. At ~3 calls/booking (~200/month) we're nowhere near any plausible limit,
but this is an ASSUMPTION on someone else's pricing page. Re-check at go-live.

### 4.8 Hosting licence — **go-live blocker, not a capacity issue**
Vercel Hobby is non-commercial by licence. Production needs Vercel Pro (~$20/mo)
or a Cloudflare Pages port. This is the only real recurring cost (see COSTS.md).

### 4.9 The Routes API key was pasted in chat before it was restricted
Now restricted to Routes + Static Maps, so exposure is low, but rotating it
(`⋮ → Regenerate key` in Google Cloud, then update `GOOGLE_MAPS_SERVER_KEY` in
`.env.local` and Vercel) is the clean move and has not been done.

### 4.10 Local dev on Windows — stale-dev-server trap
`next dev` holds a lockfile; a killed-but-not-reaped process leaves port 3000
occupied and serves STALE code (404s on new routes, or a Turbopack PostCSS
`0xc0000142` worker-spawn error). If routes 404 that should exist, kill every
`node` listener on :300x and restart. This bit the build twice and is a property
of the environment, not the code.

### 4.11 Webhook checkbox setting in Xendit
"Notify when a payment is received after expiry" must stay OFF — it would create
a booking for a ride whose pickup time may have passed (untested path). "Notify
when an invoice has expired" is also OFF (correct; expiry is a no-op by design).

---

## 5. How to run it

```bash
npm install
cp .env.example .env.local     # fill in — see the file's annotations
npm run dev                    # local (Xendit callbacks need a public URL; use the Vercel deploy or a tunnel)
npm run build                  # must be clean before any commit
npm test                       # 44 assertions (pricing 26 + payments 18)
npm run ghl:ids                # re-resolve GHL field IDs after any sandbox change; fails loudly
```

Secrets live in `.env.local` (git-ignored) and in Vercel env vars (production +
preview + development, already set). `.env.example` documents every variable.

**Deploy:** `npx vercel --prod --yes`. The stable alias
`https://psdlimo-booking.vercel.app` is what the Xendit webhook points at; the
per-deploy URL changes and must not be used for the callback.
