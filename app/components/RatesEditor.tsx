"use client";

/**
 * The rates editor — the owner's one website screen for adjusting pricing.
 * Fetches current rates, lets the admin edit them in bounded number fields, and
 * saves. On save the server invalidates the pricing cache, so the very next
 * booking quote reflects the change.
 */

import { useEffect, useState } from "react";
import { PrimaryButton } from "./ui";

type EditableRates = {
  config: { key: string; value: number; label: string; category: string }[];
  vehicles: { id: string; label: string; multiplier: number; capacity: number }[];
  addOns: { id: string; label: string; price: number }[];
};

// Which config keys are dollars vs a percentage vs a plain number, for the
// input adornment and step.
const KEY_KIND: Record<string, "money" | "pct" | "num"> = {
  base_fare: "money",
  per_mile: "money",
  per_hour: "money",
  minimum_fare: "money",
  service_fee_pct: "pct",
  round_trip_return_discount: "pct",
  min_hours: "num",
};

export function RatesEditor() {
  const [rates, setRates] = useState<EditableRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/rates");
        if (!res.ok) throw new Error("load");
        setRates(await res.json());
      } catch {
        setError("Could not load rates. Please refresh.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function setConfig(key: string, value: number) {
    setRates((r) =>
      r ? { ...r, config: r.config.map((c) => (c.key === key ? { ...c, value } : c)) } : r,
    );
    setSavedAt(null);
  }
  function setVehicle(id: string, multiplier: number) {
    setRates((r) =>
      r ? { ...r, vehicles: r.vehicles.map((v) => (v.id === id ? { ...v, multiplier } : v)) } : r,
    );
    setSavedAt(null);
  }
  function setAddOn(id: string, price: number) {
    setRates((r) =>
      r ? { ...r, addOns: r.addOns.map((a) => (a.id === id ? { ...a, price } : a)) } : r,
    );
    setSavedAt(null);
  }

  async function save() {
    if (!rates) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: rates.config.map((c) => ({ key: c.key, value: c.value })),
          vehicles: rates.vehicles.map((v) => ({ id: v.id, multiplier: v.multiplier })),
          addOns: rates.addOns.map((a) => ({ id: a.id, price: a.price })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setSavedAt(Date.now());
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-paper-500 flex items-center gap-3 py-8 text-sm">
        <span className="border-paper-500 border-t-brass-400 h-4 w-4 animate-spin rounded-full border-2" />
        Loading rates…
      </div>
    );
  }
  if (!rates) {
    return <p className="text-danger py-8 text-sm">{error}</p>;
  }

  return (
    <div className="mt-8 space-y-10">
      {/* ── Fares & fees ─────────────────────────────────────────────────── */}
      <Section title="Fares & fees" note="The core numbers behind every quote.">
        <div className="grid gap-4 sm:grid-cols-2">
          {rates.config.map((c) => {
            const kind = KEY_KIND[c.key] ?? "num";
            return (
              <NumberField
                key={c.key}
                label={c.label}
                value={c.value}
                onChange={(v) => setConfig(c.key, v)}
                prefix={kind === "money" ? "$" : undefined}
                suffix={kind === "pct" ? "(0–1)" : undefined}
                step={kind === "pct" ? 0.01 : kind === "money" ? 0.5 : 1}
              />
            );
          })}
        </div>
      </Section>

      {/* ── Vehicle multipliers ──────────────────────────────────────────── */}
      <Section title="Vehicle class multipliers" note="Applied to the fare basis. 1.00 = no change.">
        <div className="grid gap-4 sm:grid-cols-2">
          {rates.vehicles.map((v) => (
            <NumberField
              key={v.id}
              label={`${v.label} (seats ${v.capacity})`}
              value={v.multiplier}
              onChange={(m) => setVehicle(v.id, m)}
              prefix="×"
              step={0.05}
            />
          ))}
        </div>
      </Section>

      {/* ── Add-ons ──────────────────────────────────────────────────────── */}
      <Section title="Add-ons" note="Flat surcharges, applied after the multiplier.">
        <div className="grid gap-4 sm:grid-cols-2">
          {rates.addOns.map((a) => (
            <NumberField
              key={a.id}
              label={a.label}
              value={a.price}
              onChange={(p) => setAddOn(a.id, p)}
              prefix="$"
              step={1}
            />
          ))}
        </div>
      </Section>

      {/* ── Save bar ─────────────────────────────────────────────────────── */}
      <div className="border-ink-700 flex items-center gap-4 border-t pt-6">
        <PrimaryButton onClick={save} loading={saving}>
          Save changes
        </PrimaryButton>
        {savedAt && (
          <span className="text-brass-400 animate-fade-rise text-sm">
            ✓ Saved. The next booking quote uses these rates.
          </span>
        )}
        {error && <span className="text-danger text-sm">{error}</span>}
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-paper-100 text-sm font-medium">{title}</h2>
      <p className="text-paper-500 mt-0.5 mb-4 text-xs">{note}</p>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="text-paper-300 mb-1.5 block text-xs">{label}</span>
      <span className="border-ink-500 bg-ink-700 focus-within:border-brass-400 flex items-center rounded-sm border transition-colors">
        {prefix && <span className="text-paper-500 pl-3 text-sm">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={0}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(Number.parseFloat(e.target.value))}
          className="tnum text-paper-100 w-full bg-transparent px-3 py-2.5 text-[15px] outline-none"
        />
        {suffix && <span className="text-paper-500 pr-3 text-xs">{suffix}</span>}
      </span>
    </label>
  );
}
