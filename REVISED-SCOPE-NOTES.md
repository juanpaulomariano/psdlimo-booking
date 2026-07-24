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

## COST — verified 2026-07-24 against neon.com/pricing (matters for "no placeholders")
- "Vercel Postgres" as a bundled product NO LONGER EXISTS — retired Dec 2024 →
  **Neon**. Do not write "Vercel Postgres".
- **Neon Free:** 0.5 GB, 100 CU-hours/mo, scale-to-zero, $0. BUT hard cap — hitting
  any monthly limit **SUSPENDS the database until next month** (does not bill). For a
  DEMO that's fine; for a LIVE booking business a DB that can switch off is a real
  risk (a mid-flow quote could fail). So production should NOT use Free.
- **Neon Launch (recommended for production):** NO fixed monthly base fee. Pure
  usage: compute $0.106/CU-hour, storage $0.35/GB-month. Invoices under $0.50 are
  not collected. Removes the suspension cliff (bills instead of turning off).
- **Estimated cost at our usage (Launch):**
  - Storage: ~0.1 GB → ~$0.04/mo (negligible).
  - Compute: scale-to-zero; a quote/save query runs in ms. At 65 bookings/mo,
    usage falls UNDER the $0.50 collection threshold → **effectively $0/mo.**
  - 10× growth → under $1/mo. 100× growth → a few $/mo.
  - Absolute worst case (DB kept warm 24/7 by constant traffic, ~5-min idle
    timeout never triggering) → ~$25/mo — only at genuinely high continuous
    traffic, trivial against revenue at that scale.
- **HONEST proposal line (do NOT say "$0 forever"):** "~$0-$1/month at current
  volume on Neon Launch — no fixed fee, no suspension risk, scaling to only a few
  dollars at 100× growth." Accuracy is what protects us under scrutiny.
- **DECIDED 2026-07-24 — Free for the demo, Launch for production.** The demo has no
  live traffic, so the suspension cliff is irrelevant and Free costs $0. At deploy we
  switch to Launch for reliability. Say to the client: "demo runs on Neon's free tier;
  production moves to Launch (~$0-$1/mo)."
- **ACCOUNT OWNERSHIP (contract §3 — two separate DBs, owned differently):**
  - DEMO DB (now): fine under a personal Neon login (GitHub sign-in is fastest);
    it is THROWAWAY. Not the production database.
  - PRODUCTION DB (go-live): must be a FRESH Neon account created with EMAIL sign-up
    under PSD Limo's business email (NOT GitHub-linked — GitHub-tied accounts are
    messier to hand over), on Launch. The contract forbids "create under our account,
    transfer later" — the production account is the client's from the start.
  - So: the demo DB is discarded at go-live; production points at the client-owned
    Neon account. This is NOT a migration of the demo DB — it is a clean production
    account the client owns. Schema/seed scripts are re-run against it.
- Created under PSD's business email → they own it (satisfies ownership §3).
- Other recurring: ~$20/mo Vercel Pro (accepted); Google Maps $0; GHL existing;
  Stripe per-transaction. The DB backbone adds ~$0-$1/mo, not a meaningful cost.

## DB PLATFORM — Neon, decided 2026-07-24 (Supabase considered and declined)
Considered Supabase (bundles auth + storage) vs Neon (pure Postgres). Chose Neon:
- **Cost:** Neon production (Launch) ~$0-1/mo usage-based; Supabase production
  effectively needs Pro at $25/mo FLAT (Supabase Free PAUSES after 1 week idle —
  bad for a demo AND a live business). ~$280/yr cheaper on Neon.
- **The "turns off" worry, resolved:** Neon does NOT pause on inactivity. It
  scale-to-zeros (sleeps between queries) and wakes in ~hundreds of ms on the next
  query — invisible. It only month-suspends on blowing USAGE limits (100
  compute-hrs), and at a few entries/month we use ~1%. On Launch even that risk is
  gone (bills a penny instead). Neon is SAFER against "asleep when I demo it".
- **The two things Supabase bundles, solved on Neon (both free + standard):**
  1. AUTH → **Auth.js (NextAuth)** — the standard Next.js auth library; handles
     hashing/sessions/tokens; points at our Neon app_user table. Supports the
     contract's role-based access + 2FA. Not a workaround.
  2. FILE STORAGE (driver license/insurance docs, Phase 4) → **Vercel Blob**
     (already on Vercel, 1 GB free — ample for dozens of docs) or Cloudflare R2.
     Store the file there, the LINK in Neon. This is how production apps do files
     anyway — even Supabase stores files separately from the DB.
- Everything else (pricing/drivers/dispatch/double-booking/trips/reporting) is pure
  Postgres — exactly Neon's strength. No gap.
- **Verdict: Neon delivers and maintains the FULL contract scope.** Auth.js is the
  one piece to build carefully (in a thin tested slice, together).

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
