"use client";

/**
 * QuotesBoard — the owner prices custom-trip requests here.
 *
 * Each pending quote lead shows the customer + their itinerary. The owner sets an
 * amount, a primary pickup date/time (the anchor), vehicle, and party size, then
 * sends the payment link. The itinerary text is NOT forced into structured fields
 * — a complex trip keeps its detail as free text. On success the link is shown
 * (and emailed to the customer via a GHL workflow).
 */

import { useEffect, useState } from "react";
import { VEHICLE_CLASSES } from "@/config/rates";
import { laToday } from "@/lib/datetime";
import { PrimaryButton, GhostButton } from "./ui";

type Lead = {
  opportunityId: string;
  contactId: string;
  name: string;
  email: string;
  phone: string;
  itinerary: string;
  createdAt: string;
};

export function QuotesBoard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/quotes");
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as { leads: Lead[] };
      setLeads(data.leads);
    } catch {
      setLoadError("Could not load quote requests. Please refresh.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  if (loading) return <p className="text-paper-400 mt-8 text-sm">Loading quote requests…</p>;
  if (loadError) return <p className="text-danger mt-8 text-sm">{loadError}</p>;

  return (
    <div className="mt-8">
      {leads.length === 0 ? (
        <p className="text-paper-400 text-sm">
          No custom-quote requests waiting. New requests from the website appear here.
        </p>
      ) : (
        <ul className="space-y-4">
          {leads.map((lead) => (
            <QuoteRow
              key={lead.opportunityId}
              lead={lead}
              onPriced={() =>
                setLeads((ls) => ls.filter((l) => l.opportunityId !== lead.opportunityId))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QuoteRow({ lead, onPriced }: { lead: Lead; onPriced: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [vehicle, setVehicle] = useState<string>(VEHICLE_CLASSES[0]?.id ?? "");
  const [passengers, setPassengers] = useState("2");
  const [itinerary, setItinerary] = useState(lead.itinerary);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentLink, setSentLink] = useState<string | null>(null);

  async function sendLink() {
    setError(null);
    if (!amount || Number(amount) <= 0) return setError("Enter a valid amount.");
    if (!date || !time) return setError("Pick a primary pickup date and time.");
    if (!itinerary.trim()) return setError("The itinerary can't be empty.");

    setBusy(true);
    try {
      const res = await fetch("/api/admin/quotes/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: lead.opportunityId,
          contactId: lead.contactId,
          contact: { name: lead.name, email: lead.email, phone: lead.phone },
          amountUSD: Number(amount),
          date,
          time,
          vehicleClass: vehicle,
          passengers: Number(passengers),
          itinerary,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create the invoice.");
        return;
      }
      setSentLink(data.invoiceUrl);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentLink) {
    return (
      <li className="border-brass-400/40 bg-ink-800/50 rounded-sm border px-5 py-4">
        <p className="text-brass-400 text-sm">✓ Priced. Payment link created for {lead.name}.</p>
        <p className="text-paper-400 mt-2 text-xs">
          The link is stored on the booking and emailed to the customer. You can also copy it:
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={sentLink}
            className="border-ink-500 bg-ink-900 text-paper-300 min-w-0 flex-1 rounded-sm border px-3 py-2 text-xs"
          />
          <GhostButton
            className="!px-3 !py-2 !text-xs"
            onClick={() => navigator.clipboard.writeText(sentLink).catch(() => {})}
          >
            Copy
          </GhostButton>
        </div>
        <GhostButton className="!px-0 !py-2 !text-xs" onClick={onPriced}>
          Done — remove from list
        </GhostButton>
      </li>
    );
  }

  return (
    <li className="border-ink-600 bg-ink-800/40 rounded-sm border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-paper-100 text-sm font-medium">{lead.name}</p>
          <p className="text-paper-500 text-xs">
            {[lead.email, lead.phone].filter(Boolean).join(" · ")}
          </p>
        </div>
        <GhostButton className="!px-3 !py-1.5 !text-xs" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Price this quote"}
        </GhostButton>
      </div>

      <div className="border-ink-700 mt-3 rounded-sm border-l-2 pl-3">
        <p className="text-paper-400 text-xs whitespace-pre-wrap">{lead.itinerary || "(no details)"}</p>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quoted amount (USD)">
              <span className="border-ink-500 bg-ink-900 focus-within:border-brass-400 flex items-center rounded-sm border">
                <span className="text-paper-500 pl-3 text-sm">$</span>
                <input
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="no-spinner text-paper-100 w-full min-w-0 bg-transparent py-2 pr-3 pl-2 text-sm outline-none"
                  placeholder="0.00"
                />
              </span>
            </Field>
            <Field label="Approx. passengers">
              <Input type="number" min={1} value={passengers} onChange={setPassengers} />
            </Field>
            <Field label="Primary pickup date">
              <Input type="date" min={laToday()} value={date} onChange={setDate} />
            </Field>
            <Field label="Primary pickup time">
              <Input type="time" value={time} onChange={setTime} />
            </Field>
            <Field label="Vehicle">
              <select
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
                className="border-ink-500 bg-ink-900 text-paper-100 focus:border-brass-400 w-full cursor-pointer rounded-sm border px-3 py-2 text-sm outline-none"
              >
                {VEHICLE_CLASSES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Itinerary (what the driver runs)">
            <textarea
              rows={4}
              value={itinerary}
              onChange={(e) => setItinerary(e.target.value)}
              maxLength={2000}
              className="border-ink-500 bg-ink-900 text-paper-100 focus:border-brass-400 w-full resize-none rounded-sm border px-3 py-2 text-sm leading-relaxed outline-none"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <PrimaryButton onClick={sendLink} loading={busy}>
              Send payment link
            </PrimaryButton>
            {error && <p className="text-danger text-xs">{error}</p>}
          </div>
        </div>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-paper-400 mb-1 block text-xs">{label}</span>
      {children}
    </label>
  );
}

function Input({
  type,
  value,
  onChange,
  min,
}: {
  type: string;
  value: string;
  onChange: (v: string) => void;
  min?: string | number;
}) {
  return (
    <input
      type={type}
      min={min}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="no-spinner border-ink-500 bg-ink-900 text-paper-100 focus:border-brass-400 w-full rounded-sm border px-3 py-2 text-sm outline-none"
    />
  );
}
