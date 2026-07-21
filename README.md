# PSDLimo Booking System — Demo

End-to-end limo booking demo: customer books a ride → live auto-price → pays on a secure hosted
payment page → the booking lands in GoHighLevel fully tagged and staged, untouched by hands.

**No database.** The Xendit invoice metadata carries the booking between payment and CRM.

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — what we build and why (source of truth for scope)
- [`HOW_IT_WORKS.md`](HOW_IT_WORKS.md) — how the booking reaches the CRM without an automation platform
- [`COSTS.md`](COSTS.md) — what it costs to run (short answer: $0/mo in API fees at the stated volume)
- [`CLAUDE.md`](CLAUDE.md) — how to work in this codebase, and the traps

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind 4 · Vercel · Google Routes API + Places (New) ·
Xendit Invoice API (test mode) · GoHighLevel API v2 (sandbox sub-account)

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Open http://localhost:3000.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build — must pass with zero TypeScript errors before any commit |
| `npm run lint` | ESLint (`next lint` was removed in Next 16) |
| `npm run ghl:ids` | Resolve GHL custom-field / pipeline / stage IDs into `config/ghl-fields.json`. Fails loudly on any missing field — that is its job. |
| `npm run test:pricing` | Pricing-engine assertions (no framework; plain assertions) |

## Environment variables

See [`.env.example`](.env.example) for the full annotated list. Nothing runs without them.

## Testing the full loop locally

Xendit callbacks need a **public URL**, so `localhost` alone cannot complete the loop. Either:

1. Test against the Vercel preview deployment (simplest), or
2. Tunnel: `ngrok http 3000` (or `cloudflared tunnel --url http://localhost:3000`), then register
   that public URL + `/api/xendit-webhook` as the callback URL in the Xendit dashboard.

## Safety properties (the ones worth demoing)

| Scenario | Behavior |
|---|---|
| Customer tampers with the price in the browser | Server recomputes from raw ride details; the client total is never read |
| Forged callback | Rejected — `x-callback-token` header compared in constant time |
| Duplicate callback / manual resend | Idempotent — keyed on `payment_ref_id == external_id`; no duplicate opportunity |
| GHL is down | Returns 500 so Xendit retries; exhausted retries are recoverable by resending from the Xendit dashboard |
| Customer abandons the payment page | Invoice simply expires. No PAID callback, no CRM record. This is correct, not a bug. |
| Timezone | America/Los_Angeles everywhere, explicitly |

## Live demo

**https://psdlimo-booking.vercel.app**

Webhook endpoint (register this in Xendit → Settings → Webhooks, "Invoices paid"):

```
https://psdlimo-booking.vercel.app/api/xendit-webhook
```

Pay with Xendit's test card `4000 0000 0000 1000`, CVV `123`, expiry `02/30`.
Full card list and demo talking points in [`DEMO_NOTES.md`](DEMO_NOTES.md).

## Status

Built section by section; each section verified against the live API before moving on.

- [x] 0 — Scaffold, repo, deploy pipeline
- [x] 1 — Pricing engine + shared zod schemas
- [x] 2 — Google Routes API + `/api/quote`
- [x] 3 — Booking wizard UI
- [x] 4 — Xendit invoices + `/api/checkout`
- [x] 5 — GHL field-ID resolution
- [x] 6 — Verified webhook + GHL push
- [ ] 7 — Full end-to-end demo pass (needs the Xendit callback URL registered)
