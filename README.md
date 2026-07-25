# PSD Limo — Booking & Dispatch System

A chauffeur booking platform for PSD Limo: customers book a ride and pay online;
the booking flows automatically into the CRM (GoHighLevel); and the owner assigns
drivers and manages pricing from a secure admin.

## What it does

- **Live-priced booking** — customers get an instant, server-calculated quote
  (base fare, distance, add-ons, round-trip) and pay on a hosted payment page.
- **Automatic CRM sync** — a verified payment creates the contact, booking, and
  calendar entry in GoHighLevel, correctly tagged and staged, with no manual entry.
- **Owner admin** — adjust rates and fees anytime, and assign a driver to each
  confirmed booking. A driver can only take one trip per day, so double-booking is
  prevented at the source.
- **Automated communication** — booking confirmation, a day-before reminder, and a
  post-ride review request, all sent from the CRM.

## Stack

Next.js (App Router, TypeScript) · Tailwind · Vercel · Neon (Postgres) ·
Google Routes & Places APIs · GoHighLevel API · hosted card payments.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Open http://localhost:3000. See [`.env.example`](.env.example) for the required
configuration — nothing runs without it.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local development server |
| `npm run build` | Production build (must pass with zero TypeScript errors) |
| `npm run lint` | Linting |
| `npm run test` | Pricing + payment assertions |
| `npm run db:migrate` / `npm run db:seed` | Set up the database schema and seed data |

## Security properties

| Scenario | Behavior |
|---|---|
| Price tampering in the browser | The server recomputes every price from the raw ride details; a client-submitted total is never trusted |
| Forged payment callback | Rejected — the callback token is compared in constant time before the request is read |
| Duplicate / re-sent callback | Idempotent — no duplicate booking is ever created |
| Admin pages | Server-side role check; a logged-out or non-admin visitor is turned away |
| Timezone | America/Los_Angeles everywhere, explicitly |

## Live site

**https://psdlimo-booking.vercel.app**
