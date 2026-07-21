# Demo notes — say these out loud, don't let the client discover them

Running list of demo-only shortcuts and constraints. Every item here is something
that is deliberately not production-grade. The point of writing them down is so
they get *stated* during the demo rather than found afterwards.

---

## 1. Xendit charges in PHP, the UI displays USD

**Status:** confirmed 2026-07-21 — this Xendit test account cannot issue USD invoices.

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

**Status: OUTSTANDING as of 2026-07-21.** Both keys in the Google Cloud project
currently show "35 APIs" — i.e. unrestricted.

This must be fixed before any public deployment:

| Key | Application restriction | API restriction |
|---|---|---|
| Server (`GOOGLE_MAPS_SERVER_KEY`) | None — server calls send no referrer | **Routes API only** |
| Browser (`NEXT_PUBLIC_MAPS_BROWSER_KEY`) | Websites: `http://localhost:3000/*`, `https://*.vercel.app/*` | **Places API (New) only** |

The browser key is embedded in the page and readable by anyone. Unrestricted, it
lets a stranger bill 35 Google APIs to the account owner's card. The server key is
never sent to the browser and is the only key permitted to call Routes API.

Add the production domain to the browser key's referrer list at go-live.

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
