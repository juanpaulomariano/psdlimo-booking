/**
 * Google Routes API — driving distance between two addresses.
 *
 * SERVER ONLY. This module reads GOOGLE_MAPS_SERVER_KEY and must never be
 * imported from a client component; doing so would bundle the key into the
 * browser. The browser uses NEXT_PUBLIC_MAPS_BROWSER_KEY for Places autocomplete
 * and nothing else.
 *
 * We use Routes API `computeRouteMatrix`, NOT the classic Distance Matrix API —
 * the latter is legacy and may not be enabled for a newly created GCP project.
 *
 * Docs verified at build time:
 *   POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
 *   X-Goog-FieldMask is REQUIRED — the response is empty without it.
 *   distanceMeters is always metres; the miles conversion is ours.
 */

import "server-only";

const ROUTES_ENDPOINT = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

const METRES_PER_MILE = 1609.344;

/** Google returns per-element status/condition; these are the ones we accept. */
const ROUTE_EXISTS = "ROUTE_EXISTS";

export type RouteResult = {
  distanceMiles: number;
  durationMinutes: number;
  /** True when the figures came from the mock, not from Google. */
  mocked: boolean;
};

/** Thrown for any routing failure. The API layer converts this to a 4xx/5xx. */
export class RoutingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NO_ROUTE"
      | "INVALID_ADDRESS"
      | "API_ERROR"
      | "MISSING_KEY"
      | "QUOTA",
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

/**
 * Deterministic stand-in used only when USE_MOCK_MAPS=1 and no key is set.
 * Exists so the wizard and pricing can be developed and demoed before the
 * Google account is provisioned. It is deterministic (hash-derived, not random)
 * so a given pair of addresses always yields the same quote — a jittering price
 * would look like a pricing bug during a demo.
 *
 * NEVER silently active: callers log a loud warning, and it refuses to run when
 * a real key is present.
 */
function mockRoute(origin: string, destination: string): RouteResult {
  let hash = 0;
  const seed = `${origin.toLowerCase().trim()}→${destination.toLowerCase().trim()}`;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  // 4–44 miles, stable per address pair.
  const distanceMiles = Math.round((4 + (Math.abs(hash) % 4000) / 100) * 10) / 10;
  // Rough city-driving average, ~26 mph plus a fixed overhead.
  const durationMinutes = Math.round(distanceMiles * 2.3 + 8);
  return { distanceMiles, durationMinutes, mocked: true };
}

function shouldUseMock(): boolean {
  return process.env.USE_MOCK_MAPS === "1" && !process.env.GOOGLE_MAPS_SERVER_KEY;
}

/**
 * Driving distance and duration from `origin` to `destination`.
 *
 * @throws {RoutingError} on a missing key, an unroutable pair, or an API failure.
 *   Never returns a fallback distance on error — a wrong distance silently
 *   becomes a wrong price on a real invoice.
 */
export async function getDrivingRoute(origin: string, destination: string): Promise<RouteResult> {
  if (shouldUseMock()) {
    console.warn(
      `[maps] USE_MOCK_MAPS=1 — returning MOCK distance for "${origin}" → "${destination}". ` +
        `Prices are not real. Unset USE_MOCK_MAPS before any client demo.`,
    );
    return mockRoute(origin, destination);
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    throw new RoutingError(
      "GOOGLE_MAPS_SERVER_KEY is not set. Add it to .env.local (see .env.example), " +
        "or set USE_MOCK_MAPS=1 to develop without Google.",
      "MISSING_KEY",
    );
  }

  let response: Response;
  try {
    response = await fetch(ROUTES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // REQUIRED. Without a field mask the API returns empty elements.
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,distanceMeters,status,condition",
      },
      body: JSON.stringify({
        origins: [{ waypoint: { address: origin } }],
        destinations: [{ waypoint: { address: destination } }],
        travelMode: "DRIVE",
        // TRAFFIC_AWARE gives a realistic duration without the latency cost of
        // TRAFFIC_AWARE_OPTIMAL. Distance is unaffected by this setting.
        routingPreference: "TRAFFIC_AWARE",
      }),
      // Quotes must reflect current conditions; never serve a cached route.
      cache: "no-store",
    });
  } catch (err) {
    throw new RoutingError(
      `Could not reach the Google Routes API: ${err instanceof Error ? err.message : String(err)}`,
      "API_ERROR",
    );
  }

  if (!response.ok) {
    // Google puts the useful detail in the body, so read it before throwing.
    const body = await response.text().catch(() => "<unreadable>");
    console.error(`[maps] Routes API ${response.status}: ${body}`);

    if (response.status === 429) {
      throw new RoutingError("Google Routes API quota exceeded.", "QUOTA");
    }
    if (response.status === 403) {
      throw new RoutingError(
        "Google Routes API rejected the key (403). Check that the Routes API is enabled " +
          "for the project and that the key's API restrictions include it.",
        "API_ERROR",
      );
    }
    throw new RoutingError(`Google Routes API returned ${response.status}.`, "API_ERROR");
  }

  const data: unknown = await response.json();

  // A 1×1 matrix returns a single-element array.
  if (!Array.isArray(data) || data.length === 0) {
    throw new RoutingError("Google Routes API returned an unexpected response shape.", "API_ERROR");
  }

  const element = data[0] as {
    condition?: string;
    distanceMeters?: number;
    duration?: string;
    status?: { code?: number; message?: string };
  };

  // A non-empty status object signals a per-element failure (e.g. a bad address).
  if (element.status && Object.keys(element.status).length > 0) {
    console.error(`[maps] element status: ${JSON.stringify(element.status)}`);
    throw new RoutingError(
      "One of the addresses could not be resolved. Please pick an address from the suggestions.",
      "INVALID_ADDRESS",
    );
  }

  if (element.condition !== ROUTE_EXISTS) {
    throw new RoutingError(
      "No driving route exists between those two locations.",
      "NO_ROUTE",
    );
  }

  if (typeof element.distanceMeters !== "number") {
    throw new RoutingError(
      "Google Routes API did not return a distance. Check the X-Goog-FieldMask header.",
      "API_ERROR",
    );
  }

  // duration arrives as a protobuf duration string, e.g. "1234s".
  const durationSeconds = Number.parseInt(String(element.duration ?? "0"), 10);

  return {
    distanceMiles: Math.round((element.distanceMeters / METRES_PER_MILE) * 10) / 10,
    durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    mocked: false,
  };
}
