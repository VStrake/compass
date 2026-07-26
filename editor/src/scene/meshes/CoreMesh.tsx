'use client';

/**
 * One building-core element (elevator bank, stair, restroom, shaft…).
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Cores are authored as plan outlines with no height; for v1 they render as a
 * low **schematic massing block** so the core reads as occupied, non-leasable
 * area from any angle without hiding the plate behind full-height solids.
 *
 * ## Orientation
 * Same trick as `core/geometry/zone.ts`: the shape is authored with plan `y`
 * negated, then rotated −90° about X, which maps (x, y, z) → (x, z, −y). Plan
 * (px, −py, 0) therefore lands on world (px, 0, py) — the exact plan mapping,
 * no mirroring — and the extrusion depth (+Z) becomes **+Y**, i.e. upward from
 * the slab, with the top cap pointing up.
 *
 * There is no `buildCoreGeometry` in `core/geometry` yet (cores land properly
 * in roadmap M1's core planner), so the extrusion is done here from the shared,
 * pure `polygon` helpers.
 */

import { memo, useCallback, useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import { ensureCCW, ensureCW } from '@/core/geometry/polygon';
import type { CoreId, FloorId, Polygon } from '@/core/model/types';
import { findFloor } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';

import { CORE_MATERIAL, SELECTION_MATERIAL } from '../materials';
import { useIsSelected } from '../hooks';
import { pickEntity } from '../pick';

/** Schematic block height, meters. Tall enough to read, low enough to see over. */
const CORE_BLOCK_HEIGHT = 1.2;

function toNegatedPoints(polygon: Polygon): THREE.Vector2[] {
  return polygon.map((point) => new THREE.Vector2(point.x, -point.y));
}

function buildCoreBlockGeometry(outline: Polygon, height: number): THREE.BufferGeometry {
  if (outline.length < 3) {
    const fallback = new THREE.BoxGeometry(1e-3, height, 1e-3);
    fallback.translate(0, height / 2, 0);
    return fallback;
  }

  const shape = new THREE.Shape(toNegatedPoints(ensureCCW(outline)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Exported so the (future) core planner can reuse the same prism. */
export function buildCorePrism(
  outline: Polygon,
  holes: Polygon[],
  height: number,
): THREE.BufferGeometry {
  if (outline.length < 3) return buildCoreBlockGeometry(outline, height);
  const shape = new THREE.Shape(toNegatedPoints(ensureCCW(outline)));
  for (const hole of holes) {
    if (hole.length < 3) continue;
    shape.holes.push(new THREE.Path(toNegatedPoints(ensureCW(hole))));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}

export interface CoreMeshProps {
  floorId: FloorId;
  coreId: CoreId;
}

function CoreMeshImpl({ floorId, coreId }: CoreMeshProps) {
  const core = useEditorStore((state) =>
    findFloor(state.project, floorId)?.cores.find((candidate) => candidate.id === coreId),
  );
  const selected = useIsSelected('core', coreId);

  const geometry = useMemo(
    () => (core ? buildCoreBlockGeometry(core.outline, CORE_BLOCK_HEIGHT) : null),
    [core],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => pickEntity(event, 'core', coreId, floorId),
    [floorId, coreId],
  );

  if (!core || !geometry) return null;

  return (
    <mesh
      geometry={geometry}
      material={selected ? SELECTION_MATERIAL : CORE_MATERIAL}
      onClick={onClick}
    />
  );
}

export const CoreMesh = memo(CoreMeshImpl);
