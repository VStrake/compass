/**
 * Flat zone overlay polygons (tenant suites, common, core, circulation…).
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Same plan → world mapping as the slab builder: plan `Vec2 { x, y }` → world
 * `(x, ·, y)`. The result is a flat, single-sided `ShapeGeometry` at y = 0 whose
 * normal points **up** (+Y), so it reads correctly as a floor overlay; the
 * caller lifts it a few millimeters above the slab to avoid z-fighting.
 *
 * Orientation trick: the shape is authored with plan `y` **negated**, then
 * rotated by −90° about X, which maps (x, y, z) → (x, z, −y). Plan (px, −py, 0)
 * therefore lands on world (px, 0, py) — the exact plan mapping, no mirroring —
 * while the shape's +Z normal becomes +Y.
 */

import * as THREE from 'three';
import type { Polygon } from '../model/types';
import { ensureCCW, ensureCW, polygonArea } from './polygon';

const EPS = 1e-4;

function toNegatedShapePoints(poly: Polygon): THREE.Vector2[] {
  return poly.map((p) => new THREE.Vector2(p.x, -p.y));
}

/**
 * Build a flat overlay geometry for a zone outline (optionally with holes).
 * Degenerate outlines return a minimal valid geometry.
 */
export function buildZoneGeometry(outline: Polygon, holes: Polygon[] = []): THREE.BufferGeometry {
  if (outline.length < 3 || polygonArea(outline) <= EPS) {
    const g = new THREE.PlaneGeometry(EPS, EPS);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  const shape = new THREE.Shape(toNegatedShapePoints(ensureCCW(outline)));
  for (const hole of holes) {
    if (hole.length < 3) continue;
    shape.holes.push(new THREE.Path(toNegatedShapePoints(ensureCW(hole))));
  }

  const geometry = new THREE.ShapeGeometry(shape, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}
