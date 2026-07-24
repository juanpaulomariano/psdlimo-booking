/**
 * /admin/dispatch — assign drivers to confirmed bookings, and manage the roster.
 * SERVER-GUARDED by role, exactly like /admin.
 *
 * This page is the owner's dispatch cockpit for driver assignment. The core rule
 * — one driver = one trip per day — is enforced by the API it calls, not the UI;
 * the UI just surfaces the block clearly. See lib/trips.ts assignDriverForDay.
 */

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AdminNav } from "../../components/AdminNav";
import { DispatchBoard } from "../../components/DispatchBoard";

export default async function DispatchPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-14">
      <div className="animate-fade-rise">
        <p className="text-brass-400 mb-3 text-xs tracking-[0.2em] uppercase">Admin</p>
        <h1 className="font-display text-paper-100 text-4xl">Dispatch</h1>
        <p className="text-paper-300 mt-3 max-w-xl text-[15px] leading-relaxed">
          Assign a chauffeur to each confirmed booking. A driver can only take one
          trip per day — if they&apos;re already booked that day, the assignment is
          blocked so no one is ever double-booked. Assignments are mirrored to your
          CRM automatically.
        </p>

        <AdminNav current="dispatch" />

        <DispatchBoard />

        <p className="text-paper-500 mt-10 text-xs">
          Signed in as {session.email} · Administrator access.
        </p>
      </div>
    </main>
  );
}
