/**
 * /success?ref={external_id}
 *
 * The customer lands here after paying. This page is INTENTIONALLY DUMB: it
 * reads the reference from the URL and says thank you. It does not confirm the
 * booking, and it must not — a URL a customer can edit is not evidence of
 * payment.
 *
 * The booking becomes real when the verified provider callback reaches
 * /api/xendit-webhook. That is the only path that writes to the CRM.
 * See the project invariants (invariant 2).
 *
 * Next 16: searchParams is a Promise and must be awaited.
 */

import Link from "next/link";
import { CancellationButton } from "../components/CancellationButton";

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-24">
      <div className="animate-fade-rise">
        <div className="border-brass-400 mb-8 flex h-12 w-12 items-center justify-center rounded-full border">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden
            className="text-brass-400"
          >
            <path
              d="M4 10.5L8 14.5L16 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/*
          WORDING IS DELIBERATE. This page knows ONE thing for certain: the
          provider redirected here, so payment succeeded. It does NOT know the
          booking reached the CRM — that happens on a separate server-to-server
          callback this page never sees (and must not check: a customer-editable
          URL is not evidence). So we state the fact we have — payment received —
          and point at the confirmation email as the proof that follows. Saying
          "your ride is confirmed" would assert something we cannot verify, and
          would be a lie in the exact case that matters: a delayed or failed
          callback.
        */}
        <h1 className="font-display text-paper-100 text-4xl leading-tight">
          Payment received
        </h1>

        <p className="text-paper-300 mt-4 leading-relaxed">
          Thank you. Your confirmation is on its way to your inbox, and your chauffeur
          details will follow closer to the pickup time.
        </p>

        {ref && (
          <div className="border-ink-600 bg-ink-800/50 mt-10 rounded-sm border px-6 py-5">
            <p className="text-paper-300 text-xs tracking-[0.14em] uppercase">
              Booking reference
            </p>
            <p className="tnum text-paper-100 mt-2 font-mono text-sm break-all">{ref}</p>
            <p className="text-paper-500 mt-3 text-xs">
              Quote this reference in any correspondence about your booking.
            </p>
          </div>
        )}

        <div className="border-ink-700 mt-12 flex items-center justify-between border-t pt-8">
          <Link
            href="/"
            className="text-paper-300 hover:text-brass-400 text-sm transition-colors"
          >
            ← Book another ride
          </Link>
          <CancellationButton bookingRef={ref} />
        </div>
      </div>
    </main>
  );
}
