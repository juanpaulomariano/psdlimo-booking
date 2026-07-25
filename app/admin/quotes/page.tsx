/**
 * /admin/quotes — price custom-quote requests. SERVER-GUARDED by role.
 *
 * Lists the New Inquiry quote leads that haven't been priced yet. The owner sets
 * an amount + a primary pickup date/time + the itinerary, and sends the payment
 * link. See /api/admin/quotes and lib/quotes.ts.
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AdminNav } from "../../components/AdminNav";
import { QuotesBoard } from "../../components/QuotesBoard";

export default async function QuotesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-14">
      <div className="animate-fade-rise">
        <p className="text-brass-400 mb-3 text-xs tracking-[0.2em] uppercase">Admin</p>
        <h1 className="font-display text-paper-100 text-4xl">Quotes</h1>
        <p className="text-paper-300 mt-3 max-w-xl text-[15px] leading-relaxed">
          Custom-trip requests waiting for a price. Set the amount and a primary
          pickup time, then send the payment link — when the customer pays, the
          booking confirms itself.
        </p>

        <AdminNav current="quotes" />

        <QuotesBoard />

        <p className="text-paper-500 mt-10 text-xs">
          Signed in as {session.email} · Administrator access.
        </p>
      </div>
    </main>
  );
}
