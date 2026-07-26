/**
 * Plan-extraction prompt — PROPRIETARY TRADE SECRET.
 * Confidential. © Partners Real Estate. All rights reserved.
 *
 * Kept in its own module (rather than beside the schema in `extraction.ts`) so
 * that only the server-side route handler imports it: the import dialog needs
 * the *contract*, never the prompt, so the prompt text stays out of the client
 * bundle. Do not import this from anything under `src/scene` or `src/ui`.
 *
 * The prompt is written against the coordinate frame documented in
 * `extraction.ts` (`EXTRACTION_FRAME`) and against the field descriptions in
 * `EXTRACTION_JSON_SCHEMA`; those descriptions carry the per-field detail, so
 * this text covers method, classification judgement, and the conservatism bar.
 */

import { EXTRACTION_FRAME } from './extraction';

/** Optional context the import dialog can pass through to sharpen the reading. */
export interface ExtractionHints {
  /** Floor label the user is importing onto, e.g. "Level 12". */
  floorName?: string;
  /** Rentable square feet the user already knows for this floor. */
  knownRsf?: number;
}

export const EXTRACTION_PROMPT = `You are reading a **commercial office floor plan** for a building-modelling tool used by architects, leasing brokers and property managers. The image is a marketing plan, a test fit, or an as-built drawing of one floor. Your job is to convert it into structured geometry that will be turned directly into an editable 3D model, and to do so **conservatively**: a clean partial reading is far more valuable than a complete-looking one containing invented geometry.

# Coordinate frame

All coordinates use a normalised frame fixed to the image itself:

- The image's **longer edge spans 0 to ${EXTRACTION_FRAME}**.
- The shorter edge spans 0 to ${EXTRACTION_FRAME} x (short edge / long edge), so the frame is proportional and never distorted. A landscape image spans 0-${EXTRACTION_FRAME} horizontally and less than that vertically; a portrait image the reverse.
- The origin (0, 0) is the **top-left corner**. x increases to the right, y increases **downward**.
- Work in this frame throughout. Do not report pixels, inches, or millimetres as coordinates.

Measure positions off the drawing as carefully as you can; consistency between related elements (a door sitting on its wall, a column landing on its grid line) matters more than absolute precision.

# What to extract

## Walls — centerline segments
Trace each wall as a straight segment between its two endpoints, on the wall's **centerline** (not either face). Break a wall at every corner and at every junction with another wall, so segments meet end-to-end instead of crossing. Long runs interrupted by a doorway stay a single segment — the doorway is an opening, not a gap.

Classify each segment:
- **exterior** — the building envelope / perimeter, including curtain-wall runs and window walls on the outside face of the plate.
- **demising** — a wall separating one tenancy from another, or separating a tenancy from common/core area. These are the walls that define leasable boundaries, so they matter commercially; they are often drawn heavier than interior walls, and often align with suite-label boundaries.
- **glass** — interior glazed partitions and storefronts: conference-room glass fronts, glass office fronts, glazed suite entries. Usually drawn as a thin double line, sometimes hatched or annotated GL/GLZ.
- **partition** — light, clearly non-structural dividers: low walls, screens, closet or millwork returns.
- **interior** — every other internal wall (offices, corridors, restroom and service walls).

Order matters: openings refer to walls by their index in the array you return, so keep the array stable as you write it.

## Footprint
Trace the outline of the floor plate as a closed polygon following the exterior/perimeter walls, ordered around the boundary, without repeating the first point. Follow the real shape — notches, setbacks, re-entrant corners and curved bays approximated by short chords. Return null if the perimeter runs off the edge of the image or is otherwise not fully visible; do not close it with a guessed line.

## Zones
Outline each enclosed area that carries a **printed label** or has an unmistakable commercial function. Use the printed text verbatim as the name ("SUITE 210", "LOBBY", "CONFERENCE", "BREAK ROOM", "OPEN OFFICE"). Suite numbers, tenant names and area callouts are the most valuable labels on the drawing — never paraphrase them.

- **tenant-suite** — leasable suite / demised office area, whether occupied, labelled with a tenant name, or marked available.
- **common** — shared non-leasable area: elevator lobby, shared reception, shared conference on a multi-tenant floor.
- **circulation** — corridors, vestibules, exit passages.
- **core** — the area occupied by the vertical core itself.
- **amenity** — conference centre, fitness, cafe/pantry serving the building, lounge, terrace.
- **service** — janitor, storage, mail, copy/print, loading, back-of-house.

If the plan prints a square-footage figure for a space ("4,512 RSF", "2,105 SF", "USF 3,200"), put the number in labeledAreaSqft. Only ever transcribe a printed figure — never compute or estimate one; leave it null otherwise. These figures are cross-checked against computed areas downstream, so a fabricated number is worse than a missing one.

## Cores
Outline the building-core elements and classify them:
- **stair** — stair enclosures, usually with the run drawn inside and labelled STAIR / ST-1 / "STAIR A" / EXIT.
- **elevator-bank** — elevator shafts and cabs, often a row of hoistways off a lobby; label ELEV / EL.
- **restroom** — labelled MEN'S / WOMEN'S / RESTROOM / TOILET / WC, or identifiable by fixture symbols.
- **electrical** — ELEC / EE / electrical closet or room.
- **telecom** — IDF / MDF / TEL / DATA / COMM.
- **mechanical** — MECH / HVAC / AHU / fan room.
- **shaft** — trash/refuse chute, plumbing chase, and any unlabelled vertical shaft. Also use **shaft** for a janitor closet only if it is clearly a chase; a labelled janitor/custodial closet belongs in zones as **service**.
Copy any printed label verbatim into label, else null.

## Openings
For each door and window you can see, report the wall it sits in (by index), where along that wall its centre falls (positionRatio, 0 at the segment's first endpoint and 1 at the second), and its kind:
- **door** — single leaf, usually a quarter-circle swing arc.
- **double-door** — a pair of leaves, two opposed arcs.
- **glass-door** — glazed entry, typically in a storefront or glass suite front.
- **window** — an opening in an exterior or glazed wall.
Give widthMeters only when the drawing dimensions the opening or the scale makes it genuinely measurable; otherwise null and a sensible default is applied. If you cannot tell which wall segment a door belongs to, omit that door.

## Columns
Report the centre of each structural column — small filled or cross-hatched squares/circles, almost always repeating on a regular structural grid. Use the grid to place them consistently. Do not report furniture, plumbing fixtures, symbols, dimension ticks or the north arrow as columns.

# Scale estimate

Estimate metersPerFrameUnit, the plan meters spanned by one frame unit, and say in basis how you got it. In order of reliability:

1. A **graphic scale bar** — measure its printed length in frame units and divide by the real length it represents.
2. A **printed dimension string** — a dimension line such as 32'-0" or 9750 between two identifiable points; measure that span in frame units and divide.
3. A **printed ratio** such as 1/8" = 1'-0" combined with a measurable known element.
4. A **typical element** — a single door leaf is about 0.9 m, a double door about 1.8 m, a corridor 1.5-2.0 m wide, a structural bay 6-9 m, a private office 3.0-3.7 m deep. Say which element you used.

Convert feet and inches to meters (1 ft = 0.3048 m). Sanity-check the result: a typical office plate's long dimension is 30-90 m, which puts metersPerFrameUnit in roughly the 0.03-0.10 range; a value outside 0.005-1.0 almost certainly means an arithmetic slip. If there is no usable evidence at all, return null for metersPerFrameUnit and an empty basis — the user will calibrate by hand, and a wrong guess costs them more than no guess.

# Conservatism — the most important rule

Report only what you can actually see in this image.

- Omit anything you are unsure of rather than guessing. Missing geometry is easy to draw in; invented geometry has to be found and deleted.
- Do not complete symmetry, extend walls past where they are drawn, or infer rooms behind a legend, title block, key plan, or furniture cluster that hides them.
- Do not invent suite numbers, tenant names or square footages.
- Ignore everything that is not the plan itself: title block, north arrow, legend, key plan, revision table, dimension and leader lines, furniture, plumbing fixtures, floor-pattern hatching, elevation callouts, and any adjacent floor shown as a small key diagram.
- If the image shows more than one plan (for example two suites side by side, or a plan plus an inset), extract only the single largest, most complete floor plan and note that in notes.

# Notes

Use notes for one to three short sentences on anything a modeller should know before trusting the output: "scale bar illegible, scale from typical door width", "floor shown as open shell, space not demised", "west end of plate cropped", "furniture layout obscures partitions in the north-east corner", "suite areas printed but do not sum to the stated floor RSF". Leave it as an empty string when the reading is unambiguous.

Return only the structured object defined by the schema.`;

/** Render the optional user-supplied context as a short extra prompt block. */
export function formatExtractionHints(hints: ExtractionHints | undefined): string | null {
  if (!hints) return null;
  const lines: string[] = [];
  if (typeof hints.floorName === 'string' && hints.floorName.trim() !== '') {
    lines.push(`- The user is importing this plan onto the floor labelled "${hints.floorName.trim().slice(0, 80)}".`);
  }
  if (typeof hints.knownRsf === 'number' && Number.isFinite(hints.knownRsf) && hints.knownRsf > 0) {
    lines.push(
      `- The user states this floor is approximately ${Math.round(hints.knownRsf)} rentable square feet. Use it only as a sanity check on your scale estimate — do not force your reading to match it, and do not report it as a labeledAreaSqft figure.`,
    );
  }
  if (lines.length === 0) return null;
  return `Additional context supplied by the user:\n${lines.join('\n')}`;
}
