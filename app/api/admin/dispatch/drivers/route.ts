/**
 * POST /api/admin/dispatch/drivers — manage the driver roster (admin only).
 *
 * One endpoint, three actions (kept together because the roster panel is one UI
 * surface):
 *   { action: "add",    name, phone?, email? }
 *   { action: "update", id, name, phone?, email? }
 *   { action: "retire", id, active }          // active:false retires, true reactivates
 *
 * Retire is a SOFT delete — a driver referenced by past trips is never removed,
 * so history stays intact; they just drop out of the assignment dropdown.
 *
 * SECURITY: requireAdmin() first; zod-validated. Clean user-facing errors
 * (duplicate name, unknown id) return 400/404, not a raw DB error.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { addDriver, updateDriver, setDriverActive, DispatchError } from "@/lib/trips";

const name = z.string().trim().min(1, "A driver name is required.").max(120);
const phone = z.string().trim().max(32).optional();
const email = z.string().trim().max(200).optional();

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), name, phone, email }),
  z.object({ action: z.literal("update"), id: z.string().min(1).max(64), name, phone, email }),
  z.object({ action: z.literal("retire"), id: z.string().min(1).max(64), active: z.boolean() }),
]);

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Dispatch is unavailable: no database is configured." },
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
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Invalid driver details." },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.action === "add") {
      const driver = await addDriver(parsed.data);
      return NextResponse.json({ ok: true, driver });
    }
    if (parsed.data.action === "update") {
      const driver = await updateDriver(parsed.data);
      if (!driver) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
      return NextResponse.json({ ok: true, driver });
    }
    // retire / reactivate
    const driver = await setDriverActive(parsed.data.id, parsed.data.active);
    if (!driver) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
    return NextResponse.json({ ok: true, driver });
  } catch (err) {
    if (err instanceof DispatchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
