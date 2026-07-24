/**
 * /admin — the owner dashboard. SERVER-GUARDED by role.
 *
 * This is the real security boundary. The "Admin Dashboard" button in the top
 * bar is UX; THIS check is what protects the page. A non-admin (or logged-out)
 * visitor who types the URL is redirected before any admin content renders.
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { RatesEditor } from "../components/RatesEditor";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/"); // logged in but not an admin → out

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
      <div className="animate-fade-rise">
        <p className="text-brass-400 mb-3 text-xs tracking-[0.2em] uppercase">Admin</p>
        <h1 className="font-display text-paper-100 text-4xl">Rates &amp; pricing</h1>
        <p className="text-paper-300 mt-3 max-w-lg text-[15px] leading-relaxed">
          Adjust your pricing here. Changes take effect on the next booking quote —
          no developer, no waiting. Everything about your customers and their
          bookings lives in your CRM.
        </p>

        <RatesEditor />

        <p className="text-paper-500 mt-10 text-xs">
          Signed in as {session.email} · Administrator access. A regular customer
          account cannot open this page.
        </p>
      </div>
    </main>
  );
}
