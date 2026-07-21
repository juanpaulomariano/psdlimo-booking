# How the booking reaches the CRM without n8n

Written to answer a specific question: *"How is data pushing into the CRM if we
didn't use n8n?"*

**Short answer: we DO use an inbound webhook. We just didn't need a middleman to
receive it.**

---

## The misconception

There is a common assumption that "webhook" means "a tool like n8n, Zapier or
Make." It does not. A webhook is simply **an HTTP request one system sends to
another when something happens** — nothing more.

n8n is one way to *receive* that request. An app that can receive HTTP requests
is another. Our app already is one.

---

## What we built

```
Customer pays on the payment page
          │
          │  Xendit sends an HTTP POST  ← this IS the inbound webhook
          ▼
https://psdlimo-booking.vercel.app/api/xendit-webhook
          │  (a route inside our own application)
          │
          │  1. verify the callback token       — is this really Xendit?
          │  2. check it is a PAID invoice      — ignore expiries
          │  3. load the booking                — from the invoice
          │  4. has this booking been recorded? — idempotency check
          ▼
GoHighLevel API v2
   contact + opportunity + custom fields + tags
```

The webhook is `app/api/xendit-webhook/route.ts` — about 150 lines. It is live
and you can see it respond right now:

```bash
curl https://psdlimo-booking.vercel.app/api/xendit-webhook
{"ok":true,"endpoint":"xendit-webhook",
 "note":"This endpoint accepts POST callbacks with a valid x-callback-token header."}
```

---

## The same flow, with and without n8n

**With an automation platform:**

```
Xendit → n8n webhook node → n8n HTTP node → GoHighLevel
             (3rd-party service in the middle of every payment)
```

**What we built:**

```
Xendit → our app → GoHighLevel
```

One fewer system. One fewer subscription. One fewer thing that can be down at
the moment a customer pays.

---

## Why doing it in-app is better here

This was a deliberate choice, not a shortcut.

### 1. The price has to be recomputed on the server

The single most important rule in this system: **never trust a price from the
browser.** When the customer clicks Pay, our server recalculates the fare from
the raw trip details before creating the invoice.

That has to happen in code that owns the pricing rules. An automation platform
sitting between the browser and the payment provider cannot do this — it would
have to take the price it was handed. In our build, a customer who edits the
price in their browser is still charged the correct amount, because the
submitted price is not merely ignored — there is nowhere in the request for it
to go.

### 2. Fewer moving parts at the moment money changes hands

Every system in the chain is a system that can fail. Payment succeeding but the
booking never reaching the CRM is the worst failure this system has, so the
chain is kept as short as possible.

### 3. Verification happens before anything is read

The webhook checks the callback token **before parsing the request body**, using
a constant-time comparison. A forged request is rejected outright:

```
no token      → 401
wrong token   → 401
valid token   → processed
```

That is one function in our code, not a checkbox on someone else's platform.

### 4. Duplicate payments cannot create duplicate bookings

Every booking carries a unique reference. Before creating anything, the webhook
searches the CRM for that reference — if it is already there, it stops and
returns success.

This means the same callback can arrive five times and still produce exactly one
booking. It is also what makes the recovery path safe: if the CRM is ever down,
the callback can be re-sent manually from the payment dashboard, and re-sending
is guaranteed not to double-book.

### 5. No per-execution cost, no plan tier to outgrow

Automation platforms bill per run or cap monthly executions. This is a route in
an app we already deploy. Its marginal cost is zero, and it does not become a
line item as booking volume grows.

---

## What n8n WOULD still be good for

To be fair, and to avoid overstating the case — an automation platform is a good
fit for:

- workflows the client wants to **edit themselves** without a developer
- connecting many tools together in ways that change often
- scheduled jobs, reminder sequences, follow-up campaigns

Notably, **GoHighLevel already has that built in.** Reminder sequences,
follow-ups, and dispatch notifications belong in GHL's own workflow builder,
where the client can change them without touching code.

What does *not* belong there is the money path. Taking a payment and recording
the booking is core business logic: it needs to be verified, idempotent, and
priced server-side. That is code.

---

## How to answer the question in one sentence

> We do use an inbound webhook — the payment provider posts to an endpoint inside
> the application itself, which verifies the request, re-checks the price, and
> writes to the CRM. n8n would only have been a middleman relaying that same
> request, so we removed it: fewer moving parts at the exact moment money changes
> hands, and no per-execution cost.

---

## Proving it live during the demo

1. Take a booking through to payment on the site.
2. Open the payment dashboard → **Webhooks / Callbacks log**. You will see the
   POST to `/api/xendit-webhook` with a `200` response.
3. Switch to GoHighLevel — the contact, the opportunity in **Confirmed**, every
   ride-detail field, and the tags are already there. Nobody typed anything.
4. **The strongest bit:** press **Resend** on that same callback in the payment
   dashboard. It returns `200` again — and GoHighLevel still shows exactly one
   booking. That is the idempotency check doing its job.
