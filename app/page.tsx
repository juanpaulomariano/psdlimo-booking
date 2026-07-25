import Link from "next/link";
import { BookingWizard } from "./components/BookingWizard";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
      <header className="mb-14">
        <p className="text-brass-400 mb-4 text-xs tracking-[0.2em] uppercase">
          San Francisco Bay Area
        </p>
        <h1 className="font-display text-paper-100 text-4xl leading-[1.1] sm:text-5xl">
          Book your chauffeur
        </h1>
        <p className="text-paper-300 mt-4 max-w-md text-[15px] leading-relaxed">
          Instant pricing, professional chauffeurs, and a confirmed booking in under two
          minutes.
        </p>
      </header>

      <BookingWizard />

      {/* Manual-quote path for complex trips (contract Phase 2). */}
      <div className="border-ink-700 mt-12 border-t pt-8">
        <p className="text-paper-300 text-sm">
          Planning something more complex — multiple stops, several vehicles, or a
          multi-day itinerary?{" "}
          <Link
            href="/quote"
            className="text-brass-400 hover:text-brass-300 underline underline-offset-4 transition-colors"
          >
            Request a custom quote
          </Link>
          .
        </p>
      </div>

      <footer className="border-ink-700 text-paper-500 mt-16 border-t pt-8 text-xs">
        <p>PSDLimo · Demonstration build · Test payments only</p>
      </footer>
    </main>
  );
}
