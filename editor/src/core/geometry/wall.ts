/**
 * Wall solid generation with openings (segment splitting, no CSG).
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Local wall space (see ARCHITECTURE §4 / §7.4):
 *   +X  runs along the wall, 0 → L where L = |end − start|
 *   +Y  is up, 0 → wall height
 *   +Z  is the thickness axis, centered: −t/2 → +t/2
 *
 * The caller places the mesh with {@link wallTransform}: the group sits at the
 * wall's start point and yaws so local +X follows the wall direction. Keeping
 * the geometry in local space means an unchanged wall's geometry is reusable
 * regardless of where the wall sits.
 *
 * Openings never use boolean CSG: the wall is cut into full-height segments
 * between openings, plus an under-sill box and a header box per opening. This
 * is exact, cheap, and produces clean quads for the renderer.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Wall } from '../model/types';

/** Anything thinner/shorter than this is treated as zero. */
const EPS = 1e-4;

interface NormalizedOpening {
  /** Along-wall extent, clamped into [0, L]. */
  start: number;
  end: number;
  /** Vertical extent, clamped into [0, H]. */
  sill: number;
  top: number;
}

function box(w: number, h: number, d: number, cx: number, cy: number, cz: number) {
  const g = new THREE.BoxGeometry(Math.max(w, EPS), Math.max(h, EPS), Math.max(d, EPS));
  g.translate(cx, cy, cz);
  return g;
}

/** Plan length of the wall centerline, in meters. */
export function wallLength(wall: Wall): number {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

/** Effective wall height: explicit override, else the floor height. */
export function wallHeight(wall: Wall, floorHeight: number): number {
  return wall.height ?? floorHeight;
}

/**
 * World placement for a wall whose geometry came from
 * {@link buildWallGeometry}. `position` is the wall's start point on the floor
 * plane (plan `y` → world `z`), `rotationY` yaws local +X onto the wall
 * direction. Add the floor elevation to `position[1]`.
 */
export function wallTransform(wall: Wall): {
  position: [number, number, number];
  rotationY: number;
} {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  // A group yawed by θ maps local +X to world (cosθ, 0, −sinθ); we need
  // (dx, 0, dy)/L, hence θ = −atan2(dy, dx).
  return { position: [wall.start.x, 0, wall.start.y], rotationY: -Math.atan2(dy, dx) };
}

/**
 * Normalize, clamp and de-overlap the wall's openings.
 * Openings are sorted by offset; any opening that overlaps one already
 * accepted is skipped (last-writer-loses) so the segment walk stays monotonic.
 */
function normalizeOpenings(wall: Wall, length: number, height: number): NormalizedOpening[] {
  const sorted = [...wall.openings].sort((a, b) => a.offset - b.offset);
  const out: NormalizedOpening[] = [];
  let cursor = 0;

  for (const opening of sorted) {
    // Clamp an over-wide opening to the wall length.
    const width = Math.min(Math.max(opening.width, 0), length);
    if (width <= EPS) continue;

    let start = opening.offset - width / 2;
    let end = opening.offset + width / 2;
    // Slide (rather than crop) an opening that hangs off either end.
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > length) {
      start -= end - length;
      end = length;
    }
    start = Math.max(0, start);
    if (end - start <= EPS) continue;

    // Overlap with an already accepted opening → skip.
    if (start < cursor - EPS) continue;

    const sill = Math.min(Math.max(opening.sillHeight, 0), height);
    const top = Math.min(sill + Math.max(opening.height, 0), height);
    if (top - sill <= EPS) continue; // degenerate: leave the wall solid here

    out.push({ start, end, sill, top });
    cursor = end;
  }

  return out;
}

/**
 * Build the solid geometry for one wall in local wall space.
 * Always returns a valid, non-empty geometry (a minimal box for degenerate
 * walls) so scene components never have to null-check.
 */
export function buildWallGeometry(wall: Wall, floorHeight: number): THREE.BufferGeometry {
  const length = wallLength(wall);
  const height = Math.max(wallHeight(wall, floorHeight), EPS);
  const thickness = Math.max(wall.thickness, EPS);

  // Zero-length wall (both endpoints snapped together): minimal stub.
  if (length <= EPS) {
    return box(EPS, height, thickness, EPS / 2, height / 2, 0);
  }

  const openings = normalizeOpenings(wall, length, height);
  const pieces: THREE.BufferGeometry[] = [];
  let cursor = 0;

  for (const op of openings) {
    // Full-height segment before the opening.
    const segment = op.start - cursor;
    if (segment > EPS) {
      pieces.push(box(segment, height, thickness, cursor + segment / 2, height / 2, 0));
    }
    const width = op.end - op.start;
    // Under-sill box (windows, pass-throughs).
    if (op.sill > EPS) {
      pieces.push(box(width, op.sill, thickness, op.start + width / 2, op.sill / 2, 0));
    }
    // Header box above the opening.
    const header = height - op.top;
    if (header > EPS) {
      pieces.push(
        box(width, header, thickness, op.start + width / 2, op.top + header / 2, 0),
      );
    }
    cursor = op.end;
  }

  // Trailing full-height segment.
  if (length - cursor > EPS) {
    const segment = length - cursor;
    pieces.push(box(segment, height, thickness, cursor + segment / 2, height / 2, 0));
  }

  // Everything was consumed by a full-height, full-length opening.
  if (pieces.length === 0) {
    return box(length, EPS, thickness, length / 2, 0, 0);
  }
  if (pieces.length === 1) {
    return pieces[0]!;
  }

  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) {
    // Defensive: mergeGeometries only fails on attribute mismatch, which can
    // not happen for BoxGeometry inputs.
    return box(length, height, thickness, length / 2, height / 2, 0);
  }
  merged.computeBoundingSphere();
  return merged;
}
