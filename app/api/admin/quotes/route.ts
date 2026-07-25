/**
 * GET /api/admin/quotes — quote-request leads awaiting a price (admin only).
 *
 * Returns the New Inquiry quote leads that haven't been priced yet, so the admin
 * Quotes page can list them. Gated by requireAdmin().
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listQuoteLeads } from "@/lib/ghl";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const leads = await listQuoteLeads();
    return NextResponse.json({ leads });
  } catch (err) {
    console.error("[admin/quotes] list failed:", err);
    return NextResponse.json({ error: "Could not load quote requests." }, { status: 502 });
  }
}
