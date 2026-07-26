/**
 * Per-IP rate limiting for the public endpoints that SPEND MONEY on each call.
 *
 * WHY THIS EXISTS (a named failure, not hygiene): `/api/quote` calls the BILLED
 * Google Routes API on every request with `cache: "no-store"`, and `/api/checkout`
 * creates a real invoice at the payment provider. Both are unauthenticated. A
 * trivial loop against either turns a $0 line item into a real bill on the
 * client's card, or floods the provider dashboard with junk invoices.
 *
 * ── HONEST LIMITATION — READ THIS BEFORE TRUSTING IT ──────────────────────────
 * The counter is IN-MEMORY and therefore PER SERVERLESS INSTANCE. Vercel may run
 * several instances concurrently, so the effective ceiling is roughly
 * (limit × instances), not (limit). This is a SPEED BUMP that stops casual abuse
 * and accidental client loops — it is NOT a security control and will not stop a
 * determined distributed attacker.
 *
 * That is a deliberate trade: a correct global limiter needs shared state (Redis
 * / Vercel KV), which is another service, another bill, and another failure mode
 * for a 65-booking/month operation. If abuse is ever observed in production, the
 * upgrade path is to swap the store behind this same `checkRateLimit()` signature
 * — no caller changes.
 *
 * Memory is bounded: expired buckets are swept on write, so the map cannot grow
 * without limit on a long-lived instance.
 */

import "server-only";

type Bucket = { count: number; resetAt: number };

/** ip+scope → bucket. Module state: lives for this instance's lifetime. */
const buckets = new Map<string, Bucket>();

/** Sweep expired entries so a long-lived instance can't leak memory. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Best-effort client IP. Vercel sets `x-forwarded-for` (client first in the
 * chain) and `x-real-ip`. Falls back to a shared bucket when neither is present,
 * which is the SAFE direction: unknown callers share one allowance rather than
 * each getting a fresh one.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export type RateLimitResult = {
  ok: boolean;
  /** Seconds until the window resets — sent as Retry-After when blocked. */
  retryAfterSeconds: number;
};

/**
 * Count one request against `scope` for this IP.
 *
 * @param scope   an identifier per endpoint, so a quote burst cannot exhaust the
 *                checkout allowance (and vice versa).
 * @param limit   requests permitted per window.
 * @param windowMs length of the window.
 */
export function checkRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const key = `${scope}:${clientIp(request)}`;

  // Cheap amortised cleanup — only when the map has grown enough to matter.
  if (buckets.size > 500) sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Limits, chosen against real usage rather than guessed:
 *
 * QUOTE — the wizard debounces at 400ms (BookingWizard QUOTE_DEBOUNCE_MS) and a
 * customer editing addresses fires a handful of quotes a minute. 40/min leaves
 * enormous headroom for a legitimate session while capping a script.
 *
 * CHECKOUT — a human creates one invoice, maybe three across retries. 8/min is
 * far beyond honest use.
 *
 * AUTH — login/register are password endpoints; 10/min per IP slows credential
 * stuffing without troubling someone who mistyped twice.
 */
export const RATE_LIMITS = {
  quote: { limit: 40, windowMs: 60_000 },
  checkout: { limit: 8, windowMs: 60_000 },
  auth: { limit: 10, windowMs: 60_000 },
  quoteRequest: { limit: 5, windowMs: 60_000 },
} as const;
