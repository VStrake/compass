/**
 * Floor slab prism from an outline + holes.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * ## Plan → world mapping
 * A plan point `Vec2 { x, y }` maps to world `(x, ·, y)`: plan `y` becomes
 * world `z`, and world `y` is up.
 *
 * ## Orientation
 * The returned geometry lies in the XZ plane with its **top face at y = 0** and
 * the body extending **downward** to `y = −thickness`. That way a floor group
 * positioned at the floor's `elevation` puts the walkable surface exactly at
 * that elevation and the structure hangs below it, as built.
 *
 * ## Implementation
 * `THREE.Shape` is authored in the shape's XY plane using the plan coordinates
 * verbatim (x → x, plan y → shape y) and extruded along +Z by `thickness`.
 * A single `rotateX(+90°)` then maps (x, y, z) → (x, −z, y), which:
 *   - sends plan (px, py, 0) to world (px, 0, py) — the exact plan mapping,
 *     with **no mirroring**;
 *   - sends the extrusion depth (+Z) to −Y, i.e. downward;
 *   - sends the z = 0 cap normal (−Z) to +Y, so the top face points up.
 */

import * as THREE from 'three';
import type { Polygon, Slab } from '../model/types';
import { ensureCCW, ensureCW } from './polygon';

const EPS = 1e-4;

function toShapePoints(poly: Polygon): THREE.Vector2[] {
  return poly.map((p) => new THREE.Vector2(p.x, p.y));
}

/** Build a `THREE.Shape` (with holes) from plan polygons. */
export function polygonToShape(outline: Polygon, holes: Polygon[] = []): THREE.Shape {
  // Normalize windings for predictable triangulation: outline CCW, holes CW.
  const shape = new THREE.Shape(toShapePoints(ensureCCW(outline)));
  for (const hole of holes) {
    if (hole.length < 3) continue;
    shape.holes.push(new THREE.Path(toShapePoints(ensureCW(hole))));
  }
  return shape;
}

/**
 * Extrude a slab. Degenerate outlines (< 3 points) return a minimal valid
 * geometry rather than null so scene components never null-check.
 */
export function buildSlabGeometry(slab: Slab): THREE.BufferGeometry {
  const thickness = Math.max(slab.thickness, EPS);

  if (slab.outline.length < 3) {
    const g = new THREE.BoxGeometry(EPS, thickness, EPS);
    g.translate(0, -thickness / 2, 0);
    return g;
  }

  const shape = polygonToShape(slab.outline, slab.holes);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });

  geometry.rotateX(Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}
