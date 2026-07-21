"use client";

/**
 * Three-step booking wizard on a single page.
 *
 * State is deliberately flat and local — no reducer, no form library, no global
 * store. The whole booking is ~15 fields that die on submit; anything heavier
 * would be architecture for its own sake.
 *
 * The quote is DERIVED, never stored as truth: any change to the ride details
 * re-fetches from /api/quote. The displayed number always comes from the server
 * engine, and the Pay button stays disabled until a server-confirmed quote
 * exists. See CLAUDE.md invariant 1.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ADD_ONS,
  FLAT_ROUTES,
  MAX_HOURS,
  MAX_LUGGAGE,
  MAX_PASSENGERS,
  MIN_HOURS,
  MIN_LEAD_TIME_HOURS,
  VEHICLE_CLASSES,
  type AddOnId,
  type FlatRouteId,
  type VehicleClassId,
} from "@/config/rates";
import { laToday, laWallClockToISO, meetsLeadTime } from "@/lib/datetime";
import type { QuoteResponse } from "@/app/api/quote/route";
import { AddressAutocomplete } from "./AddressAutocomplete";
import { PricePanel } from "./PricePanel";
import { RouteMap } from "./RouteMap";
import { GhostButton, PrimaryButton, SelectField, Stepper, TextArea, TextField } from "./ui";

type RideType = "distance" | "hourly" | "flat";

const RIDE_TYPES: { id: RideType; label: string; blurb: string }[] = [
  { id: "distance", label: "Point to point", blurb: "A single journey, priced by distance" },
  { id: "hourly", label: "By the hour", blurb: "Keep the car and chauffeur" },
  { id: "flat", label: "Fixed route", blurb: "Popular routes at a set price" },
];

/** Airport detection drives the flight-number field and the GHL service tag. */
const AIRPORT_PATTERN = /\b(airport|sfo|oak|sjc|international terminal)\b/i;

const QUOTE_DEBOUNCE_MS = 400;

