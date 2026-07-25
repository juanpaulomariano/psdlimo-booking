/**
 * PROVIDER BOUNDARY — the only file in this codebase that knows Xendit exists.
 *
 * Everything above this file speaks in the neutral vocabulary declared here:
 * createInvoice / verifyCallback / parseCallback. At go-live the processor must
 * become client-owned (funds have to settle to a US account), and that swap has
 * to touch THIS FILE ONLY. If you find yourself importing Xendit anywhere else,
 * or leaking an `invoice.*` field shape upward, the boundary has already broken.
 *
 * See the project invariants (invariant 6).
 *
 * Implementation note: we call the REST API directly with fetch rather than the
 * xendit-node SDK. The surface we need is two endpoints, and a direct call keeps
 * the swap boundary honest — no SDK types escape this module.
 */

import "server-only";
import { timingSafeEqual } from "node:crypto";
import { USD_TO_PHP_FALLBACK } from "@/config/rates";
import type { BookingMetadata } from "@/lib/booking-schema";

const XENDIT_API = "https://api.xendit.co";

/** How long a customer has to complete payment before the invoice expires. */
const INVOICE_DURATION_SECONDS = 60 * 60; // 1 hour

/* ══════════════════════════════════════════════════════════════════════════
 * Neutral types — deliberately provider-agnostic.
 * ══════════════════════════════════════════════════════════════════════════ */

export type CreateInvoiceInput = {
  /** Our booking reference. Also the idempotency key. Generated ONCE upstream. */
  externalId: string;
  /** The true price, in USD. Always USD regardless of what we charge in. */
  amountUSD: number;
  customer: { name: string; email: string; phone: string };
  description: string;
  metadata: BookingMetadata;
  successUrl: string;
  failureUrl: string;
};

export type CreateInvoiceResult = {
  /** Where to send the customer to pay. */
  invoiceUrl: string;
  /** The provider's own id — logged for support, never used as a key. */
  providerInvoiceId: string;
  /** What we actually charged, after any conversion. */
  chargedAmount: number;
  chargedCurrency: string;
};

/** A verified, PAID payment event. Only produced for callbacks we should act on. */
export type PaidCallback = {
  externalId: string;
  status: "PAID" | "SETTLED";
  providerInvoiceId: string;
  paidAmount: number;
  paidCurrency: string;
  /** Raw metadata — the caller validates it with bookingMetadataSchema. */
  metadata: Record<string, unknown>;
  /** "CREDIT_CARD", "EWALLET", … — used for the GHL pay-* tag. */
  paymentMethod: string;
};

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code: "MISSING_KEY" | "API_ERROR" | "INVALID_AMOUNT",
    /** Provider response body, for logs. Never shown to the customer. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Currency
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The currency we can actually charge in. USD everywhere in the business; PHP
 * on this demo account because Xendit rejects USD invoices for it.
 * See config/rates.ts.
 */
function chargeCurrency(): string {
  return (process.env.XENDIT_CURRENCY ?? "PHP").toUpperCase();
}

function usdToPhpRate(): number {
  const raw = process.env.XENDIT_USD_TO_PHP;
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : USD_TO_PHP_FALLBACK;
}

/**
 * Convert the true USD price into the currency the invoice is denominated in.
 *
 * This exists ONLY because of the demo account's PHP restriction. The USD figure
 * remains the source of truth: it is what the UI shows, what goes into invoice
 * metadata, and what lands in the CRM. The converted number is used for exactly
 * one thing — telling the payment provider how much to collect.
 */
