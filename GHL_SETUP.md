# GoHighLevel sandbox setup — click-by-click

Work through this in order. At the end, `npm run ghl:ids` verifies every item and
**fails loudly** if anything is missing or misnamed — so a typo here surfaces
immediately rather than as a silently empty field on demo day.

Budget ~25 minutes. The custom fields are the long part.

> **Naming matters.** The script matches on the **field key**, not the label.
> Where this doc gives a key like `pickup_location`, that exact string must end up
> in the field's key. GHL usually derives the key from the name you type, so
> entering the name exactly as written below produces the right key. After saving,
> click back into a field to confirm the key — if GHL generated something like
> `pickup_location_1`, fix it or tell me and I'll adjust the expected key.

---

## Step 1 — Confirm you are in the SANDBOX sub-account

Top-left account switcher. Everything below happens inside one sub-account, and
every ID we resolve belongs to it. Creating fields in the wrong sub-account is the
single easiest way to lose an hour.

Note the **Location ID**: **Settings → Business Profile**, or read it out of the
browser URL — `app.gohighlevel.com/v2/location/<LOCATION_ID>/...`

Send me that value.

---

## Step 2 — Pipeline

**Settings → Pipelines → Create new pipeline** (or *Opportunities → Pipelines*)

- Pipeline name: **`PSDLimo Bookings`**

Stages — the only one this build writes to is **Confirmed**, but the full set
makes the demo look like a real operation:

1. `New Inquiry`
2. `Quoted`
3. **`Confirmed`** ← paid bookings land here
4. `Assigned`
5. `In Progress`
6. `Completed`
7. `Cancelled`

A paid booking skips straight to **Confirmed** by design: payment already happened,
so New Inquiry and Quoted would be theatre.

---

## Step 3 — Opportunity custom fields (15)

**Settings → Custom Fields → Add Field**, and for each one set
**Object: Opportunity** (NOT Contact — this is the important part).

> **Why opportunity-level:** this is per-booking data. On a contact, a repeat
> customer's second booking would overwrite the first. On an opportunity, each
> booking keeps its own record. See CLAUDE.md.

| # | Field name (type exactly) | Type | Options / notes |
|---|---|---|---|
| 1 | `Pickup Location` | Single Line Text | |
| 2 | `Dropoff Location` | Single Line Text | |
| 3 | `Pickup Datetime` | Date Picker | |
| 4 | `Ride Type` | Dropdown (Single) | `distance`, `hourly`, `flat` |
| 5 | `Vehicle Class` | Dropdown (Single) | `business`, `first`, `suv-van`, `electric` |
| 6 | `Passenger Count` | Number | |
| 7 | `Luggage Count` | Number | |
| 8 | `Flight Number` | Single Line Text | |
| 9 | `Addons` | Single Line Text | stored as a comma-separated list |
| 10 | `Hours Booked` | Number | |
| 11 | `Quoted Price` | Monetary | |
| 12 | `Final Price` | Monetary | |
| 13 | `Booking Source` | Dropdown (Single) | `website`, `phone`, `email`, `referral` |
| 14 | `Special Requests` | Multi Line Text | |
| 15 | **`Payment Ref Id`** | Single Line Text | **the idempotency key — see below** |

**Field 15 is load-bearing.** It stores the Xendit `external_id`. Before creating
an opportunity the webhook searches for an existing one with this value; if found
it stops. That is what makes a duplicate or manually re-sent callback safe. Without
this field, a re-sent callback creates a second booking.

Dropdown option values must match **exactly** — they are written by the code, and
GHL silently drops a value that is not in the list. Lowercase, and note the hyphen
in `suv-van`.

---

## Step 4 — Contact custom fields (4)

Same screen, but **Object: Contact**. These describe the *person*, not the trip,
so they are safe to overwrite on a repeat booking.

| Field name | Type | Options |
|---|---|---|
| `Client Type` | Dropdown (Single) | `individual`, `corporate`, `vip` |
| `Preferred Vehicle` | Dropdown (Single) | `business`, `first`, `suv-van`, `electric` |
| `Lifetime Rides` | Number | |
| `Last Ride Date` | Date Picker | |

---

## Step 5 — Tags (6)

**Settings → Tags → Add Tag.** All lowercase, hyphenated, exactly:

```
source-website
service-airport
service-hourly
service-pointtopoint
pay-card
pay-paid
```

GHL will usually create a tag on the fly when applied, but pre-creating them means
a typo shows up now rather than as a stray `Service-Airport` on demo day.

Each booking receives `source-website`, `pay-card`, `pay-paid`, and exactly one
`service-*` derived from the ride.

---

## Step 6 — Private Integration token

**Settings → Private Integrations → Create new integration**

- Name: `PSDLimo Booking System`
- Scopes — tick these:

| Scope | Why |
|---|---|
| `contacts.write` | upsert the customer |
| `contacts.readonly` | find an existing contact before creating one |
| `opportunities.write` | create the booking |
| `opportunities.readonly` | **the idempotency search** — without this, duplicate protection cannot work |
| `locations/customFields.readonly` | let `npm run ghl:ids` resolve field IDs |
| `locations.readonly` | resolve the pipeline and stage IDs |

Copy the token **immediately** — GHL shows it once.

---

## Step 7 — Send me two values

```
GHL_LOCATION_ID   = <from step 1>
GHL_PRIVATE_TOKEN = <from step 6>
```

I will then run `npm run ghl:ids`, which:

- resolves every field above to its GHL field **ID**
- resolves the pipeline ID and the Confirmed stage ID
- writes them to `config/ghl-fields.json`
- **fails loudly, naming the exact field**, if anything is missing

Custom fields are always written by ID, never by key — key-writes are unreliable
across v2 endpoints, and resolving IDs up front validates this whole checklist in
one command.

---

## Common mistakes

- **Fields created on Contact instead of Opportunity.** The most common one. Only
  the four in Step 4 are contact fields; the other fifteen are opportunity fields.
- **Wrong sub-account.** Everything must live in the same one.
- **Dropdown values with capitals or spaces.** `SUV-Van` will not match `suv-van`.
- **Missing `opportunities.readonly`.** Everything appears to work until a
  duplicate callback creates a second booking — the exact failure the demo is
  meant to prove impossible.
