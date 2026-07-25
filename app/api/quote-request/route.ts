/**
 * POST /api/quote-request — create a manual-quote LEAD for a complex booking.
 *
 * Contract Phase 2: "Instant quotation where rules allow, and manual quotation
 * requests for complex bookings." Phase 3: "Automatic lead creation from website
 * forms." This is that path.
 *
 * IMPORTANT — this is NOT the payment flow. The rule "GHL writes happen only in
 * the verified payment callback" governs PAID BOOKINGS (paid ⇔ exists in GHL). A
 * quote request is a LEAD, not a booking: no payment, no invoice, no appointment.
 * Creating a lead from a website form is exactly what the contract requires here,
 * so this route writes to GHL directly by design — it does not touch the payment
 * pipeline or create a paid opportunity.
 *
 * No amount is trusted from the client (there is no price at all — the owner
 * quotes manually), so the price-tampering concern does not apply.
 */

import { NextResponse } from "next/server";
import { quoteRequestFormSchema } from "@/lib/booking-schema";
import { createQuoteLead, GHLError } from "@/lib/ghl";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = quoteRequestFormSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check the form.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const form = parsed.data;

  try {
    const { opportunityId } = await createQuoteLead({
      name: form.name,
      email: form.email,
      phone: form.phone,
      preferredDate: form.preferredDate ?? "",
      passengers: form.passengers ?? null,
      tripDetails: form.tripDetails,
    });

    return NextResponse.json({ ok: true, reference: opportunityId });
  } catch (err) {
    // A lead that fails to record should tell the customer to try another way,
    // not silently vanish. Log the detail; return a clean message.
    if (err instanceof GHLError) {
      console.error(
        `[quote-request] GHL failure: status ${err.status ?? "n/a"} — ${err.body ?? err.message}`,
      );
    } else {
      console.error("[quote-request] unexpected failure:", err);
    }
    return NextResponse.json(
      { error: "We couldn't submit your request just now. Please call or email us instead." },
      { status: 502 },
    );
  }
}
