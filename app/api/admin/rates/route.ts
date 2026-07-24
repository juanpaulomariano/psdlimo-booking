/**
 * GET  /api/admin/rates — current editable rates (admin only).
 * POST /api/admin/rates — save edits (admin only).
 *
 * SECURITY: every request is gated by requireAdmin() BEFORE anything else. A
 * non-admin (or logged-out) caller gets 403 and never touches the data. Writes
 * are zod-validated with bounds so a rate can't be negative or absurd.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { readEditableRates, writeRates } from "@/lib/rates-admin";

async function guard(): Promise<NextResponse | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;

  const rates = await readEditableRates();
  return NextResponse.json(rates);
}

/** Bounds keep an edit sane: no negatives, no absurd values that would be an
 *  obvious fat-finger. Generous enough not to block legitimate pricing. */
const money = z.coerce.number().min(0).max(100_000);
const pct = z.coerce.number().min(0).max(1); // service fee is a fraction (0.25 = 25%)
const multiplier = z.coerce.number().min(0.1).max(10);

const saveSchema = z.object({
  config: z
    .array(z.object({ key: z.string().max(64), value: z.coerce.number().min(0).max(100_000) }))
    .max(50),
  vehicles: z.array(z.object({ id: z.string().max(64), multiplier })).max(50),
  addOns: z.array(z.object({ id: z.string().max(64), price: money })).max(50),
});

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Those values are not valid. Check for negatives or out-of-range numbers." },
      { status: 400 },
    );
  }

  // Extra guard: service_fee_pct must be a fraction (0–1), caught here since the
  // generic config bound above allows larger numbers for dollar fields.
  const fee = parsed.data.config.find((c) => c.key === "service_fee_pct");
  if (fee && pct.safeParse(fee.value).success === false) {
    return NextResponse.json(
      { error: "Service fee must be between 0 and 1 (e.g. 0.25 for 25%)." },
      { status: 400 },
    );
  }

  await writeRates(parsed.data);
  return NextResponse.json({ ok: true });
}
