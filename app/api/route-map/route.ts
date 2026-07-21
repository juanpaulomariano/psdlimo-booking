/**
 * GET /api/route-map?pickup=…&dropoff=…
 *
 * Proxies a Google Static Maps image for the booked route.
 *
 * WHY PROXY INSTEAD OF POINTING <img> STRAIGHT AT GOOGLE:
 *   · a direct <img src> would need the API key IN THE URL, i.e. visible in
 *     page source, devtools, and the browser history of every visitor
 *   · going through here keeps GOOGLE_MAPS_SERVER_KEY server-side, so the
 *     public browser key gains no new capability
 *   · it lets us cache, and fail softly (204) instead of rendering a broken
 *     image with Google's error text baked into it
 *
 * DISPLAY ONLY. This never returns a distance and nothing here feeds the
 * pricing engine — the priced distance comes from computeRouteMatrix and
 * nowhere else. Two disagreeing mileage figures on screen would be worse than
 * no map at all. See DEMO_NOTES.md item 3a.
 */

import { MAP_STYLE_PARAMS } from "@/config/map-style";

/** Cache for a day: the same A→B always renders the same image. */
const CACHE_SECONDS = 86_400;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pickup = searchParams.get("pickup")?.trim();
  const dropoff = searchParams.get("dropoff")?.trim();
  // Retina by default; the client asks for 1 when it does not need it.
  const scale = searchParams.get("scale") === "1" ? "1" : "2";

  if (!pickup || pickup.length < 3) {
    return new Response(null, { status: 204 });
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    console.error("[route-map] GOOGLE_MAPS_SERVER_KEY is not set");
    return new Response(null, { status: 204 });
  }

  const params = new URLSearchParams({
    size: "640x360",
    scale,
    format: "png",
    maptype: "roadmap",
    key: apiKey,
  });

  // Custom markers: brass pin at pickup, white at drop-off. Labels A/B so the
  // direction of travel is readable without a legend.
  params.append("markers", `color:0xc9a961|label:A|${pickup}`);
  if (dropoff && dropoff.length >= 3) {
    params.append("markers", `color:0xf5f4f1|label:B|${dropoff}`);
    /*
     * A STRAIGHT LINE, DELIBERATELY — and it must never be mistaken for the
     * priced distance.
     *
     * Measured on SFO -> Hotel Zephyr: the straight line is 13.1 mi while the
     * real driving distance is 16.0 mi — 23% longer by road. Pricing off the
     * straight line would undercharge that single ride by $13.39.
     *
     * The price comes from Routes API computeRouteMatrix in lib/maps.ts, which
     * returns true road distance, and it is imported ONLY by /api/quote and
     * /api/checkout. This file imports no pricing code, and the RouteMap
     * component receives only two address strings — it cannot see a distance or
     * a price. The two paths are structurally incapable of crossing.
     *
     * Drawing the real polyline would need a Directions call returning its own
     * mileage, which could disagree with the priced figure and put two
     * conflicting numbers in front of the customer.
     */
    params.append("path", `color:0xc9a961aa|weight:3|${pickup}|${dropoff}`);
  }

  // Dark styling to match the page. Google ignores unknown style params rather
  // than erroring, so this is safe.
  for (const style of MAP_STYLE_PARAMS) params.append("style", style);

  let response: Response;
  try {
    response = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`, {
      next: { revalidate: CACHE_SECONDS },
    });
  } catch (err) {
    console.error("[route-map] request failed:", err);
    return new Response(null, { status: 204 });
  }

  if (!response.ok) {
    // Google returns the reason as PLAIN TEXT in the body, and would otherwise
    // render it as an image. 204 so the UI simply hides the map instead.
    const detail = await response.text().catch(() => "");
    console.error(`[route-map] Google Static Maps ${response.status}: ${detail.slice(0, 200)}`);
    return new Response(null, { status: 204 });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/png",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, immutable`,
    },
  });
}
