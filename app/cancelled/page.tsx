/**
 * /cancelled?ref={external_id}
 *
 * The customer abandoned or failed the payment. NOTHING NEEDS CLEANING UP: the
 * invoice simply expires on its own, no PAID callback ever fires, and no CRM
 * record was ever created. That is correct behaviour, not a leak.
 * See DEMO_NOTES.md item 6.
 *
 * The tone here matters — a failed payment is usually a mistyped card, not a
 * decision to abandon. So: no alarm, no blame, one obvious way back.
 */

import Link from "next/link";

export default async function CancelledPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-24">
      <div className="animate-fade-rise">
        <h1 className="font-display text-paper-100 text-4xl leading-tight">
          Payment not completed
        </h1>

        <p className="text-paper-300 mt-4 leading-relaxed">
          Your booking has not been charged and nothing has been reserved. If something went
          wrong with the payment, you can start again — it only takes a moment.
        </p>

        {ref && (
          <p className="text-paper-500 mt-8 font-mono text-xs break-all">
            Reference: {ref}
          </p>
        )}

        <div className="mt-12">
          <Link
            href="/"
            className="bg-brass-400 text-ink-900 hover:bg-brass-500 inline-flex items-center rounded-sm px-8 py-3.5 text-sm font-medium tracking-wide transition-colors"
          >
            Start a new booking
          </Link>
        </div>
      </div>
    </main>
  );
}
