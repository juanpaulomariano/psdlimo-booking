"use client";

/**
 * The live price breakdown — the centrepiece of the demo.
 *
 * Two deliberate choices:
 *
 * 1. On re-quote we keep the PREVIOUS total on screen and dim it, rather than
 *    clearing to a spinner. A price that blinks to empty and back reads as
 *    instability in the exact moment the customer is deciding to trust it.
 *
 * 2. Every figure is tabular-nums. Proportional digits change width as they
 *    change value, so a live-updating price visibly jitters.
 */

import type { QuoteResponse } from "@/app/api/quote/route";

function money(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

type Props = {
  quote: QuoteResponse | null;
  loading: boolean;
  error: string | null;
  /** Bumped by the parent on each successful re-quote to retrigger the flash. */
  refreshKey: number;
};

export function PricePanel({ quote, loading, error, refreshKey }: Props) {
  if (error) {
    return (
      <div className="border-danger/40 bg-danger/5 rounded-sm border p-6">
        <p className="text-danger text-sm">{error}</p>
      </div>
    );
  }

  if (!quote && loading) {
    return (
      <div className="border-ink-600 bg-ink-800/50 rounded-sm border p-6">
        <div className="flex items-center gap-3">
          <div className="border-paper-500 border-t-brass-400 h-4 w-4 animate-spin rounded-full border-2" />
          <span className="text-paper-300 text-sm">Calculating your price…</span>
        </div>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="border-ink-600 rounded-sm border border-dashed p-6">
        <p className="text-paper-500 text-sm">
          Complete the ride details to see your price.
        </p>
      </div>
    );
  }

  const { breakdown, distanceMiles, durationMinutes, mocked } = quote;

  return (
    <div
      className={`border-ink-600 bg-ink-800/50 rounded-sm border transition-opacity duration-200 ${
        loading ? "opacity-50" : "opacity-100"
      }`}
      aria-busy={loading}
    >
      {mocked && (
        <p className="border-danger/40 bg-danger/10 text-danger border-b px-6 py-2 text-xs">
          Mock distance — USE_MOCK_MAPS is on. These prices are not real.
        </p>
      )}

      {distanceMiles !== null && (
        <div className="border-ink-600 text-paper-500 flex justify-between border-b px-6 py-3 text-xs">
          {/* "driving miles", not just "miles" — the map above shows a straight
              line, and this is the number the fare is actually based on. */}
          <span className="tnum">{distanceMiles.toFixed(1)} driving miles</span>
          {durationMinutes !== null && (
            <span className="tnum">≈ {durationMinutes} min in traffic</span>
          )}
        </div>
      )}

      <dl className="space-y-2.5 px-6 py-5">
        {breakdown.lines.map((line) => (
          <div key={line.key} className="flex items-baseline justify-between gap-4">
            <dt className="text-paper-300 text-sm">{line.label}</dt>
            <dd className="tnum text-paper-100 text-sm">{money(line.amount)}</dd>
          </div>
        ))}

        <div className="border-ink-600 flex items-baseline justify-between gap-4 border-t pt-3">
          <dt className="text-paper-300 text-sm">Service &amp; fees</dt>
          <dd className="tnum text-paper-100 text-sm">{money(breakdown.serviceFee)}</dd>
        </div>

        {breakdown.minimumApplied && (
          <p className="text-paper-500 pt-1 text-xs italic">
            Minimum fare applied.
          </p>
        )}
      </dl>

      <div className="border-ink-600 flex items-baseline justify-between border-t px-6 py-5">
        <span className="text-paper-300 text-xs tracking-[0.14em] uppercase">Total</span>
        <span
          // Remounts on each new quote so the settle animation replays.
          key={refreshKey}
          className="tnum animate-price-settle font-display text-brass-400 rounded-sm px-2 text-4xl"
        >
          {money(breakdown.total)}
        </span>
      </div>

      <p className="text-paper-500 px-6 pb-5 text-xs">
        All-inclusive. No hidden charges, no surge pricing.
      </p>
    </div>
  );
}
