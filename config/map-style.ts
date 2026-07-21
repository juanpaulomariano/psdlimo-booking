/**
 * Google Static Maps styling — dark, near-monochrome, to match the page.
 *
 * A default Google map dropped into this UI looks like a screenshot from a
 * different website: bright, blue-and-beige, high chroma. These rules mute it
 * to the same ink-and-brass palette so the map reads as part of the product.
 *
 * Format is Static Maps' `style=` syntax:
 *   feature:<f>|element:<e>|<rule>:<value>
 * Unknown rules are IGNORED by Google rather than erroring, so this is safe to
 * extend without risking a broken image.
 */

export const MAP_STYLE_PARAMS: readonly string[] = [
  // Base: dark ink, light text
  "feature:all|element:geometry|color:0x1b1b1e",
  "feature:all|element:labels.text.fill|color:0x8a8884",
  "feature:all|element:labels.text.stroke|color:0x0b0b0c|weight:2",
  "feature:all|element:labels.icon|visibility:off",

  // Administrative — keep boundaries faint
  "feature:administrative|element:geometry|color:0x26262a",
  "feature:administrative.land_parcel|element:all|visibility:off",
  "feature:administrative.neighborhood|element:all|visibility:off",

  // Points of interest — off. On a booking map they are noise, and POI labels
  // clutter the route line at small sizes.
  "feature:poi|element:all|visibility:off",
  "feature:poi.park|element:geometry|color:0x16181a",

  // Roads — legible but recessive, so the brass route line dominates
  "feature:road|element:geometry|color:0x26262a",
  "feature:road|element:geometry.stroke|visibility:off",
  "feature:road|element:labels.text.fill|color:0x6f6d69",
  "feature:road.highway|element:geometry|color:0x35353b",
  "feature:road.arterial|element:labels|visibility:off",
  "feature:road.local|element:labels|visibility:off",

  // Highway SHIELDS (the I-280 / US-101 badges) render in full colour — bright
  // blue and red — which is the only thing that breaks the monochrome once
  // everything else is muted. Turning off highway labels removes them; the
  // route is communicated by the A/B pins and the line, not by road numbers.
  "feature:road.highway|element:labels|visibility:off",

  // Transit — off, irrelevant to a chauffeur booking
  "feature:transit|element:all|visibility:off",

  // Water — darker than land so the Bay reads clearly without shouting
  "feature:water|element:geometry|color:0x0d0e10",
  "feature:water|element:labels.text.fill|color:0x4a4844",
];
