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
  addOns: { id: string; label: string; price: number }[];
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
    sql`SELECT id, label, price FROM add_on WHERE active = true ORDER BY sort_order` as unknown as Promise<
      { id: string; label: string; price: string | number }[]
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
    addOns: addOns.map((a) => ({ id: a.id, label: a.label, price: num(a.price) })),
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
