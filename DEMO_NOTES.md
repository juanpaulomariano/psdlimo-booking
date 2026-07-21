# Demo notes — say these out loud, don't let the client discover them

Running list of demo-only shortcuts and constraints. Every item here is something
that is deliberately not production-grade. The point of writing them down is so
they get *stated* during the demo rather than found afterwards.

---

## 1. Xendit charges in PHP, the UI displays USD

**Status:** confirmed 2026-07-21 by calling the API directly, not by reading the
dashboard:

```
POST /v2/invoices  currency: USD
  -> {"error_code":"UNSUPPORTED_CURRENCY",
      "message":"currency USD is not configured in your settings yet"}

POST /v2/invoices  currency: PHP
  -> 201, invoice_url issued
```

So the conversion is genuinely required, not a precaution. Account: Virtulink
Digital Marketing Services. Test invoices are issued on `checkout-staging.xendit.co`.

Payment methods offered on the hosted page in this account: cards, plus the
Philippine e-wallets GCash, Maya, GrabPay and ShopeePay. Only the card path is
part of the demo script.

The system prices, displays, and records everything in **USD**. The hosted payment
page will show **PHP**, because that is the only currency this test account supports.

- Conversion happens in one place only: `lib/payments.ts`, at invoice creation.
- The USD amount is what goes into the invoice metadata and into GoHighLevel —
  the CRM never sees pesos.
- The rate (`XENDIT_USD_TO_PHP`) is a **fixed placeholder**, not a live FX feed.

**Why it does not matter at go-live:** funds must settle to the client's own US
account, so production will use a client-owned US processor (e.g. Stripe US)
charging USD directly. The conversion disappears entirely with that swap — and the
swap touches one file, by design.

**Say it like this:** "Payment is running through our Xendit test account, which is
Philippine-registered, so the test charge is denominated in pesos. Every price,
record, and CRM value is USD. At go-live this moves to your own US processor and
the conversion goes away."

---

## 1a. Test cards for the demo

From Xendit's own test-mode documentation (verified 2026-07-21). Do NOT use
Stripe's 4242 card — it is not Xendit's and will fail.

**Use this one for the demo — 3DS frictionless, no extra step:**

```
4000 0000 0000 1000     VISA, succeeds without a challenge screen
CVV: any 3 digits (123)
Expiry: any future date (02/30)
```

Alternatives:

| Card | Brand | Behaviour |
|---|---|---|
| `5200000000001005` | Mastercard | frictionless success |
| `4000000000002503` | VISA | 3DS **challenge** — a simulator appears; pick AUTHENTICATED to succeed, or any other option to force a failure |
| `5200000000002151` | Mastercard | 3DS challenge, same as above |

The challenge cards are the ones to use if the client asks to see a *failed*
payment: choose UNAUTHENTICATED at the simulator and the customer lands on
`/cancelled` with no CRM record — which is the behaviour worth showing.

---

## 2. All pricing numbers are placeholders

`config/rates.ts` carries a `PLACEHOLDER` banner and every rate is invented to
mirror the shape of the client's advertised pricing. Nothing has been signed off.

Assumptions the client must confirm (also listed in `PRICING_ASSUMPTIONS`):

- The vehicle-class multiplier applies to **flat routes** too, not just distance/hourly.
- The 25% service & fees charge is applied **after** add-ons.
- The minimum fare is a floor on the **final** total, after the service fee.
- Hourly rides ignore distance entirely — the hourly rate is all-inclusive.
- Gratuity is not collected at booking.

Swapping in real pricing means editing that one file.

---

## 3. Google API key restrictions

**Status: RESOLVED 2026-07-21.** Two keys, each restricted to exactly one API.

| Key | Application restriction | API restriction |
|---|---|---|
| Server (`GOOGLE_MAPS_SERVER_KEY`) | None — server calls send no referrer | **Routes API only** |
| Browser (`NEXT_PUBLIC_MAPS_BROWSER_KEY`) | Websites: `http://localhost:3000/*`, `https://*.vercel.app/*` | **Places API (New) only** |

Verified by calling both APIs with both keys — the restrictions are enforced, not
merely configured:

| | Routes API | Places API |
|---|---|---|
| Server key | 200 | **403** |
| Browser key | **403** | 200 |

This is the property worth stating: the browser key ships in the page source and
is readable by anyone, and it **cannot** call Routes API. Lifting it from
view-source buys an attacker nothing billable on the routing side.

**At go-live:** add the production domain to the browser key's referrer list.
Keep the two keys separate — never let one key serve both roles.

