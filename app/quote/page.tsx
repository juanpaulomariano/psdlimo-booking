/**
 * /quote — "Request a Quote" for complex trips.
 *
 * The manual-quotation path required by contract Phase 2 ("manual quotation
 * requests for complex bookings"). For trips the instant-booking rules can't
 * price: multi-stop, multi-day, multiple vehicles, unusual routing. Submitting
 * creates a lead in the CRM; no price and no payment here.
 */

import Link from "next/link";
import { QuoteRequestForm } from "../components/QuoteRequestForm";

export const metadata = {
  title: "Request a Quote — PSD Limo",
  description: "Request a tailored quote for a complex or custom chauffeur trip.",
};

export default function QuotePage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <div className="animate-fade-rise">
        <Link
          href="/"
          className="text-paper-500 hover:text-brass-400 text-sm transition-colors"
        >
          ← Back to instant booking
        </Link>

        <p className="text-brass-400 mt-8 mb-3 text-xs tracking-[0.2em] uppercase">
          Custom trips
        </p>
        <h1 className="font-display text-paper-100 text-4xl leading-tight">
          Request a quote
        </h1>
        <p className="text-paper-300 mt-4 max-w-xl leading-relaxed">
          Some journeys don&apos;t fit a standard fare — multiple stops, several
          vehicles, a multi-day itinerary, or waiting time between legs. Tell us what
          you need and we&apos;ll prepare a tailored quote, personally.
        </p>

        <QuoteRequestForm />
      </div>
    </main>
  );
}
