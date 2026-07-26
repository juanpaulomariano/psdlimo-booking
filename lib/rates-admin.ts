/**
 * Admin-side rate reads and writes. SERVER ONLY.
 *
 * Separate from lib/rates-source.ts (which is the READ path the pricing engine
 * uses, with caching + fallback). This module is the EDIT path: it reads the
 * current values for the form and writes edits back, then invalidates the cache
 * so the next quote reflects the change immediately.
 *
 * Every write is validated and bounded (see the zod schema in the route). Values
 * are parameterized by the Neon driver — no injection. The route that calls
 * these ALSO checks the admin role; this module assumes that check has passed.
 */

import "server-only";
import { sql } from "@/lib/db";
import { invalidateRateCache } from "@/lib/rates-source";

export type EditableRates = {
  config: { key: string; value: number; label: string; category: string }[];
  vehicles: { id: string; label: string; multiplier: number; capacity: number }[];
  /** Includes RETIRED add-ons (active:false) so the admin can restore one.
   *  The booking wizard only ever sees active ones — see lib/rates-source.ts. */
  addOns: { id: string; label: string; blurb: string; price: number; active: boolean }[];
};

function num(v: unknown): number {
  return typeof v === "number" ? v : Number.parseFloat(String(v));
}

/** Everything the admin form needs to render the current editable rates. */
export async function readEditableRates(): Promise<EditableRates> {
  const [config, vehicles, addOns] = await Promise.all([
    sql`SELECT key, value, label, category FROM rate_config ORDER BY category, key` as unknown as Promise<
      { key: string; value: string | number; label: string; category: string }[]
    >,
    sql`SELECT id, label, multiplier, capacity FROM vehicle_class WHERE active = true ORDER BY sort_order` as unknown as Promise<
      { id: string; label: string; multiplier: string | number; capacity: number }[]
    >,
    // ALL add-ons, active or not — the admin manages the catalogue and needs to
    // see (and restore) retired ones. Active first, then original order.
    sql`SELECT id, label, blurb, price, active FROM add_on ORDER BY active DESC, sort_order` as unknown as Promise<
      { id: string; label: string; blurb: string; price: string | number; active: boolean }[]
    >,
  ]);

  return {
    config: config.map((r) => ({ key: r.key, value: num(r.value), label: r.label, category: r.category })),
    vehicles: vehicles.map((v) => ({
      id: v.id,
      label: v.label,
      multiplier: num(v.multiplier),
      capacity: v.capacity,
    })),
    addOns: addOns.map((a) => ({
      id: a.id,
      label: a.label,
      blurb: a.blurb ?? "",
      price: num(a.price),
      active: a.active,
    })),
  };
}

/** Apply a validated set of edits. Only known keys/ids are written — an unknown
 *  key is ignored, not inserted, so a malformed payload can't add junk rows. */
export async function writeRates(edits: {
  config: { key: string; value: number }[];
  vehicles: { id: string; multiplier: number }[];
  addOns: { id: string; price: number }[];
}): Promise<void> {
  // Whitelist the keys/ids that exist, so writes can only UPDATE known rows.
  const [validKeys, validVehicles, validAddOns] = await Promise.all([
    sql`SELECT key FROM rate_config` as unknown as Promise<{ key: string }[]>,
    sql`SELECT id FROM vehicle_class` as unknown as Promise<{ id: string }[]>,
    sql`SELECT id FROM add_on` as unknown as Promise<{ id: string }[]>,
  ]);
  const keySet = new Set(validKeys.map((r) => r.key));
  const vehSet = new Set(validVehicles.map((r) => r.id));
  const addSet = new Set(validAddOns.map((r) => r.id));

  for (const c of edits.config) {
    if (!keySet.has(c.key)) continue;
    await sql`UPDATE rate_config SET value = ${c.value}, updated_at = now() WHERE key = ${c.key}`;
  }
  for (const v of edits.vehicles) {
    if (!vehSet.has(v.id)) continue;
    await sql`UPDATE vehicle_class SET multiplier = ${v.multiplier}, updated_at = now() WHERE id = ${v.id}`;
  }
  for (const a of edits.addOns) {
    if (!addSet.has(a.id)) continue;
    await sql`UPDATE add_on SET price = ${a.price}, updated_at = now() WHERE id = ${a.id}`;
  }

  // The next quote must reflect the edit immediately, not after the 60s cache.
  invalidateRateCache();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Add-on catalogue — the owner CREATES and RETIRES these, not just re-prices.
 *
 * The rate card (lib/rates-source.ts) is the single source of truth for which
 * add-ons exist: the booking wizard renders from it, the pricing engine charges
 * from it, and validation checks against it. So a row inserted here appears on
 * the website on the next page load, with no deploy.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Raised for a clean, user-facing failure the admin form can display. */
export class RatesAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatesAdminError";
  }
}

/** Slugify a label into a stable id: "Champagne Service" → "champagne-service". */
function slugifyAddOn(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40) || "add-on"
  );
}

/**
 * Create a new add-on. The id is derived from the label and is PERMANENT — past
 * bookings reference it, so it must never be reused for a different service.
 * A collision (same slug) is refused rather than silently overwriting an
 * existing add-on's price.
 */
export async function createAddOn(input: {
  label: string;
  price: number;
  blurb?: string;
}): Promise<{ id: string }> {
  const label = input.label.trim();
  if (!label) throw new RatesAdminError("An add-on needs a name.");

  const id = slugifyAddOn(label);

  const existing = (await sql`
    SELECT id, active FROM add_on WHERE id = ${id} LIMIT 1
  `) as unknown as { id: string; active: boolean }[];

  if (existing.length > 0) {
    // Reactivating a previously retired add-on is the sane behaviour; creating a
    // second one with the same name is not.
    if (!existing[0].active) {
      await sql`
        UPDATE add_on SET active = true, price = ${input.price},
          blurb = ${input.blurb?.trim() ?? ""}, updated_at = now()
        WHERE id = ${id}
      `;
      invalidateRateCache();
      return { id };
    }
    throw new RatesAdminError(`An add-on called "${label}" already exists.`);
  }

  // Sort after everything currently listed.
  const [{ next }] = (await sql`
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM add_on
  `) as unknown as { next: number }[];

  await sql`
    INSERT INTO add_on (id, label, blurb, price, sort_order)
    VALUES (${id}, ${label}, ${input.blurb?.trim() ?? ""}, ${input.price}, ${next})
  `;

  invalidateRateCache();
  return { id };
}

/**
 * Retire or restore an add-on. NEVER deletes: past bookings reference the id and
 * must keep rendering their line item correctly. A retired add-on simply stops
 * being offered on new bookings.
 */
export async function setAddOnActive(id: string, active: boolean): Promise<boolean> {
  const rows = (await sql`
    UPDATE add_on SET active = ${active}, updated_at = now() WHERE id = ${id} RETURNING id
  `) as unknown as { id: string }[];
  invalidateRateCache();
  return rows.length > 0;
}

/** Rename an add-on / edit its blurb. The id is deliberately NOT touched. */
export async function updateAddOnDetails(input: {
  id: string;
  label: string;
  blurb?: string;
}): Promise<boolean> {
  const label = input.label.trim();
  if (!label) throw new RatesAdminError("An add-on needs a name.");
  const rows = (await sql`
    UPDATE add_on SET label = ${label}, blurb = ${input.blurb?.trim() ?? ""}, updated_at = now()
    WHERE id = ${input.id} RETURNING id
  `) as unknown as { id: string }[];
  invalidateRateCache();
  return rows.length > 0;
}
