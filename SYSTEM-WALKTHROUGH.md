# PSD Limo — How the System Works
### Mechanical walkthrough, written as source material for a demo-video script

**Context for whoever writes the script:** this is a booking, payment, dispatch and
CRM-automation platform for a San Francisco chauffeur company. Built solo. It is
deployed and live. Everything below has been executed and verified end-to-end —
none of it is aspirational.

**What the recording is for:** a job application. The viewer is likely an engineer
or hiring manager, not the client. Target length ~5 minutes.

---

## The three actors

1. **The customer** — books a ride on the public website, pays online.
2. **The owner** — logs into an admin area, sets prices, assigns drivers, prices
   custom quotes.
3. **The system** — does everything in between with no human involvement:
   pricing, payment verification, CRM records, calendar entries, emails.

---

## SCREEN 1 — The public booking page (`/`)

**What the viewer sees:** a dark, restrained single-page booking wizard. Three
steps, all on one screen.

### Step 1 — the ride
- Ride type: **Point to point · By the hour · Fixed route**
- Pickup and dropoff fields with **Google Places autocomplete** (real addresses
  appear as you type)
- A **round-trip toggle** — turning it on reveals return date/time fields
- Date, time, passengers, luggage

### Step 2 — vehicle and extras
- Four vehicle cards: Business Class, First Class, SUV/Van, Electric
- **Cards disable themselves** when the passenger count exceeds their capacity
- Add-ons as toggle buttons (Meet & Greet, Child Seat, Extra Stop)

### Step 3 — contact details
Name, email, phone, optional flight number (appears only for airport trips),
optional company, special requests.

### The live price panel — *this is the first "wow" moment*
As soon as pickup, dropoff and vehicle are set, a price appears with a **full
itemised breakdown**:

```
Base fare                    $45.00
Distance (12.4 mi × $4.50)   $55.80
First Class (×1.60)          $60.48
Meet & Greet                 $25.00
Service & fees (25%)         $46.57
─────────────────────────────────────
Total                          $233
```

Plus a **route map** and estimated drive time.

**Mechanically:** every keystroke-driven change (debounced 400ms) calls
`POST /api/quote`. The server calls the Google Routes API for real driving
distance, then runs the pricing engine. **The browser never calculates a price.**

Toggle an add-on → the price visibly recalculates. Change the vehicle → it
recalculates. That live responsiveness is the thing to show, not describe.

**The Pay button stays disabled until a server-confirmed price exists.**

---

## SCREEN 2 — Payment (hosted provider page)

Clicking **Confirm & Pay** calls `POST /api/checkout`, which:

1. **Recomputes the price from scratch** — the request contains no total field at
   all; there is structurally nowhere to put one
2. Re-checks the minimum lead time
3. Creates an invoice with the full booking payload attached as metadata
4. **Creates a "Pending payment" lead in the CRM** (the abandoned-checkout capture)
5. Returns the payment URL

The customer is redirected to the payment provider's own hosted page. **Card
details are typed there, never on our site** — no card-handling code exists in
this codebase.

Test card for the recording: `4000 0000 0000 1000`, exp `02/30`, CVV `123`.

---

## SCREEN 3 — Success page (`/success`)

Shows: **"Payment received"**, the booking reference, and a "Need to cancel?" link.

**Worth calling out in the script:** the wording is deliberately *not* "your ride
is confirmed." This page only knows that payment succeeded — the CRM record is
created by a separate server-to-server callback the page never sees. Claiming
confirmation would be a lie in exactly the case that matters (a delayed callback).
It is a small detail that demonstrates thinking about honesty in UI state.

---

## WHAT HAPPENS INVISIBLY (the 2 seconds after payment)

The payment provider sends a server-to-server callback to
`POST /api/xendit-webhook`. In order:

1. **Authenticate before reading the body** — a shared secret in the header,
   compared in constant time. A forged notification is rejected without its
   payload ever being parsed.
2. **Ignore non-payment events** (expired, pending) with a 200 so the provider
   stops retrying them.
3. **Load the booking** from the invoice and validate it against a schema.
4. **Check idempotency** — search the CRM for this payment reference.
   - Found, and it is a pending lead → **promote it in place**
   - Found, already confirmed → stop (a duplicate callback)
   - Not found → create it
