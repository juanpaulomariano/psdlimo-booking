@AGENTS.md

# CLAUDE.md — PSDLimo Booking System

You are building the PSDLimo booking demo. `ARCHITECTURE.md` in this repo is the source of truth for scope and flow — read it before writing any code. This file tells you how to work in this codebase and lists the traps that will otherwise waste hours.

## What this is
A Next.js (App Router, TypeScript) booking system deployed to Vercel: live auto-priced rides → Xendit hosted payment (test mode) → callback webhook pushes the booking into GoHighLevel. No database — the Xendit invoice metadata carries the booking between payment and CRM. Demo quality bar: this will be shown live to a client; failures must be loud in dev and impossible in the demo path.

## Commands
- `npm run dev` — local dev
- `npm run build` — must pass with zero TypeScript errors before any commit
- `npm run ghl:ids` — fetches GHL custom-field/pipeline/stage IDs into `config/ghl-fields.json`; run after any GHL sandbox change; FAILS LOUDLY if an expected field is missing (that is its job — do not soften it)
- Local end-to-end: Xendit callbacks need a public URL — use a tunnel (`ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`) and register it as the callback URL in the Xendit dashboard, or test against the Vercel preview deployment

## Non-negotiable invariants
1. **Never trust a price from the browser.** `/api/checkout` recomputes from raw ride details via `lib/pricing.ts`. The client-submitted total is never read.
2. **GHL writes happen only inside the verified Xendit callback.** No CRM calls from any other route, ever.
3. **Webhook idempotency:** before creating an opportunity, search for `payment_ref_id == external_id`; if found, return 200 and stop.
4. **All datetimes are America/Los_Angeles.** You are likely running in UTC+8; the client operates in San Francisco. Store ISO strings with explicit offset; render with `timeZone: "America/Los_Angeles"`. Never call bare `new Date()` formatting on a pickup time.
5. **Custom fields are written by field ID from `config/ghl-fields.json`, never by key at runtime.**
6. **All Xendit-specific code lives in `lib/payments.ts` only.** No other file may import the Xendit SDK or hit Xendit URLs. The production processor will be swapped later; the swap must touch one file.

## Known traps (each of these has burned someone)
- **Xendit callback verification is the `x-callback-token` HEADER, not a body signature.** Compare it against `XENDIT_CALLBACK_TOKEN` with a constant-time comparison (`crypto.timingSafeEqual` on equal-length buffers). Reject anything without a matching token BEFORE reading the body.
- **Only act on PAID/SETTLED invoice callbacks.** Xendit also sends EXPIRED and other statuses to the same endpoint — return 200 for those and do nothing (returning non-200 would make Xendit retry a callback you intend to ignore).
- **`external_id` is yours, generate it well:** `psdlimo-{Date.now()}-{nanoid(8)}`. It is simultaneously the booking reference shown to the customer, the idempotency key in GHL, and the join key across Xendit dashboard/logs. One value, three jobs — never generate it in two places.
- **Currency check before building the payment step:** confirm in the Xendit dashboard that USD invoices are enabled in test mode. If not, charge the PHP test equivalent while displaying USD, and surface that clearly in code comments and the demo notes. Do not silently mix currencies.
- **Test cards:** use the numbers from Xendit's own test-mode documentation at build time. Do not assume Stripe's 4242 card — it is not Xendit's.
- **On GHL API failure in the webhook, return 500** so Xendit retries. Do not catch-and-200. Xendit's retry window is limited — log everything, because the recovery path for an exhausted callback is a manual resend from the Xendit dashboard (which idempotency makes always safe).
- **Google:** use **Routes API `computeRouteMatrix`** (classic Distance Matrix is legacy — may be unavailable to this new project) and **Places (New) Autocomplete**. `GOOGLE_MAPS_SERVER_KEY` must never be imported in a client component; the browser uses only `NEXT_PUBLIC_MAPS_BROWSER_KEY`.
- **Metadata limits:** keep the booking payload compact; `special_requests` is user free-text — enforce `maxLength={400}` in the UI AND `.slice(0, 400)` server-side before attaching to the invoice.
- **Abandoned invoices are not errors.** A customer who closes the Xendit page leaves an invoice that simply expires. No cleanup needed, no CRM record created — that is correct behavior, don't "fix" it.
- **GHL v2 basics:** base `https://services.leadconnectorhq.com`, headers `Authorization: Bearer ${GHL_PRIVATE_TOKEN}` and `Version: 2021-07-28`. Contact upsert dedupes by email+phone. Opportunity custom fields go on the opportunity, contact fields on the contact — per-booking data NEVER on the contact (repeat bookings would overwrite). Log GHL error response bodies — their errors are only useful in the body.

## Code style
- TypeScript strict; zod validation at every API boundary (`lib/booking-schema.ts` is shared by quote, checkout, and webhook — one schema, three consumers).
- `lib/pricing.ts` is a pure function: `(rideDetails, distanceMiles) => breakdown`. No fetches inside it; distance is passed in. This keeps it unit-testable and reusable by both quote and checkout.
- All rates live in `config/rates.ts` only. Every number is a placeholder — keep the `// PLACEHOLDER` banner comment intact so nobody mistakes them for confirmed client pricing.
- Secrets only via env vars. Never commit `.env.local`, never inline a key, never log a token.
- UI: single-page 3-step wizard, restrained luxury feel (near-monochrome, one accent, generous whitespace — not a colorful SaaS template). Disable the Pay button until a server-confirmed quote exists.

## Definition of done (demo path)
`npm run build` clean → end-to-end passes on a public URL: fill form → live price renders with breakdown → toggle an add-on re-prices → Confirm & Pay → Xendit hosted page → pay with a documented Xendit test card → redirected to /success with reference → callback received and token-verified → GHL sandbox shows: contact created, opportunity in Confirmed with monetary value, every Ride Details field populated, tags `source-website` `pay-card` `pay-paid` + correct `service-*` applied → re-sending the same callback from the Xendit dashboard does NOT create a duplicate opportunity → an abandoned/expired invoice leaves zero trace in GHL.

## Out of scope — do not build even if it seems helpful
Marketing pages/content · databases · auth/portals · PayPal integration (render the disabled placeholder only) · embedded card fields/tokenization · feeder ingestion · email capture · AI chat · GHL workflows (those live in GHL, not this repo).
