"use client";

/**
 * Static map of the booked route.
 *
 * DISPLAY ONLY — it shows WHERE the ride goes, never HOW FAR. The price comes
 * from computeRouteMatrix server-side and this component has no access to it.
 * Two disagreeing mileage figures on screen would be worse than no map at all.
 *
 * FAILS INVISIBLY. If the Static Maps API is not enabled, the key is missing, or
 * Google is down, /api/route-map answers 204 and this renders nothing. A booking
 * flow must never break because a decorative image did not load.
 */

import { useEffect, useState } from "react";

type Props = {
  pickup: string;
  dropoff?: string;
  /** Skips the fetch entirely for ride types with no fixed destination. */
  hidden?: boolean;
};

export function RouteMap({ pickup, dropoff, hidden }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [src, setSrc] = useState<string | null>(null);

  // Derived, not stored: whether there is anything to draw at all. Computing it
  // here rather than clearing state inside the effect avoids a cascading render
  // on every keystroke while the address is still being typed.
  const shouldRender = !hidden && pickup.trim().length >= 3;

  useEffect(() => {
    if (!shouldRender) return;

    let cancelled = false;
    const controller = new AbortController();

    const params = new URLSearchParams({ pickup });
    if (dropoff && dropoff.trim().length >= 3) params.set("dropoff", dropoff);
    const url = `/api/route-map?${params}`;

    // Fetch rather than pointing <img src> straight at the endpoint: a 204 on an
    // <img> leaves a broken-image icon, whereas here we can simply render nothing.
    (async () => {
      setState("loading");
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (cancelled) return;

        if (!response.ok || response.status === 204) {
          setState("unavailable");
          return;
        }

        const blob = await response.blob();
        if (cancelled) return;

        setSrc((previous) => {
          if (previous) URL.revokeObjectURL(previous); // don't leak blob URLs
          return URL.createObjectURL(blob);
        });
        setState("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!cancelled) setState("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pickup, dropoff, shouldRender]);

  // Release the last blob URL on unmount.
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount only
  }, []);

  if (!shouldRender || state === "idle" || state === "unavailable") return null;

  return (
    <figure className="border-ink-600 bg-ink-800/50 animate-fade-rise overflow-hidden rounded-sm border">
      <div className="relative aspect-[16/9] w-full">
        {state === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="border-paper-500 border-t-brass-400 h-4 w-4 animate-spin rounded-full border-2" />
          </div>
        )}
        {src && (
          // Plain <img>: the source is a blob URL, which next/image cannot
          // optimise, and the file is already sized by the API request.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={dropoff ? `Map of the route from ${pickup} to ${dropoff}` : `Map of ${pickup}`}
            className={`h-full w-full object-cover transition-opacity duration-500 ${
              state === "ready" ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
      </div>

      {dropoff && (
        <figcaption className="border-ink-600 flex items-center gap-2.5 border-t px-4 py-2.5 text-xs">
          <span className="bg-brass-400 h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden />
          <span className="text-paper-300 truncate">{pickup}</span>
          <span className="text-paper-500 shrink-0" aria-hidden>
            →
          </span>
          <span className="bg-paper-100 h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden />
          <span className="text-paper-300 truncate">{dropoff}</span>
        </figcaption>
      )}
    </figure>
  );
}
