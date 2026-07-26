import Link from "next/link";
import { BookingWizard } from "./components/BookingWizard";
import { getRateCard } from "@/lib/rates-source";

/**
 * The booking page reads the CURRENT add-on catalogue server-side and hands it to
 * the wizard. This is what makes owner-created add-ons appear without a deploy:
 * the rate card is the single source of truth, and it comes from the database.
 *
 * Rendered per-request so a newly created add-on is visible immediately rather
 * than on the next build.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const rateCard = await getRateCard();
  const addOnCatalogue = Object.entries(rateCard.addOnPrices).map(([id, a]) => ({
    id,
    label: a.label,
    blurb: a.blurb,
    price: a.price,
  }));

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

      <BookingWizard addOnCatalogue={addOnCatalogue} />

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