---

## 3a. Deferred enhancement — visible route map

**Decided 2026-07-21: build after the core loop works, not before.**

Distance calculation does not need a map and already works: `computeRouteMatrix`
returns driving miles server-side, and that figure is what prices the ride. A
visible map would be *presentation only*.

If added, the rules are:

- **Display only.** The price comes from the server's `computeRouteMatrix` figure
  and nothing else. If the map draws its own route (Directions API), its mileage
  can differ slightly — two disagreeing numbers on screen is worse than no map.
  Never let the map's distance reach the pricing engine.
- Requires **Maps JavaScript API** (and Directions API for a drawn polyline)
  enabled and added to the **browser** key — which makes item 3 above more
  urgent, not less. Do not add map APIs to an unrestricted public key.
- Billed separately from Routes API. Demo volume should sit inside the free tier,
  but it is additional surface on the billing account.

A Static Maps image (two pins, no interactive JS) is the cheaper alternative if
the goal is only "show the client it is geographically real".

---

## 3b. GHL quirks worth knowing before editing fields

**Tags use dots, not hyphens.** `source.website`, not `source-website`.
ARCHITECTURE.md originally said hyphens; the sandbox was built with dots and the
CRM wins. Code and docs now match the CRM.

**The custom-field UI displays dropdown values with hyphens stripped.** The
Vehicle Class field shows label `suv-van` with value `suvvan` in the GHL editor,
which looks like a mismatch that would break the write. It is not — the API
reports the real stored value:

```
GET /locations/{id}/customFields?model=opportunity
  opportunity.vehicle_class => ["business","first","suv-van","electric"]
```

The hyphen is intact. This was verified before assuming either way, because the
"fix" — mapping `suv-van` → `suvvan` in code — would have introduced a second
vocabulary and actually broken the write. **Trust the API, not the field editor.**

`npm run ghl:ids` checks picklist options against `config/rates.ts` on every run,
so if a dropdown value ever does drift, it fails loudly and names the field.

---

## 4. Hosting

Vercel free tier. Fine for demo volume; the go-live constraint is that the Hobby
plan's terms are non-commercial, not capacity. Production: Vercel Pro (~$20/mo) or
a Cloudflare Pages port.

---

## 5. No database — by design

The Xendit invoice metadata carries the booking between payment and CRM. There is
no datastore to breach, migrate, or keep in sync. GoHighLevel is the system of
record. This is a genuine architectural choice for this scope, not a shortcut —
but it does mean the booking payload must stay compact (see the metadata limits
note in `CLAUDE.md`).

---

## 5a. Xendit's "Test and save" button returns 400 — this is correct

Pressing **Test and save** on the webhook config sends Xendit's canned sample
payload, which looks like this:

```json
{ "id": "579c8d61f23fa4ca35e52da4",
  "external_id": "invoice_123124123",
  "status": "PAID", "amount": 50000, "bank_code": "PERMATA" }
```

Note what is absent: **no `metadata`**. It is a generic sample, not a PSDLimo
booking. The endpoint responds `400 {"error":"Booking metadata is not valid"}`.

That is the system working:

1. the callback token was **verified** — a 400 rather than a 401 is the proof
   the token matches, which is the only thing the test button can usefully tell us
2. the status `PAID` was recognised as actionable
3. the payload was rejected because there is no booking in it
4. **400, not 500** — retrying cannot fix a malformed payload, so Xendit is told
   not to retry

A dummy payload silently creating a CRM record would be the actual bug.

Webhook settings to use:

- ☑ **Invoices paid** → `https://psdlimo-booking.vercel.app/api/xendit-webhook`
- ☐ *Also notify when an invoice has expired* — leave OFF. Expiry is not an
  event we act on; see item 6.
- ☐ *Also notify when a payment has been received after expiry* — leave OFF.
  It would create a booking for a ride whose pickup time may already have
  passed. Out of scope, and an untested path.

---

## 6. Things that look like bugs but are correct

Worth pre-empting, because a client will spot these and ask:

- **An abandoned payment page leaves no CRM record.** The invoice expires on its
  own. No PAID callback fires, so nothing is written. That is the intended
  behaviour — the CRM contains paid bookings, not browsing history.
- **Re-sending a callback from the Xendit dashboard creates nothing new.** The
  handler is idempotent on `payment_ref_id`. This is the demo-day recovery move if
  a callback ever fails, and it is always safe to press.
- **Editing the booking after reaching the payment page creates a second invoice.**
  The first is simply abandoned and expires. Only the paid one reaches the CRM.
