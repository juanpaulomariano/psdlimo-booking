/**
 * /admin — the owner dashboard. SERVER-GUARDED by role.
 *
 * This is the real security boundary. The "Admin Dashboard" button in the top
 * bar is UX; THIS check is what protects the page. A non-admin (or logged-out)
 * visitor who types the URL is redirected before any admin content renders.
 *
 * Placeholder for now — the rates editor (the demo payoff) lands in the next
 * slice. The point of this slice is proving the guard works.
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/"); // logged in but not an admin → out

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
      <div className="animate-fade-rise">
        <p className="text-brass-400 mb-3 text-xs tracking-[0.2em] uppercase">Admin</p>
        <h1 className="font-display text-paper-100 text-4xl">Dashboard</h1>
        <p className="text-paper-300 mt-3 max-w-lg text-[15px] leading-relaxed">
          Welcome, {session.name || session.email}. This is where you control your
          pricing and settings — the parts of the system that live on your website.
          Everything about your customers and their bookings lives in your CRM.
        </p>

        <div className="border-ink-600 mt-10 grid gap-3 sm:grid-cols-2">
          <div className="border-brass-400/40 bg-brass-400/5 rounded-sm border p-5">
            <h2 className="text-paper-100 text-sm font-medium">Rates &amp; pricing</h2>
            <p className="text-paper-500 mt-1.5 text-xs">
              Base fare, per-mile, per-hour, vehicle multipliers, add-ons, fees.
              <span className="text-brass-400"> Coming in the next step.</span>
            </p>
          </div>
          <div className="border-ink-600 rounded-sm border p-5 opacity-60">
            <h2 className="text-paper-300 text-sm font-medium">Settings</h2>
            <p className="text-paper-500 mt-1.5 text-xs">
              Lead time, minimum fare, service areas, contact details.
            </p>
          </div>
        </div>

        <p className="text-paper-500 mt-8 text-xs">
          You reached this page because your account has administrator access. A
          regular customer account cannot see or open it.
        </p>
      </div>
    </main>
  );
}
