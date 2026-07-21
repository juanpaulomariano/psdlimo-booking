"use client";

/**
 * Places (New) Autocomplete, called directly from the browser.
 *
 * WHY BROWSER-SIDE: NEXT_PUBLIC_MAPS_BROWSER_KEY is locked by HTTP referrer.
 * Proxying through our own server would strip the referrer and get a 403 — the
 * restriction only works if the call originates from the page.
 *
 * Billing: Google charges autocomplete per *session*, not per keystroke. One
 * sessionToken covers every keystroke up to a selection, so a 12-character
 * search bills once rather than twelve times. The token is regenerated after
 * each selection — reusing it would silently merge sessions.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

const AUTOCOMPLETE_ENDPOINT = "https://places.googleapis.com/v1/places:autocomplete";

/** SF Bay Area bias — results near the client's operating area rank first. */
const BAY_AREA_CENTER = { latitude: 37.7749, longitude: -122.4194 };
const BIAS_RADIUS_METRES = 50_000; // API maximum

const DEBOUNCE_MS = 220;
const MIN_QUERY_LENGTH = 3;

type Suggestion = {
  placeId: string;
  /** Full address — this is what we submit for routing. */
  full: string;
  /** "The Ritz-Carlton, San Francisco" */
  main: string;
  /** "Stockton Street, San Francisco, CA, USA" */
  secondary: string;
};

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Rendered beneath the field in danger colour. */
  error?: string;
  required?: boolean;
  autoFocus?: boolean;
};

export function AddressAutocomplete({
  label,
  value,
  onChange,
  placeholder,
  error,
  required,
  autoFocus,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);

  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  const sessionToken = useRef<string>(crypto.randomUUID());
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  /** Set when the user picks a suggestion, so we don't immediately re-search it. */
  const justSelected = useRef(false);

  const fetchSuggestions = useCallback(async (query: string) => {
    const apiKey = process.env.NEXT_PUBLIC_MAPS_BROWSER_KEY;
    if (!apiKey) {
      // Loud in dev, silent for the customer — typing a full address still works.
      console.error(
        "[autocomplete] NEXT_PUBLIC_MAPS_BROWSER_KEY is not set. " +
          "Address suggestions are disabled; typed addresses still work.",
      );
      return;
    }

    // Supersede any in-flight request so a slow early keystroke cannot land
    // after a fast later one and repopulate the list with stale results.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const response = await fetch(AUTOCOMPLETE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
        },
        body: JSON.stringify({
          input: query,
          sessionToken: sessionToken.current,
          locationBias: {
            circle: { center: BAY_AREA_CENTER, radius: BIAS_RADIUS_METRES },
          },
          // Bay Area service only; keeps irrelevant global results out.
          includedRegionCodes: ["us"],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(`[autocomplete] Places API ${response.status}: ${body}`);
        setSuggestions([]);
        return;
      }

      const data: {
        suggestions?: Array<{
          placePrediction?: {
            placeId?: string;
            text?: { text?: string };
            structuredFormat?: {
              mainText?: { text?: string };
              secondaryText?: { text?: string };
            };
          };
        }>;
      } = await response.json();

      const parsed: Suggestion[] = (data.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId && p?.text?.text))
        .map((p) => ({
          placeId: p.placeId!,
          full: p.text!.text!,
          main: p.structuredFormat?.mainText?.text ?? p.text!.text!,
          secondary: p.structuredFormat?.secondaryText?.text ?? "",
        }));

      setSuggestions(parsed);
      setOpen(parsed.length > 0);
      setActiveIndex(-1);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // superseded
      console.error("[autocomplete] request failed:", err);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search on value change. Both branches run inside the timeout so
  // the effect body never calls setState synchronously — that would cascade an
  // extra render on every single keystroke.
  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }

    clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (value.trim().length < MIN_QUERY_LENGTH) {
        abortRef.current?.abort();
        setSuggestions([]);
        setOpen(false);
        return;
      }
      void fetchSuggestions(value);
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [value, fetchSuggestions]);

  // Close on outside click.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  function select(suggestion: Suggestion) {
    justSelected.current = true;
    onChange(suggestion.full);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
    // A session ends at selection. Reusing the token would merge the next
    // search into this one's billing session.
    sessionToken.current = crypto.randomUUID();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        break;
      case "Enter":
        // Only intercept Enter when a suggestion is highlighted, so Enter with
        // nothing selected still submits the form.
        if (activeIndex >= 0) {
          event.preventDefault();
          select(suggestions[activeIndex]);
        }
        break;
      case "Escape":
        setOpen(false);
        setActiveIndex(-1);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className="text-paper-300 mb-2 block text-xs tracking-[0.14em] uppercase">
        {label}
        {required && <span className="text-brass-400 ml-1">*</span>}
      </label>

      <div className="relative">
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-invalid={Boolean(error)}
          className={`bg-ink-700 text-paper-100 placeholder:text-paper-500 w-full rounded-sm border px-4 py-3 text-[15px] transition-colors outline-none ${
            error ? "border-danger" : "border-ink-500 focus:border-brass-400"
          }`}
        />

        {loading && (
          <div className="absolute top-1/2 right-4 -translate-y-1/2" aria-hidden>
            <div className="border-paper-500 border-t-brass-400 h-3.5 w-3.5 animate-spin rounded-full border-[1.5px]" />
          </div>
        )}
      </div>

      {error && <p className="text-danger mt-1.5 text-xs">{error}</p>}

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="border-ink-500 bg-ink-800 animate-fade-rise absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-sm border shadow-2xl shadow-black/60"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              // onMouseDown, not onClick: mousedown fires before the input's
              // blur, so the list is still mounted when the click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                select(s);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`cursor-pointer border-b px-4 py-2.5 text-sm last:border-b-0 ${
                i === activeIndex ? "bg-ink-600" : ""
              } border-ink-700`}
            >
              <div className="text-paper-100">{s.main}</div>
              {s.secondary && <div className="text-paper-500 mt-0.5 text-xs">{s.secondary}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
