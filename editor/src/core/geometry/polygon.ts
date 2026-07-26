/**
 * Planar polygon math.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Pure TypeScript — deliberately free of three.js so `core/analysis` can use it
 * in Node (tests, server-side reporting).
 *
 * Plan space: `Vec2 { x, y }` in meters. Positive signed area = CCW when the
 * plan is read as a standard 2D (x right, y up) drawing. When mapped into the
 * world as (x, ·, y) the handedness flips, so a plan-CCW ring appears clockwise
 * when looked at from above — irrelevant for area math, relevant for normals
 * (handled inside the geometry builders).
 */

import type { Polygon, Vec2 } from '../model/types';

/**
 * Shoelace signed area (m²). Positive for CCW rings, negative for CW.
 * Degenerate rings (< 3 points) have zero area.
 */
export function signedArea(poly: Polygon): number {
  const n = poly.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Unsigned area (m²), winding-independent. */
export function polygonArea(poly: Polygon): number {
  return Math.abs(signedArea(poly));
}

/** True when the ring is wound counter-clockwise in plan space. */
export function isCCW(poly: Polygon): boolean {
  return signedArea(poly) > 0;
}

/**
 * Area-weighted centroid. Falls back to the vertex average for degenerate
 * (zero-area / collinear) rings so callers always get a usable anchor point.
 */
export function centroid(poly: Polygon): Vec2 {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n < 3) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }

  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const cross = a.x * b.y - b.x * a.y;
    a2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }

  if (Math.abs(a2) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }

  const area6 = a2 * 3; // (a2 / 2) * 6
  return { x: cx / area6, y: cy / area6 };
}

/**
 * Even-odd ray-cast containment test. Points exactly on an edge are reported
 * inconsistently (by design — this is a picking/classification helper, not an
 * exact predicate).
 */
export function pointInPolygon(point: Vec2, poly: Polygon): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Return the ring wound CCW — the original array when it already is. */
export function ensureCCW(poly: Polygon): Polygon {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/** Return the ring wound CW — used for extrusion holes. */
export function ensureCW(poly: Polygon): Polygon {
  return signedArea(poly) > 0 ? [...poly].reverse() : poly;
}

/** Axis-aligned plan bounds. Empty rings yield a zero box at the origin. */
export function polygonBounds(poly: Polygon): { min: Vec2; max: Vec2 } {
  if (poly.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** Perimeter length (m) of the closed ring. */
export function polygonPerimeter(poly: Polygon): number {
  const n = poly.length;
  if (n < 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
