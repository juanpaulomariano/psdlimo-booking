# Running costs — what this system costs to operate

Written to be shown to the client directly. Figures verified against Google's
published pricing on 2026-07-21. Nothing here is a guess; where something is an
estimate, it says so and shows the working.

**Headline: at the stated volume, the expected monthly cost is $0.**

---

## 1. What actually gets billed

Three Google APIs and one inbound webhook. Everything else in the stack
(GoHighLevel, the payment provider's callback, Vercel) bills separately or not
at all — see §5.

**Google changed its pricing model on 1 March 2025.** The old $200 monthly credit
is gone. It was replaced with **10,000 free calls per SKU per month** on the
Essentials tier. That is *per API*, not shared — so the three APIs below each get
their own 10,000.

| SKU | Free / month | Then, per 1,000 |
|---|---|---|
| Routes — Compute Route Matrix | 10,000 | $5.00 → $0.38 (volume tiers) |
| Places — Autocomplete (per request) | 10,000 | $2.83 → $0.21 |
| Places — Autocomplete (per session) | **unlimited** | — |
| Maps Static API | 10,000 | $2.00 → $0.15 |

---

## 2. How many calls one booking actually makes

This is the number that matters, and it is low by design.

### Routes API — ~2 calls per completed booking

Called once when the live quote is calculated, and **once again at checkout** to
re-price before charging. The second call is deliberate: it is what makes a
tampered browser price impossible, so it is a security cost, not waste.

Two things keep this from multiplying:

- **Only distance rides call it.** Hourly and fixed-route bookings are priced
  from the rate card and make **zero** Routes calls.
- **Quote requests are debounced by 400 ms.** Editing addresses, changing
  vehicle class, or toggling add-ons does not fire a call per keystroke.

A customer who edits their trip a few times might generate 3–5 quote calls.
Budget **~5 per booking** as a safe upper bound.

### Places Autocomplete — billed per *session*, not per keystroke

This is where a naive implementation gets expensive. Google bills autocomplete
**per session** when a session token is supplied — one token covers every
keystroke from first character to address selection.

Our implementation sends a session token and regenerates it after each
selection. So typing a 25-character address bills as **one session**, not 25
requests.

Session usage is on the **unlimited free** SKU. Two address fields per booking
≈ 2 sessions.

Additional guard: no request fires below **3 characters**.

### Maps Static API — ~1 call per booking, then cached

The route map is cached for **24 hours** at the CDN edge, keyed on the address
pair. A repeated A→B route is served from cache and costs nothing.

Realistically **1–2 calls per booking**.

---

## 3. Monthly cost at the client's stated volume

The brief describes roughly **15 leads per week ≈ 65 bookings/month**. Using
deliberately pessimistic assumptions — every booking is a distance ride, every
customer edits their trip several times, no caching benefit at all:

| API | Calls/booking (worst case) | 65 bookings | Free tier | Billable |
|---|---|---|---|---|
| Routes Matrix | 5 | 325 | 10,000 | **0** |
| Places Autocomplete | 2 sessions | 130 | unlimited | **0** |
| Maps Static | 2 | 130 | 10,000 | **0** |

### **Monthly Google cost: $0.00**

Not "negligible" — actually zero. Usage sits at roughly **3% of the free tier**.

### Where the free tier would actually run out

| Volume | Routes calls/mo | Status |
|---|---|---|
| 65 bookings/mo (stated) | ~325 | 3% of free tier |
| 500 bookings/mo | ~2,500 | 25% of free tier |
| **2,000 bookings/mo** | ~10,000 | **free tier exhausted** |
| 3,000 bookings/mo | ~15,000 | ~$25/mo |

**The business would need to grow roughly 30×** before Google appears on the
invoice at all. At 3,000 bookings/month the cost is around $25 — against
revenue that, at these fares, would be well into six figures.

---

## 4. The inbound webhook

**Cost: $0. There is no charge for the webhook, at any volume.**

To be explicit, because this gets asked: the webhook is not a product, a
subscription, or a metered service. It is a URL inside the application that
already exists. Nothing bills for it.

- the payment provider does not charge to send callbacks — that is part of
  taking the payment
- receiving one costs nothing: 65 bookings/month is 65 function invocations,
  which is inside the included allowance on every hosting tier
- the ~3 GoHighLevel API calls per booking are covered by the subscription the
  client already pays for

### IMPORTANT — this is NOT GoHighLevel's "Inbound Webhook"

Two different things share the word "webhook", and only one of them bills.

**GoHighLevel's Inbound Webhook is a Premium Workflow Action**, priced at
**$0.01 per execution** (100 free executions per sub-account, then charged). At
65 bookings/month that would be roughly $0.65/month, and it requires Premium
Actions to be enabled on the sub-account.

**We do not use it.** The distinction is the direction of traffic:

| | GHL Inbound Webhook | What we built |
|---|---|---|
| What it is | Premium action inside a GHL *workflow* | HTTP route in our own app |
| Who receives the request | GHL's servers | our application |
| Billing | $0.01/execution after 100 free | not a billable surface |
| Configured in | GHL workflow builder | `app/api/xendit-webhook/route.ts` |

```
GHL Inbound Webhook:  external system -> GHL workflow -> billed per execution
What we built:        Xendit -> OUR app -> GHL REST API
```

Premium Actions bill for **workflow executions inside GoHighLevel**. We never
enter the workflow builder. Our app receives the payment callback itself, then
makes ordinary authenticated REST calls — exactly two endpoints, plus a search:

```
POST /contacts/upsert
POST /opportunities/
GET  /opportunities/search      (the duplicate check)
```

These are standard API calls on a Private Integration token, not premium
workflow actions.

**Caveat, stated honestly:** GoHighLevel does not publish a hard API rate limit
for Private Integrations on standard plans, and they could change that policy.
At ~200 calls/month we are nowhere near any plausible limit, but this is
someone else's pricing page and worth re-checking at go-live. A change there
would affect every GHL integration, not only this one.

**The $20/month in §5 is HOSTING THE WHOLE SITE**, not the webhook. It would be
the same figure if the webhook did not exist.

### What the alternative would have cost

Had this been built on an automation platform (n8n, Zapier, Make), the bill
would be:

| | This build | With an automation platform |
|---|---|---|
| Hosting | ~$20/mo | ~$20/mo (still needed) |
| Automation platform | **—** | ~$20–50/mo, or self-hosting |
| Per-execution limits | **none** | grows with booking volume |

Handling the callback in the application removes an entire cost line rather than
adding one.

The payment provider does not charge for callbacks. Each paid booking sends one
POST to `/api/xendit-webhook`, which runs as a serverless function.

On Vercel's Hobby plan that is comfortably inside the included allowance — 65
bookings/month is 65 invocations plus retries. Even on the Pro plan
(see §5) the included quota is measured in millions.

What the webhook does cost is **GoHighLevel API calls**: roughly 3 per booking
(upsert contact, search for duplicates, create opportunity). GHL does not meter
API calls on standard plans — it is included in the subscription the client
already pays for.

---

## 5. Costs that are NOT Google

Stated for completeness so there are no surprises later.

| Item | Cost | Note |
|---|---|---|
| **Vercel hosting** | $0 now, **~$20/mo at go-live** | The free Hobby plan's terms are **non-commercial**. Capacity is not the issue — the licence is. Budget Vercel Pro, or port to Cloudflare Pages. |
| **GoHighLevel** | Existing subscription | No additional API charges |
| **Payment processing** | Per transaction | Set by whichever processor is used at go-live; not a fixed monthly cost |
| **Domain** | ~$15/yr | If a custom domain is wanted |

**Realistic all-in at go-live: ~$20/month**, and that is hosting, not APIs.

---

## 6. Cost controls already built in

Worth stating, because they are the reason the numbers above stay low:

1. **Session tokens on autocomplete** — bills per search, not per keystroke.
   Without this, a 25-character address costs 25 requests instead of 1.
2. **400 ms debounce on quotes** — editing a booking does not fire a Routes call
   per keystroke.
3. **3-character minimum** before any autocomplete request.
4. **24-hour edge cache on map images** — repeat routes are free.
5. **Hourly and fixed-route bookings make zero Routes calls** — they are priced
   from the rate card.
6. **API keys are restricted per service.** The public browser key cannot call
   Routes or Static Maps (verified: it returns 403). Someone lifting the key
   from the page source cannot run up a bill.

---

## 7. Recommended safety net

Google bills against a card, so a runaway loop or a scraped key could in
principle generate charges. Two protections, both free:

1. **Budget alert** — Google Cloud → Billing → Budgets & alerts. Set a $10/month
   budget with email alerts at 50% / 90% / 100%. At the volumes above this
   should never fire; if it does, something is wrong and you want to know.
2. **Per-API quota caps** — APIs & Services → each API → Quotas. Cap daily
   requests at, say, 500/day. Hard-stops any runaway before it costs money.

Neither affects normal operation at the stated volume.

---

## 8. One-line summary for the client

> Google Maps costs **$0/month** at your volume — you would need about 30× the
> bookings before the free tier runs out, and even then it is roughly $25/month.
> The only real running cost is hosting at about **$20/month** once we move off
> the free tier, which we have to do because its licence is non-commercial.

### If asked "so what do we actually pay for?"

**One thing: hosting, ~$20/month.** Everything else is $0 at this volume.

| | Cost |
|---|---|
| Our webhook endpoint | $0 — a URL in the app, not GHL's premium action |
| Google Maps APIs | $0 — 3% of the free tier |
| GoHighLevel REST API calls | $0 — in the existing subscription |
| Payment provider callbacks | $0 — part of taking the payment |
| **Hosting (the whole site)** | **~$20/mo** |

*If this had been built on GoHighLevel's Inbound Webhook premium action instead,
add ~$0.01 per booking plus enabling Premium Actions on the sub-account. Small,
but it is a line item we do not have.*

Payment processing fees are per-transaction and set by whichever processor is
used at go-live — a cost of doing business, not a cost of this system.

---

*Verified 2026-07-21 against Google Maps Platform published pricing. Google
retired the $200 monthly credit on 1 March 2025 and replaced it with 10,000 free
calls per SKU per month; the figures above use the current model.*
