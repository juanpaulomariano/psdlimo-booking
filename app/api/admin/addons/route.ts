/**
 * POST /api/admin/addons — manage the add-on catalogue (admin only).
 *
 * The owner CREATES and RETIRES add-ons here; the existing /api/admin/rates
 * handles re-pricing the ones that exist. Split deliberately: re-pricing is a
 * bulk save of the whole form, whereas creating/retiring acts on one row.
 *
 *   { action: "create", label, price, blurb? }
 *   { action: "update", id, label, blurb? }     // rename / re-describe
 *   { action: "retire", id, active }            // false retires, true restores
 *
 * Retire is a SOFT delete: past bookings reference the add-on id and must keep
 * rendering their line item, so the row is never removed — it just stops being
 * offered on new bookings.
 *
 * SECURITY: requireAdmin() first, zod-validated, prices bounded.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import {
  createAddOn,
  setAddOnActive,
  updateAddOnDetails,
  RatesAdminError,
} from "@/lib/rates-admin";

const label = z.string().trim().min(1, "An add-on needs a name.").max(60);
const blurb = z.string().trim().max(120).optional();
const price = z.coerce.number().min(0).max(10_000);

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), label, price, blurb }),
  z.object({ action: z.literal("update"), id: z.string().min(1).max(40), label, blurb }),
  z.object({
    action: z.literal("retire"),
    id: z.string().min(1).max(40),
    active: z.boolean(),
  }),
]);

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Add-ons cannot be edited: no database is configured." },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Those details are not valid." },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.action === "create") {
      const { id } = await createAddOn(parsed.data);
      return NextResponse.json({ ok: true, id });
    }
    if (parsed.data.action === "update") {
      const found = await updateAddOnDetails(parsed.data);
      if (!found) return NextResponse.json({ error: "Add-on not found." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    const found = await setAddOnActive(parsed.data.id, parsed.data.active);
    if (!found) return NextResponse.json({ error: "Add-on not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RatesAdminError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[admin/addons] failed:", err);
    return NextResponse.json({ error: "Could not save that add-on." }, { status: 500 });
  }
}