5. **Write to the CRM**: contact, opportunity in *Confirmed*, calendar
   appointment, and all classification tags.
6. **Record the trip** in the dispatch database.

Failure modes are deliberate: a CRM outage returns **500 so the provider retries**
(the payment succeeded and must not be lost), while malformed data returns 400
because retrying cannot fix it.

---

## SCREEN 4 — The CRM (GoHighLevel)

**Pre-load this tab before recording.**

The booking is already there. Nobody typed it.

- **Pipeline board**: the opportunity sits in **Confirmed** with its monetary value
- **Opportunity detail**: pickup, dropoff, date *and time*, vehicle class (as a
  readable label, not an internal id), passengers, luggage, price, booking reference
- **Contact tags**, auto-derived from the ride's shape:
  `source.website` · `payment.paid` · `method.card` · `ride.airport`

The tag taxonomy is namespaced by concern — `source.*` (channel), `payment.*`
(outcome), `method.*` (how), `ride.*` (type), `lead.*` (nature). Tags are derived
from the trip itself: an SFO pickup produces `ride.airport`; over 50 miles produces
`ride.intercity`; 7+ passengers produces `ride.group`.

**Then show the inbox:** the confirmation email has already arrived, with the
correct pickup date *and time*, the vehicle's proper name, and the total.

---

## SCREEN 5 — Admin: Dispatch (`/admin/dispatch`) — *the strongest beat*

Login is role-guarded server-side; the admin link only appears for admin accounts.

**Three panels:** confirmed bookings, a driver dropdown on each, and a driver
roster below.

### The demo that lands
1. Assign a driver to a booking → **it works**
2. Assign the **same driver** to another booking **on the same day** → **refused**

> *"Marco Reyes is already assigned to booking psdlimo-… (Olivia Bennett) on
> Aug 15. A driver can only take one trip per day."*

**Why it is interesting technically:** the rule is enforced in a *single atomic SQL
statement* — the `UPDATE`'s `WHERE` clause itself excludes any conflicting same-day
trip, so the check and the write cannot race. A read-then-write would let two
simultaneous assignments both pass the check. The "same day" is computed as the
**Los Angeles** calendar day in SQL, so a 9 PM pickup is never miscounted as the
next day.

It **refuses** rather than warning — possible because this is our own UI and API.

A successful assignment syncs one-way to the CRM: the driver's name lands on the
opportunity and it moves to the *Assigned* stage, so the owner still sees
everything in the cockpit they already use.

---

## SCREEN 6 — Admin: Rates & pricing (`/admin`)

The owner changes their own pricing. No developer, no deployment.

- Base fare, per-mile, per-hour, service fee %, minimum fare, round-trip discount
- Vehicle multipliers
- **Add-ons: create, re-price, retire, restore**

**The demo:** create an add-on called "Champagne Service" at $75 → open the public
booking page → **it is already there** as a bookable option, and it prices
correctly.

**Mechanically:** the catalogue lives in the database, not in compiled code. The
rate card is the single source of truth for the booking form, the pricing engine,
and validation simultaneously. Retiring an add-on withdraws it from new bookings
while past bookings keep rendering it — and a retired add-on submitted by a stale
browser tab is never charged.

Rates are read through a **three-level fallback**: database → last-known-good →
code defaults. A database outage produces slightly stale prices, never a broken
quote.

---

## SCREEN 7 — The custom-quote pipeline

For trips a form cannot price: a wedding with four stops, flexible timing,
multiple vehicles.

### Customer side
From the booking page: *"Planning something more complex? **Request a custom
quote**"* → a light form: contact details, approximate date, party size, and a
free-text description of the trip.

Submitting creates a **lead** in the CRM (New Inquiry stage), tagged
`source.website` + `lead.quote-request`. The customer immediately receives an
acknowledgement; the owner is notified.

### Owner side — `/admin/quotes`
The request appears with the customer's details, **their requested date and party
size**, and their full itinerary text.

The owner sets: an **amount**, a **primary pickup date/time**, vehicle, party
size, and edits the itinerary. The date and passenger fields are **pre-filled from
what the customer asked for** — the owner confirms rather than retypes.

**A design point worth making in the script:** a complex trip's detail is *not*
forced into structured fields. Only the "anchor" the system needs — amount plus one
primary date/time — is structured. The four stops, the waiting time, the two
vehicles stay as free text that the owner and driver read. That is how humans
actually run a multi-stop job.

