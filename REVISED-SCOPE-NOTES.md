# REVISED SCOPE — brainstorm notes (PSD Limo contract requirements, July 2026)

Working notes for absorbing the client's "Revised Proposal & Contract Requirements"
into the architecture. NOT the plan yet — the plan comes after this. Focus per the
owner: **website + CRM booking system only.** AI assistant and extra channels are
explicitly deferred.

## The reframe
The document is a PROCUREMENT / contract-protection document, not a feature list.
~70% of its Phase 1-5 technical scope is ALREADY BUILT and live-verified. Most of
it is answered by a written proposal (ownership, SLA, milestones, pricing schedule),
not by code. Only a specific subset needs new build.

## LOCKED DECISIONS (2026-07-24)
1. **Add a database as the backbone.** Website+DB owns pricing, drivers, dispatch,
   reporting. GHL owns contacts + sales pipeline + the 12 communication workflows.
   The webhook stays the one bridge. Nothing already built breaks — this ADDS a
   persistent layer beneath the existing flow.
2. **Owner-editable pricing = admin page on the website, reading the DB.** NOT GHL
   custom objects, NOT a GHL outbound webhook (that would need the DB anyway AND
   incur a billable premium-action cost — worst of both worlds). One source of
   truth, $0, no sync.
3. **Approach: brainstorm the full phased plan before building anything.**

## COST — verified 2026-07-24 (this matters for the "no placeholders" clause)
- "Vercel Postgres" as a bundled product NO LONGER EXISTS — Vercel retired it Dec
  2024 and moved to **Neon** via the Marketplace. Do not write "Vercel Postgres".
- **Neon free tier: 0.5 GB storage, 100 compute-hours/mo, scale-to-zero, no monthly
  floor.** A limo company's data is kilobytes — ~0.01% of the limit. Genuinely $0.
- Created under PSD Limo's business email → they own it (satisfies ownership §3).
- **Net new recurring cost of the entire DB backbone: $0.** The only recurring cost
  remains ~$20/mo Vercel Pro (already accepted; Hobby is non-commercial by licence).

## Why pricing CANNOT live in GHL (settled)
- Pricing is a synchronous CALCULATION on every quote, not a record or an event.
- Invariant #1: browser never dictates price; server recomputes. Rules must live
  WITH lib/pricing.ts, read from the DB at quote time, last-good fallback.
- GHL workflows can't do the arithmetic (base + miles×per-mile-by-zone × vehicle
  × fees → % → floor). The engine already exists as a pure function; only the
  NUMBERS move from rates.ts into the DB.

## What actually needs NEW code/config (website + CRM scope only)
| Item | Status | Notes |
|---|---|---|
| Round-trip booking | NEW | The one missing booking type (doc lists it 4×). |
| Manual "request a quote" path | NEW | Instant where rules allow; manual → New Inquiry/Quoted lead, no forced payment. |
| Owner-editable rates/zones/fees | NEW | DB + /admin page. The big one. |
| Zones (zone-based pricing) | NEW | Rates currently flat + per-mile; doc wants zones. DB models this. |
| PSD-owned payment processor (Stripe US) | FUTURE-ish | Already isolated to lib/payments.ts — one-file swap. |
| Driver / vehicle records + dispatch (Phase 4) | NEW, big | STILL TO BRAINSTORM — depth undecided. Doc says "not only assisted dispatch". |
| Customer-facing legal pages (privacy/terms/cancellation) | NEW, small | Contractual, not marketing. |
| SEO/schema/Analytics/Search Console | NEW, small | Phase 2 item. |
| Staging environment | NEW | Doc requires staging before live (Vercel preview ~ covers, formalize). |
| 2FA on admin accounts | CONFIG | Doc §7 requires 2FA on all admin accounts. |
| Role-based access (owner/dispatcher/CS/admin/driver) | NEW | Doc §1 + §7 least-privilege. Scope depends on dispatch depth. |
| Data export (CRM + DB), monthly | NEW, small | Doc §7 portability. |

## Answered by WRITING (proposal, not code) — track separately
Ownership §3 · pricing schedule §4 · milestones §5 · SLA §6 · data protection §7
· change control §8 · acceptance §9 · termination §10 · demo+references §11 ·
final submission §12. Technical ripple: ALL major accounts created under PSD's
business email FROM THE START (Google Cloud, Vercel, GitHub, GHL, Neon, domain).

## STILL TO BRAINSTORM
- **Dispatch depth (Phase 4).** Core-now vs full-now vs GHL-light. The largest,
  least-defined piece. Double-booking protection + driver records + trip statuses
  are DB-shaped. Owner wanted to brainstorm this specifically.
- Driver accept/reject mechanism (how does a driver respond? SMS link? portal?
  GHL app? — affects whether drivers need logins / a driver view).
- Round-trip pricing model (2× one-way? return-leg discount? separate legs?).
- Zone model (how many zones, how defined — by city? radius? postal?).
