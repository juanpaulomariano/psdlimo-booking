/**
 * POST /api/admin/quotes/price — price a quote and create its payment invoice.
 *
 * The owner (admin only) sets the amount, a primary pickup date/time (the
 * anchor), the vehicle, party size, and the itinerary. This creates an invoice
 * for that exact amount via the SAME payment flow as an instant booking, and
 * writes the payment link back onto the GHL opportunity (a GHL workflow then
 * emails the customer). When the customer pays, the existing webhook confirms it.
 *
 * The price is the OWNER's, entered behind requireAdmin — the one legitimate
 * place a human sets it. Bounded + validated. Not a customer-submitted value, so
 * the "never trust a client price" invariant is not in play here.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { priceQuoteAndInvoice } from "@/lib/quotes";
import { attachQuoteInvoice } from "@/lib/ghl";
import { laWallClockToISO, meetsLeadTime } from "@/lib/datetime";
import { VEHICLE_CLASS_IDS, MIN_LEAD_TIME_HOURS } from "@/config/rates";

const schema = z.object({
  opportunityId: z.string().trim().min(1).max(64),
  contactId: z.string().trim().max(64).optional().default(""),
  contact: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.email().max(200),
    phone: z.string().trim().min(7).max(32),
  }),
  amountUSD: z.coerce.number().positive().max(1_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time"),
  vehicleClass: z.enum(VEHICLE_CLASS_IDS),
  passengers: z.coerce.number().int().min(1).max(100),
  itinerary: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      { error: parsed.error.issues[0]?.message ?? "Please check the fields." },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // Convert the owner's wall-clock date/time into an offset-carrying LA instant.
  let pickupAtISO: string;
  try {
    pickupAtISO = laWallClockToISO(d.date, d.time);
  } catch {
    return NextResponse.json({ error: "That date/time is not valid." }, { status: 400 });
  }
  if (!meetsLeadTime(pickupAtISO)) {
    return NextResponse.json(
      { error: `The pickup must be at least ${MIN_LEAD_TIME_HOURS} hours from now.` },
      { status: 400 },
    );
  }

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  try {
    const result = await priceQuoteAndInvoice(
      {
        opportunityId: d.opportunityId,
        contact: d.contact,
        amountUSD: d.amountUSD,
        pickupAtISO,
        vehicleClass: d.vehicleClass,
        passengers: d.passengers,
        itinerary: d.itinerary,
      },
      baseUrl,
    );

    // Record the link + amount on the opportunity so GHL can email it and the
    // owner can track it. Non-fatal to the response — we already have the link.
    try {
      await attachQuoteInvoice({
        opportunityId: d.opportunityId,
        contactId: d.contactId,
        invoiceUrl: result.invoiceUrl,
        amount: d.amountUSD,
      });
    } catch (err) {
      console.error("[admin/quotes/price] attach to GHL failed (invoice exists):", err);
    }

    return NextResponse.json({
      ok: true,
      reference: result.externalId,
      invoiceUrl: result.invoiceUrl,
    });
  } catch (err) {
    console.error("[admin/quotes/price] invoice creation failed:", err);
    return NextResponse.json(
      { error: "Could not create the invoice. Please try again." },
      { status: 502 },
    );
  }
}