### The loop closes
"Send payment link" creates an invoice for that exact amount and writes the link
onto the CRM record. The customer receives it by email. **Paying it promotes the
existing lead to a confirmed booking** — the same record moves New Inquiry →
Confirmed, never a duplicate — and triggers a confirmation email built for custom
trips, showing the itinerary rather than empty pickup/dropoff fields.

---

## SCREEN 8 — The automation layer (7 CRM workflows)

| Fires when | Sends |
|---|---|
| Booking confirmed (standard) | Confirmation with route, time, vehicle, total |
| Booking confirmed (custom trip) | Confirmation showing the full itinerary |
| Appointment created | 24-hour pre-trip reminder |
| Ride marked completed | Tags the booking complete |
| That tag applied | Review request, sent immediately |
| Quote requested | Acknowledgement to customer + notify owner |
| Quote priced | Payment link to the customer |

**A decision worth mentioning:** the review request fires on *actual* completion —
a human marking the ride done — never on a scheduled end time. Traffic and delays
mean a timer would ask a customer to review a ride they are still sitting in.

---

## SECURITY — attack-tested, results verified

| Attack | Result |
|---|---|
| Edit the price in browser dev tools, then pay | **Real price charged.** The checkout schema has no total field — a client price is structurally unrepresentable |
| Forged "payment received" notification | **401** — rejected before the payload is read |
| Open admin pages / call admin APIs directly | **403** on every action; pages redirect to login |
| Brute-force the admin password (14 attempts) | **10 rejected, then rate-limited** |
| SQL injection (`' OR 1=1 --`, `DROP TABLE`) | **400** at validation; database verified intact |

Also: card data never touches the application, passwords are bcrypt hashes, the
session cookie is httpOnly + Secure + SameSite, the admin role is re-verified from
the database on every privileged request (so revoking access is immediate, not
whenever a token expires), and every SQL value is parameterised.

**Worth saying out loud:** the rate limiter runs per serverless instance and is
therefore approximate — a speed bump against abuse and runaway loops, not
protection against a distributed attacker. That limitation is documented in the
code with its upgrade path rather than overstated.

---

## THE SELF-AUDIT — the most distinctive thing about this project

After building it, I audited my own system against explicit lenses: *what should
be removed, what is over-engineered, how does each guarantee break, where does it
leak revenue, what will fail in production.* Fifteen findings, each with
file-level evidence, each labelled **verified** (I read the code or ran the test)
or **assumed** (platform behaviour I had not proven).

Real defects it caught in my own work:

- **Custom-quote payment links expired in 1 hour** — but were delivered by *email*.
  Every emailed quote on the highest-value bookings was dying before the customer
  could pay.
- **The success page claimed "your ride is confirmed"** while only knowing that
  payment had succeeded.
- **No rate limiting** on endpoints that spend real money per request — a billed
  Maps API and live invoice creation, both unauthenticated.
- **Admin role read from a 7-day token, never re-checked** — a revoked admin kept
  access for up to a week.
- **Dead database schema** that nothing read or wrote.

All fixed and verified live. Where a fix was imperfect, the limitation was written
into the code rather than papered over.

---

## Stack

Next.js (App Router) · TypeScript (strict) · React · Tailwind · Vercel ·
Neon Postgres · Zod · Google Routes & Places APIs · hosted payment provider ·
GoHighLevel CRM API · bcrypt + JWT

**Scale:** ~11,200 lines of TypeScript, 15 API routes, 79 automated checks,
7 CRM workflows, 80 commits.

---

## Recording notes (practical)

- **Pre-load every tab** — CRM, admin, inbox. Never record a loading spinner.
- **Seed demo data first** (`npm run seed:bookings`) so the dispatch board is not
  empty, and ensure two bookings share a date for the double-booking demo.
- **Skip the login** — nobody needs to watch a password being typed.
- **The CRM search index lags 1–3 seconds** after a record is created. Let data
  settle before recording.
- **Strongest single beat:** the dispatch double-booking refusal. Give it room.
- **Best 15-second security demo:** editing the price in dev tools and watching the
  real amount get charged.
- **First thing to cut if over time:** the custom-quote section — excellent, but
  the second-most-impressive thing.