export function BookingWizard() {
  const [step, setStep] = useState(1);

  // ── Step 1: ride ──────────────────────────────────────────────────────────
  const [rideType, setRideType] = useState<RideType>("distance");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [flatRouteId, setFlatRouteId] = useState<FlatRouteId>(FLAT_ROUTES[0].id);
  const [hours, setHours] = useState(MIN_HOURS);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [passengers, setPassengers] = useState(2);
  const [luggage, setLuggage] = useState(2);

  // ── Step 2: vehicle & extras ──────────────────────────────────────────────
  const [vehicleClass, setVehicleClass] = useState<VehicleClassId>("business");
  const [addOns, setAddOns] = useState<AddOnId[]>([]);

  // ── Step 3: contact ───────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");

  // ── Quote ─────────────────────────────────────────────────────────────────
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const quoteAbort = useRef<AbortController | undefined>(undefined);
  const quoteDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const selectedFlatRoute = useMemo(
    () => FLAT_ROUTES.find((r) => r.id === flatRouteId)!,
    [flatRouteId],
  );

  /** Resolved pickup/dropoff regardless of ride type — used for airport checks. */
  const effectiveRoute = useMemo(() => {
    if (rideType === "flat") {
      return { from: selectedFlatRoute.from, to: selectedFlatRoute.to };
    }
    return { from: pickup, to: rideType === "hourly" ? "" : dropoff };
  }, [rideType, selectedFlatRoute, pickup, dropoff]);

  const isAirportRide = useMemo(() => {
    if (rideType === "flat") return selectedFlatRoute.isAirport;
    return AIRPORT_PATTERN.test(effectiveRoute.from) || AIRPORT_PATTERN.test(effectiveRoute.to);
  }, [rideType, selectedFlatRoute, effectiveRoute]);

  const pickupAt = useMemo(() => {
    if (!date || !time) return null;
    try {
      return laWallClockToISO(date, time);
    } catch {
      return null;
    }
  }, [date, time]);

  const leadTimeOk = pickupAt ? meetsLeadTime(pickupAt) : false;

  /**
   * A vehicle that cannot seat the party must never be the one we quote.
   *
   * DERIVED, not corrected-after-the-fact: if the selected class is too small
   * for the current passenger count we fall back during render. Doing this in
   * an effect would render one frame with an impossible selection and cause a
   * cascading re-render — and for a beat the customer would see a price for a
   * car they cannot legally travel in.
   */
  const effectiveVehicleClass = useMemo<VehicleClassId>(() => {
    const selected = VEHICLE_CLASSES.find((v) => v.id === vehicleClass);
    if (selected && passengers <= selected.capacity) return vehicleClass;
    return VEHICLE_CLASSES.find((v) => v.capacity >= passengers)?.id ?? vehicleClass;
  }, [vehicleClass, passengers]);

  /** Build the ride payload; null when incomplete, which suppresses quoting. */
  const ridePayload = useMemo(() => {
    if (!pickupAt || !leadTimeOk) return null;

    const common = {
      pickupAt,
      vehicleClass: effectiveVehicleClass,
      passengers,
      luggage,
      addOns,
    };

    switch (rideType) {
      case "distance":
        if (pickup.trim().length < 3 || dropoff.trim().length < 3) return null;
        return { ...common, rideType: "distance" as const, pickup, dropoff };
      case "hourly":
        if (pickup.trim().length < 3) return null;
        return { ...common, rideType: "hourly" as const, pickup, hours };
      case "flat":
        return { ...common, rideType: "flat" as const, flatRouteId };
    }
  }, [
    pickupAt, leadTimeOk, effectiveVehicleClass, passengers, luggage, addOns,
    rideType, pickup, dropoff, hours, flatRouteId,
  ]);

  const fetchQuote = useCallback(async (ride: NonNullable<typeof ridePayload>) => {
    quoteAbort.current?.abort();
    const controller = new AbortController();
    quoteAbort.current = controller;

    setQuoteLoading(true);
    setQuoteError(null);

    try {
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ride }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        setQuoteError(data.error ?? "We could not price that ride.");
        setQuote(null);
        return;
      }

      setQuote(data as QuoteResponse);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setQuoteError("Could not reach the pricing service. Please try again.");
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, []);

  // Re-quote whenever the ride changes. Debounced so dragging a stepper or
  // typing an address does not fire a request per keystroke.
  //
  // The clear-on-incomplete path is deferred into the timeout rather than run
  // in the effect body: a synchronous setState here would cascade a second
  // render on every keystroke while the form is still being filled in.
  useEffect(() => {
    clearTimeout(quoteDebounce.current);

    quoteDebounce.current = setTimeout(() => {
      if (!ridePayload) {
        quoteAbort.current?.abort(); // drop any in-flight quote for a stale ride
        setQuote(null);
        setQuoteError(null);
        return;
      }
      void fetchQuote(ridePayload);
    }, QUOTE_DEBOUNCE_MS);

    return () => clearTimeout(quoteDebounce.current);
  }, [ridePayload, fetchQuote]);

  useEffect(() => () => quoteAbort.current?.abort(), []);

  function toggleAddOn(id: AddOnId) {
    setAddOns((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const step1Complete = Boolean(ridePayload);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneValid = phone.trim().length >= 7 && /^[+()\-.\s\d]+$/.test(phone.trim());
  const nameValid = name.trim().length >= 2;
  const step3Complete = nameValid && emailValid && phoneValid;

  const canPay = step3Complete && Boolean(quote) && !quoteLoading && !submitting;

  async function handleSubmit() {
    if (!ridePayload || !canPay) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ride: ridePayload,
          contact: {
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            flightNumber: isAirportRide ? flightNumber.trim() : "",
            specialRequests: specialRequests.trim(),
          },
          paymentMethod: "card",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.invoiceUrl) {
        setSubmitError(data.error ?? "We could not start your payment. Please try again.");
        return;
      }

      // Hand off to the hosted payment page.
      window.location.href = data.invoiceUrl;
    } catch {
      setSubmitError("Could not reach the payment service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const minDate = laToday();

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px] lg:gap-14">
      {/* ─── Form column ─────────────────────────────────────────────────── */}
      <div>
        <StepIndicator step={step} />

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <section className="animate-fade-rise space-y-8" aria-label="Ride details">
            <fieldset>
              <legend className="text-paper-300 mb-3 text-xs tracking-[0.14em] uppercase">
                Service type
              </legend>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {RIDE_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setRideType(t.id)}
                    aria-pressed={rideType === t.id}
                    className={`rounded-sm border px-4 py-3.5 text-left transition-colors ${
                      rideType === t.id
                        ? "border-brass-400 bg-brass-400/5"
                        : "border-ink-600 hover:border-ink-500"
                    }`}
                  >
                    <div className="text-paper-100 text-sm">{t.label}</div>
                    <div className="text-paper-500 mt-0.5 text-xs">{t.blurb}</div>
                  </button>
                ))}
              </div>
            </fieldset>

            {rideType === "flat" ? (
              <SelectField
                label="Route"
                required
                value={flatRouteId}
                onChange={(e) => setFlatRouteId(e.target.value as FlatRouteId)}
              >
                {FLAT_ROUTES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </SelectField>
            ) : (
              <div className="space-y-5">
                <AddressAutocomplete
                  label="Pickup"
                  required
                  value={pickup}
                  onChange={setPickup}
                  placeholder="Airport, hotel, or address"
                />
                {rideType === "distance" && (
                  <AddressAutocomplete
                    label="Drop-off"
                    required
                    value={dropoff}
                    onChange={setDropoff}
                    placeholder="Where are you heading?"
                  />
                )}
              </div>
            )}

            {rideType === "hourly" && (
              <Stepper
                label="Duration"
                value={hours}
                min={MIN_HOURS}
                max={MAX_HOURS}
                onChange={setHours}
                suffix={hours === 1 ? "hour" : "hours"}
              />
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="Pickup date"
                required
                type="date"
                value={date}
                min={minDate}
                onChange={(e) => setDate(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, date: true }))}
              />
              <TextField
                label="Pickup time"
                required
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, time: true }))}
                hint="San Francisco time"
                error={
                  touched.time && pickupAt && !leadTimeOk
                    ? `Please book at least ${MIN_LEAD_TIME_HOURS} hours ahead.`
                    : undefined
                }
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Stepper
                label="Passengers"
                value={passengers}
                min={1}
                max={MAX_PASSENGERS}
                onChange={setPassengers}
              />
              <Stepper
                label="Luggage"
                value={luggage}
                min={0}
                max={MAX_LUGGAGE}
                onChange={setLuggage}
              />
            </div>

            <div className="flex justify-end pt-2">
              <PrimaryButton onClick={() => setStep(2)} disabled={!step1Complete}>
                Choose your vehicle
              </PrimaryButton>
            </div>
          </section>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <section className="animate-fade-rise space-y-8" aria-label="Vehicle and extras">
            <fieldset>
              <legend className="text-paper-300 mb-3 text-xs tracking-[0.14em] uppercase">
                Vehicle class
              </legend>
              <div className="space-y-2.5">
                {VEHICLE_CLASSES.map((v) => {
                  const tooSmall = passengers > v.capacity;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => !tooSmall && setVehicleClass(v.id)}
                      disabled={tooSmall}
                      aria-pressed={effectiveVehicleClass === v.id}
                      className={`flex w-full items-center justify-between rounded-sm border px-5 py-4 text-left transition-colors ${
                        tooSmall
                          ? "border-ink-700 cursor-not-allowed opacity-40"
                          : effectiveVehicleClass === v.id
                            ? "border-brass-400 bg-brass-400/5"
                            : "border-ink-600 hover:border-ink-500"
                      }`}
                    >
                      <div>
                        <div className="text-paper-100 text-sm">{v.label}</div>
                        <div className="text-paper-500 mt-0.5 text-xs">{v.blurb}</div>
                      </div>
                      <div className="text-paper-500 shrink-0 pl-4 text-right text-xs">
                        {tooSmall ? (
                          <span className="text-danger">Seats {v.capacity}</span>
                        ) : (
                          <>
                            <div className="tnum">{v.capacity} seats</div>
                            <div className="tnum mt-0.5">{v.luggage} bags</div>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-paper-300 mb-3 text-xs tracking-[0.14em] uppercase">
                Add-ons
              </legend>
              <div className="space-y-2.5">
                {ADD_ONS.map((a) => {
                  const selected = addOns.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAddOn(a.id)}
                      aria-pressed={selected}
                      className={`flex w-full items-center justify-between rounded-sm border px-5 py-3.5 text-left transition-colors ${
                        selected ? "border-brass-400 bg-brass-400/5" : "border-ink-600 hover:border-ink-500"
                      }`}
                    >
                      <div>
                        <div className="text-paper-100 text-sm">{a.label}</div>
                        <div className="text-paper-500 mt-0.5 text-xs">{a.blurb}</div>
                      </div>
                      <div className="tnum text-paper-300 shrink-0 pl-4 text-sm">
                        +${a.price}
                      </div>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex items-center justify-between pt-2">
              <GhostButton onClick={() => setStep(1)}>← Ride details</GhostButton>
              <PrimaryButton onClick={() => setStep(3)} disabled={!quote}>
                Continue
              </PrimaryButton>
            </div>
          </section>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <section className="animate-fade-rise space-y-6" aria-label="Contact and payment">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                label="Full name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                error={touched.name && !nameValid ? "Please enter your full name." : undefined}
                placeholder="Jane Whitfield"
                autoComplete="name"
              />
              <TextField
                label="Phone"
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                error={touched.phone && !phoneValid ? "Please enter a valid phone number." : undefined}
                placeholder="+1 415 555 0142"
                autoComplete="tel"
              />
            </div>

            <TextField
              label="Email"
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              error={touched.email && !emailValid ? "Please enter a valid email address." : undefined}
              placeholder="jane@example.com"
              autoComplete="email"
              hint="Your confirmation and chauffeur details go here."
            />

            {isAirportRide && (
              <TextField
                label="Flight number"
                value={flightNumber}
                onChange={(e) => setFlightNumber(e.target.value)}
                placeholder="UA 1234"
                maxLength={16}
                hint="We track your flight and adjust for delays."
              />
            )}

            <TextArea
              label="Special requests"
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              rows={3}
              // 400 here AND server-side. See CLAUDE.md on metadata limits.
              maxLength={400}
              placeholder="Child seat details, accessibility needs, preferred route…"
              hint={`${specialRequests.length}/400`}
            />

            <fieldset className="pt-2">
              <legend className="text-paper-300 mb-3 text-xs tracking-[0.14em] uppercase">
                Payment method
              </legend>
              <div className="space-y-2.5">
                <div className="border-brass-400 bg-brass-400/5 flex items-center justify-between rounded-sm border px-5 py-4">
                  <div>
                    <div className="text-paper-100 text-sm">Credit or debit card</div>
                    <div className="text-paper-500 mt-0.5 text-xs">
                      Secure hosted payment page
                    </div>
                  </div>
                  <div className="border-brass-400 flex h-4 w-4 items-center justify-center rounded-full border-2">
                    <div className="bg-brass-400 h-1.5 w-1.5 rounded-full" />
                  </div>
                </div>

                {/* Placeholders only — see ARCHITECTURE.md section 11. */}
                {[
                  { label: "PayPal", note: "Coming soon" },
                  { label: "Cash to chauffeur", note: "Coming soon" },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="border-ink-700 flex cursor-not-allowed items-center justify-between rounded-sm border px-5 py-4 opacity-40"
                    aria-disabled
                  >
                    <div className="text-paper-300 text-sm">{m.label}</div>
                    <div className="text-paper-500 text-xs">{m.note}</div>
                  </div>
                ))}
              </div>
            </fieldset>

            {submitError && (
              <div className="border-danger/40 bg-danger/5 rounded-sm border px-5 py-3">
                <p className="text-danger text-sm">{submitError}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <GhostButton onClick={() => setStep(2)}>← Vehicle</GhostButton>
              <PrimaryButton onClick={handleSubmit} disabled={!canPay} loading={submitting}>
                {submitting
                  ? "Redirecting…"
                  : quote
                    ? `Confirm & pay $${quote.breakdown.total}`
                    : "Confirm & pay"}
              </PrimaryButton>
            </div>

            <p className="text-paper-500 text-center text-xs">
              You will be redirected to our secure payment provider.
            </p>
          </section>
        )}
      </div>

      {/* ─── Price column ────────────────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-10 lg:self-start">
        <PricePanel
          quote={quote}
          loading={quoteLoading}
          error={quoteError}
          refreshKey={refreshKey}
        />

        {/*
          Display only — the map shows WHERE the ride goes, never how far. The
          priced distance comes from the server and this component cannot see it.
          Hidden for hourly rides, which have no fixed destination to draw.
        */}
        <div className="mt-4">
          <RouteMap
            pickup={effectiveRoute.from}
            dropoff={effectiveRoute.to}
            hidden={rideType === "hourly"}
            // Straight from the server quote — the SAME number the breakdown
            // shows. The map never derives a distance of its own.
            drivingMiles={quote?.distanceMiles ?? null}
          />
        </div>

        {quote && step > 1 && (
          <dl className="text-paper-500 mt-5 space-y-1.5 text-xs">
            <div className="flex justify-between gap-4">
              <dt>Vehicle</dt>
              <dd className="text-paper-300 text-right">
                {VEHICLE_CLASSES.find((v) => v.id === effectiveVehicleClass)?.label}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Party</dt>
              <dd className="text-paper-300 tnum text-right">
                {passengers} {passengers === 1 ? "passenger" : "passengers"}, {luggage}{" "}
                {luggage === 1 ? "bag" : "bags"}
              </dd>
            </div>
          </dl>
        )}
      </aside>
    </div>
  );
}

function StepIndicator({ step }: { step: number }) {
  const steps = ["Ride", "Vehicle", "Details"];
  return (
    <ol className="mb-10 flex items-center gap-3" aria-label="Progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n === step ? "current" : n < step ? "done" : "upcoming";
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={`text-xs tracking-[0.14em] uppercase transition-colors ${
                state === "current"
                  ? "text-brass-400"
                  : state === "done"
                    ? "text-paper-300"
                    : "text-paper-500"
              }`}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span className={`h-px w-8 ${n < step ? "bg-paper-500" : "bg-ink-600"}`} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
