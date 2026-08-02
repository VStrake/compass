'use client';

/**
 * The drawing-context reference grid, drawn on the active floor's plane.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * ## Why not drei's `<Grid>`
 * drei's `<Grid>` is a GLSL `shaderMaterial`. `WebGPURenderer` builds every
 * material through its node library, which has no entry for `ShaderMaterial`
 * (on either the WebGPU or the WebGL2 fallback backend), so the grid would
 * render as an opaque default-material plane across the whole viewport. This is
 * a `LineSegments` grid on `LineBasicMaterial`, which maps to
 * `LineBasicNodeMaterial` and behaves identically on both backends.
 *
 * ## Fade
 * There is no per-fragment distance fade without a shader, so density falls off
 * structurally instead: cell lines are clipped to an inner disc and section
 * lines run out to the full radius. Clipping to a **disc** (rather than a
 * square) also removes the hard corners that would otherwise read as a box
 * around the building.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { GRID_CELL_MATERIAL, GRID_SECTION_MATERIAL } from './materials';

const NO_RAYCAST = () => null;

export interface ReferenceGridProps {
  /** World Y of the grid plane. */
  elevation: number;
  /** Fine cell spacing, meters. */
  cellSize?: number;
  /** Heavier section spacing, meters. Should be a multiple of `cellSize`. */
  sectionSize?: number;
  /** Radius out to which section lines are drawn. */
  radius?: number;
  /** Radius out to which fine cell lines are drawn. */
  cellRadius?: number;
}

/**
 * Axis-aligned line pairs clipped to a disc of `radius`, skipping any
 * coordinate that is a multiple of `skipMultipleOf` (those belong to the
 * heavier section pass).
 */
function buildGridGeometry(
  spacing: number,
  radius: number,
  skipMultipleOf: number | null,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const steps = Math.floor(radius / spacing);

  for (let step = -steps; step <= steps; step += 1) {
    const u = step * spacing;
    if (skipMultipleOf !== null) {
      const ratio = u / skipMultipleOf;
      if (Math.abs(ratio - Math.round(ratio)) < 1e-6) continue;
    }
    // Half-chord of the disc at offset u.
    const half = Math.sqrt(Math.max(radius * radius - u * u, 0));
    if (half <= spacing * 0.5) continue;

    // Line parallel to X (varies in world x, fixed world z = u).
    positions.push(-half, 0, u, half, 0, u);
    // Line parallel to Z.
    positions.push(u, 0, -half, u, 0, half);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function ReferenceGrid({
  elevation,
  cellSize = 2,
  sectionSize = 10,
  radius = 220,
  cellRadius = 72,
}: ReferenceGridProps) {
  const cellGeometry = useMemo(
    () => buildGridGeometry(cellSize, cellRadius, sectionSize),
    [cellSize, cellRadius, sectionSize],
  );
  const sectionGeometry = useMemo(
    () => buildGridGeometry(sectionSize, radius, null),
    [sectionSize, radius],
  );

  useEffect(() => () => cellGeometry.dispose(), [cellGeometry]);
  useEffect(() => () => sectionGeometry.dispose(), [sectionGeometry]);

  const cells = useMemo(() => {
    const object = new THREE.LineSegments(cellGeometry, GRID_CELL_MATERIAL);
    object.renderOrder = -2;
    return object;
  }, [cellGeometry]);

  const sections = useMemo(() => {
    const object = new THREE.LineSegments(sectionGeometry, GRID_SECTION_MATERIAL);
    object.renderOrder = -1;
    return object;
  }, [sectionGeometry]);

  // A hair above the plane so it never z-fights the slab it sits on.
  return (
    <group position={[0, elevation + 0.012, 0]}>
      <primitive object={cells} raycast={NO_RAYCAST} />
      <primitive object={sections} raycast={NO_RAYCAST} />
    </group>
  );
}