export function toChargeAmount(amountUSD: number): { amount: number; currency: string } {
  const currency = chargeCurrency();
  if (currency === "USD") return { amount: Math.round(amountUSD), currency };
  if (currency === "PHP") {
    // Whole pesos — Xendit rejects sub-unit precision on PHP invoices.
    return { amount: Math.round(amountUSD * usdToPhpRate()), currency };
  }
  throw new PaymentError(
    `XENDIT_CURRENCY is set to "${currency}", which this build does not know how to convert to. ` +
      `Use USD or PHP, or add a conversion in lib/payments.ts.`,
    "INVALID_AMOUNT",
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Auth
 * ══════════════════════════════════════════════════════════════════════════ */

function authHeader(): string {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) {
    throw new PaymentError(
      "XENDIT_SECRET_KEY is not set. Add it to .env.local (see .env.example).",
      "MISSING_KEY",
    );
  }
  // Xendit uses HTTP Basic with the secret key as username and an empty password.
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * createInvoice
 * ══════════════════════════════════════════════════════════════════════════ */

export async function createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const { amount, currency } = toChargeAmount(input.amountUSD);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentError(`Refusing to create an invoice for ${amount} ${currency}.`, "INVALID_AMOUNT");
  }

  // Xendit metadata values must be flat scalars. bookingMetadataSchema already
  // guarantees that shape; this cast documents the contract at the boundary.
  const metadata: Record<string, string | number> = Object.fromEntries(
    Object.entries(input.metadata).map(([k, v]) => [k, v === null || v === undefined ? "" : v]),
  ) as Record<string, string | number>;

  let response: Response;
  try {
    response = await fetch(`${XENDIT_API}/v2/invoices`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        external_id: input.externalId,
        amount,
        currency,
        description: input.description,
        invoice_duration: INVOICE_DURATION_SECONDS,
        payer_email: input.customer.email,
        customer: {
          given_names: input.customer.name,
          email: input.customer.email,
          mobile_number: input.customer.phone,
        },
        success_redirect_url: input.successUrl,
        failure_redirect_url: input.failureUrl,
        metadata,
        // The booking is confirmed by our own callback handler, not by email.
        should_send_email: false,
      }),
      cache: "no-store",
    });
  } catch (err) {
    throw new PaymentError(
      `Could not reach the payment provider: ${err instanceof Error ? err.message : String(err)}`,
      "API_ERROR",
    );
  }

  const body = await response.text();

  if (!response.ok) {
    // Xendit puts the actionable detail in the body — log it, never surface it.
    console.error(`[payments] createInvoice ${response.status}: ${body}`);
    throw new PaymentError("The payment provider rejected the request.", "API_ERROR", body);
  }

  let parsed: { id?: string; invoice_url?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new PaymentError("The payment provider returned an unreadable response.", "API_ERROR", body);
  }

  if (!parsed.invoice_url || !parsed.id) {
    throw new PaymentError(
      "The payment provider did not return a payment URL.",
      "API_ERROR",
      body,
    );
  }

  return {
    invoiceUrl: parsed.invoice_url,
    providerInvoiceId: parsed.id,
    chargedAmount: amount,
    chargedCurrency: currency,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * verifyCallback
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Verify an incoming callback is genuinely from the provider.
 *
 * Xendit authenticates callbacks with a shared secret in the `x-callback-token`
 * HEADER — NOT a signature over the body. So there is nothing to recompute; we
 * compare the header to our stored token.
 *
 * The comparison is constant-time. A plain `===` returns as soon as it finds a
 * differing byte, and that timing difference is measurable over many requests —
 * enough to recover the token one byte at a time. timingSafeEqual always reads
 * both buffers fully.
 *
 * CALL THIS BEFORE READING THE BODY. An unverified request should never have its
 * payload parsed, let alone acted on.
 */
export function verifyCallback(headers: Headers): boolean {
  const expected = process.env.XENDIT_CALLBACK_TOKEN;
  if (!expected) {
    // Fail closed. A missing secret must never mean "let everything through".
    console.error(
      "[payments] XENDIT_CALLBACK_TOKEN is not set — rejecting all callbacks. " +
        "Set it from the Xendit dashboard (Settings -> Webhooks).",
    );
    return false;
  }

  const received = headers.get("x-callback-token");
  if (!received) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);

  // timingSafeEqual throws on length mismatch, which would itself leak length.
  // Comparing a fixed-length digest of each would also work; here we simply
  // reject differing lengths, since the token length is not the secret.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/* ══════════════════════════════════════════════════════════════════════════
 * fetchBookingMetadata
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Fetch the booking payload for a paid invoice.
 *
 * WHY THIS EXISTS — a real failure, found only by paying with a real card:
 *
 * Xendit's invoice callback does NOT include the `metadata` you attached at
 * creation. The callback carries id / external_id / status / amount and little
 * else. Reading `metadata` off the callback body yields undefined, so every
 * field fails validation and the booking never reaches the CRM.
 *
 * This was invisible in testing because the test payloads were hand-written
 * WITH a metadata block — i.e. they tested the assumption rather than Xendit's
 * actual behaviour. The lesson: synthesise payloads from
 * the provider's real output, never from your own expectation of it.
 *
 * So: the callback tells us WHICH invoice was paid, and we fetch the booking
 * from the invoice itself. That is also the more trustworthy order — the
 * payload now comes from an authenticated API read rather than from the request
 * body, so it cannot be spoofed even if the callback token ever leaked.
 */
export async function fetchBookingMetadata(externalId: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(
      `${XENDIT_API}/v2/invoices?external_id=${encodeURIComponent(externalId)}`,
      { headers: { Authorization: authHeader() }, cache: "no-store" },
    );
  } catch (err) {
    throw new PaymentError(
      `Could not reach the payment provider to load invoice ${externalId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      "API_ERROR",
    );
  }

  const body = await response.text();

  if (!response.ok) {
    console.error(`[payments] invoice lookup ${response.status}: ${body}`);
    throw new PaymentError(`Could not load invoice ${externalId}.`, "API_ERROR", body);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new PaymentError(`Invoice lookup returned unreadable JSON.`, "API_ERROR", body);
  }

  // Querying by external_id returns an array; be tolerant of a bare object too.
  const invoice = Array.isArray(parsed) ? parsed[0] : parsed;

  if (!invoice || typeof invoice !== "object") {
    throw new PaymentError(`No invoice found for ${externalId}.`, "API_ERROR", body);
  }

  const metadata = (invoice as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") {
    throw new PaymentError(
      `Invoice ${externalId} carries no booking metadata. It was probably not created by ` +
        `this application — Xendit's own webhook test payload looks like this.`,
      "API_ERROR",
    );
  }

  return metadata as Record<string, unknown>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * parseCallback
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Interpret a verified callback body.
 *
 * Returns null for every event we should acknowledge but NOT act on — expired
 * invoices, pending states, unknown shapes. The caller returns 200 for those:
 * a non-200 would make the provider retry a callback we are deliberately
 * ignoring, forever.
 *
 * Only PAID and SETTLED produce a booking.
 */
export function parseCallback(body: unknown): PaidCallback | null {
  if (typeof body !== "object" || body === null) return null;

  const event = body as {
    id?: unknown;
    external_id?: unknown;
    status?: unknown;
    amount?: unknown;
    paid_amount?: unknown;
    currency?: unknown;
    payment_method?: unknown;
    payment_channel?: unknown;
    metadata?: unknown;
  };

  const status = typeof event.status === "string" ? event.status.toUpperCase() : "";
  if (status !== "PAID" && status !== "SETTLED") {
    // EXPIRED lands here and is correct behaviour, not an error: an abandoned
    // invoice leaves no CRM record by design.
    return null;
  }

  const externalId = typeof event.external_id === "string" ? event.external_id : "";
  if (!externalId) {
    console.error("[payments] PAID callback with no external_id — cannot key the booking.");
    return null;
  }

  const paidAmount =
    typeof event.paid_amount === "number"
      ? event.paid_amount
      : typeof event.amount === "number"
        ? event.amount
        : 0;

  return {
    externalId,
    status,
    providerInvoiceId: typeof event.id === "string" ? event.id : "",
    paidAmount,
    paidCurrency: typeof event.currency === "string" ? event.currency : "",
    metadata:
      typeof event.metadata === "object" && event.metadata !== null
        ? (event.metadata as Record<string, unknown>)
        : {},
    paymentMethod:
      typeof event.payment_method === "string"
        ? event.payment_method
        : typeof event.payment_channel === "string"
          ? event.payment_channel
          : "UNKNOWN",
  };
}
