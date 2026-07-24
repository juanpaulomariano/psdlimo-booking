"use client";

/**
 * DispatchBoard — the owner's driver-assignment screen.
 *
 * Two panels: the confirmed-bookings list (each with a driver dropdown), and the
 * roster panel (add / edit / retire drivers) on the same page. The one-trip-per-
 * day rule is enforced server-side; here we just render its block message inline
 * on the booking that was refused.
 */

import { useEffect, useState } from "react";
import { formatPickup } from "@/lib/datetime";
import { PrimaryButton, GhostButton } from "./ui";

type Driver = { id: string; name: string; phone: string; email: string; active: boolean };
type Booking = {
  external_id: string;
  customer_name: string;
  pickup_at: string;
  ends_at: string;
  pickup_location: string;
  dropoff_location: string;
  vehicle_class: string;
  status: string;
  driver_id: string | null;
  driver_name: string | null;
  ghl_opportunity_id: string;
};

export function DispatchBoard() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-booking inline message (block reason or a transient success).
  const [rowMsg, setRowMsg] = useState<Record<string, { kind: "error" | "ok"; text: string }>>({});
  const [busyRow, setBusyRow] = useState<string | null>(null);

  // Fetch the board (bookings + roster). Called on mount and after any roster
  // change so the dropdowns stay in sync. Defined as a plain function and invoked
  // from an inline effect, matching the fetch-on-mount pattern used elsewhere.
  async function load() {
    try {
      const res = await fetch("/api/admin/dispatch");
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as { bookings: Booking[]; drivers: Driver[] };
      setBookings(data.bookings);
      setDrivers(data.drivers);
    } catch {
      setLoadError("Could not load dispatch data. Please refresh.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Mount-only fetch. State is set inside the async load (after an await), not
    // synchronously in this effect body — the disable documents that this is the
    // intended fetch-on-mount pattern, not an accidental synchronous setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const activeDrivers = drivers.filter((d) => d.active);

  async function assign(externalId: string, driverId: string | null) {
    setBusyRow(externalId);
    setRowMsg((m) => ({ ...m, [externalId]: undefined as never }));
    try {
      const res = await fetch("/api/admin/dispatch/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ external_id: externalId, driver_id: driverId }),
      });
      const data = await res.json();

      if (res.status === 409 && data.reason === "blocked") {
        // Refused — show why, and DON'T change the local assignment.
        setRowMsg((m) => ({ ...m, [externalId]: { kind: "error", text: data.message } }));
        return;
      }
      if (!res.ok) {
        setRowMsg((m) => ({
          ...m,
          [externalId]: { kind: "error", text: data.error ?? "Could not save that." },
        }));
        return;
      }

      // Success — reflect it locally without a full reload.
      setBookings((bs) =>
        bs.map((b) =>
          b.external_id === externalId
            ? {
                ...b,
                driver_id: driverId,
                driver_name: driverId ? (data.driver?.name ?? b.driver_name) : null,
                status: driverId ? "assigned" : "booked",
              }
            : b,
        ),
      );
      setRowMsg((m) => ({
        ...m,
        [externalId]: { kind: "ok", text: driverId ? "Assigned." : "Unassigned." },
      }));
      window.setTimeout(
        () => setRowMsg((m) => ({ ...m, [externalId]: undefined as never })),
        2500,
      );
    } catch {
      setRowMsg((m) => ({
        ...m,
        [externalId]: { kind: "error", text: "Network error. Please try again." },
      }));
    } finally {
      setBusyRow(null);
    }
  }

  if (loading) {
    return <p className="text-paper-400 mt-8 text-sm">Loading dispatch…</p>;
  }
  if (loadError) {
    return <p className="text-danger mt-8 text-sm">{loadError}</p>;
  }

  return (
    <div className="mt-8 space-y-12">
      {/* ── Bookings ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-paper-100 text-xl">Confirmed bookings</h2>
        {bookings.length === 0 ? (
          <p className="text-paper-400 mt-3 text-sm">
            No confirmed bookings yet. Paid bookings appear here for driver assignment.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {bookings.map((b) => {
              const msg = rowMsg[b.external_id];
              return (
                <li
                  key={b.external_id}
                  className="border-ink-600 bg-ink-800/40 rounded-sm border p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-paper-100 text-sm font-medium">{b.customer_name}</p>
                      <p className="text-paper-400 mt-0.5 text-xs">{formatPickup(b.pickup_at)}</p>
                      <p className="text-paper-500 mt-1 truncate text-xs">
                        {b.pickup_location} → {b.dropoff_location}
                      </p>
                      <p className="text-paper-500 mt-1 font-mono text-[11px]">{b.external_id}</p>
                    </div>

                    <div className="w-full sm:w-64">
                      <label className="text-paper-400 mb-1 block text-xs">Driver</label>
                      <select
                        value={b.driver_id ?? ""}
                        disabled={busyRow === b.external_id}
                        onChange={(e) => assign(b.external_id, e.target.value || null)}
                        className="border-ink-500 bg-ink-900 text-paper-100 focus:border-brass-400 w-full cursor-pointer rounded-sm border px-3 py-2 text-sm outline-none disabled:opacity-50"
                      >
                        <option value="">— Unassigned —</option>
                        {activeDrivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                        {/* If this booking's assigned driver has since been retired,
                            keep showing them so the row isn't misleading. */}
                        {b.driver_id &&
                          !activeDrivers.some((d) => d.id === b.driver_id) &&
                          b.driver_name && (
                            <option value={b.driver_id}>{b.driver_name} (retired)</option>
                          )}
                      </select>
                      {msg && (
                        <p
                          className={`mt-1.5 text-xs ${
                            msg.kind === "error" ? "text-danger" : "text-brass-400"
                          }`}
                        >
                          {msg.text}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Roster ───────────────────────────────────────────────────────── */}
      <RosterPanel drivers={drivers} onChanged={load} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */

function RosterPanel({ drivers, onChanged }: { drivers: Driver[]; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/dispatch/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return false;
      }
      onChanged();
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addDriver() {
    if (!name.trim()) {
      setError("A driver name is required.");
      return;
    }
    const ok = await post({ action: "add", name, phone, email });
    if (ok) {
      setName("");
      setPhone("");
      setEmail("");
    }
  }

  return (
    <section>
      <h2 className="font-display text-paper-100 text-xl">Drivers</h2>
      <p className="text-paper-400 mt-1 text-sm">
        Add your chauffeurs here. Only active drivers appear in the assignment list.
      </p>

      {/* Add form */}
      <div className="border-ink-600 bg-ink-800/40 mt-4 rounded-sm border p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="border-ink-500 bg-ink-900 text-paper-100 focus:border-brass-400 rounded-sm border px-3 py-2 text-sm outline-none"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            className="border-ink-500 bg-ink-900 text-paper-100 focus:border-brass-400 rounded-sm border px-3 py-2 text-sm outline-none"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional)"
            className="border-ink-500 bg-ink-900 text-paper-100 focus:border-brass-400 rounded-sm border px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <PrimaryButton onClick={addDriver} disabled={busy}>
            Add driver
          </PrimaryButton>
          {error && <p className="text-danger text-xs">{error}</p>}
        </div>
      </div>

      {/* Roster list */}
      {drivers.length > 0 && (
        <ul className="mt-4 space-y-2">
          {drivers.map((d) => (
            <RosterRow key={d.id} driver={d} onAction={post} busy={busy} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RosterRow({
  driver,
  onAction,
  busy,
}: {
  driver: Driver;
  onAction: (body: unknown) => Promise<boolean>;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(driver.name);
  const [phone, setPhone] = useState(driver.phone);
  const [email, setEmail] = useState(driver.email);

  async function save() {
    const ok = await onAction({ action: "update", id: driver.id, name, phone, email });
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <li className="border-ink-600 bg-ink-800/60 rounded-sm border p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-ink-500 bg-ink-900 text-paper-100 rounded-sm border px-3 py-2 text-sm outline-none"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            className="border-ink-500 bg-ink-900 text-paper-100 rounded-sm border px-3 py-2 text-sm outline-none"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="border-ink-500 bg-ink-900 text-paper-100 rounded-sm border px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="mt-2 flex gap-2">
          <PrimaryButton onClick={save} disabled={busy}>
            Save
          </PrimaryButton>
          <GhostButton onClick={() => setEditing(false)}>Cancel</GhostButton>
        </div>
      </li>
    );
  }

  return (
    <li
      className={`border-ink-600 flex items-center justify-between gap-3 rounded-sm border p-3 ${
        driver.active ? "bg-ink-800/40" : "bg-ink-900/40 opacity-60"
      }`}
    >
      <div className="min-w-0">
        <p className="text-paper-100 text-sm">
          {driver.name}
          {!driver.active && <span className="text-paper-500 ml-2 text-xs">(retired)</span>}
        </p>
        <p className="text-paper-500 truncate text-xs">
          {[driver.phone, driver.email].filter(Boolean).join(" · ") || "No contact details"}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <GhostButton onClick={() => setEditing(true)} className="!px-3 !py-1.5 !text-xs">
          Edit
        </GhostButton>
        <GhostButton
          onClick={() => onAction({ action: "retire", id: driver.id, active: !driver.active })}
          disabled={busy}
          className="!px-3 !py-1.5 !text-xs"
        >
          {driver.active ? "Retire" : "Reactivate"}
        </GhostButton>
      </div>
    </li>
  );
}
