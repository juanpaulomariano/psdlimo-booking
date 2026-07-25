"use client";

/**
 * The "Request a Quote" form — for COMPLEX trips the instant-booking rules can't
 * price (multi-stop, multi-day, multiple vehicles, unusual routing). It is a
 * LEAD, not a booking: no price, no payment. On submit it creates a GHL lead in
 * New Inquiry and the owner follows up with a quote. See /api/quote-request.
 */

import { useState } from "react";
import Link from "next/link";
import { laToday } from "@/lib/datetime";
import { TextField, TextArea, PrimaryButton } from "./ui";

type Errors = Partial<Record<"name" | "email" | "phone" | "tripDetails", string>>;

export function QuoteRequestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [passengers, setPassengers] = useState("");
  const [tripDetails, setTripDetails] = useState("");

  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function validate(): boolean {
    const e: Errors = {};
    if (name.trim().length < 2) e.name = "Please enter your full name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = "Please enter a valid email.";
    if (phone.trim().length < 7) e.phone = "Please enter a valid phone number.";
    if (tripDetails.trim().length < 10)
      e.tripDetails = "Please describe your trip so we can quote it accurately.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    setSubmitError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/quote-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          preferredDate: preferredDate || undefined,
          passengers: passengers ? Number(passengers) : undefined,
          tripDetails,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setSubmitError("We couldn't reach the server. Please try again, or call us.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="border-ink-600 bg-ink-800/50 animate-fade-rise mt-8 rounded-sm border px-6 py-8">
        <div className="border-brass-400 mb-5 flex h-11 w-11 items-center justify-center rounded-full border">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden className="text-brass-400">
            <path d="M4 10.5L8 14.5L16 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="font-display text-paper-100 text-2xl">Request received</h2>
        <p className="text-paper-300 mt-3 leading-relaxed">
          Thank you, {name.split(" ")[0]}. We&apos;ve received your request and will be in
          touch shortly with a tailored quote for your trip.
        </p>
        <Link
          href="/"
          className="text-paper-300 hover:text-brass-400 mt-6 inline-block text-sm underline underline-offset-4 transition-colors"
        >
          ← Back to booking
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Full name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          autoComplete="name"
        />
        <TextField
          label="Email"
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoComplete="email"
        />
        <TextField
          label="Phone"
          required
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
          autoComplete="tel"
        />
        <TextField
          label="Approx. passengers"
          type="number"
          min={1}
          max={100}
          value={passengers}
          onChange={(e) => setPassengers(e.target.value)}
          hint="Optional"
        />
        <TextField
          label="Preferred date"
          type="date"
          min={laToday()}
          value={preferredDate}
          onChange={(e) => setPreferredDate(e.target.value)}
          hint="Optional — leave blank if flexible"
        />
      </div>

      <TextArea
        label="Tell us about your trip"
        rows={6}
        value={tripDetails}
        onChange={(e) => setTripDetails(e.target.value)}
        error={errors.tripDetails}
        maxLength={2000}
        placeholder="Where are you going, and when? Include any stops, multiple days, several vehicles, waiting time, or anything special so we can quote it accurately."
      />

      <div className="flex flex-wrap items-center gap-4 pt-2">
        <PrimaryButton onClick={submit} loading={submitting}>
          Request quote
        </PrimaryButton>
        {submitError && <p className="text-danger text-sm">{submitError}</p>}
      </div>
    </div>
  );
}
