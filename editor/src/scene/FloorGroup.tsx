'use client';

/**
 * One floor plate: everything on it, positioned at its display elevation.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * The group's origin is the **slab top**, matching the geometry builders' local
 * spaces: slabs hang below y = 0, walls/columns/cores/furniture grow up from it,
 * zone overlays float millimetres above it.
 *
 * ## Subscription shape
 * This component subscribes to its own `Floor` object, so it re-renders whenever
 * anything on *this* floor changes (immer replaces the floor object along the
 * mutated path) — but never when another floor changes. That re-render only
 * re-creates React elements: every child is `memo`ized on primitive props and
 * memoizes its geometry on its own entity's identity, so the edited entity is
 * the only one that touches the GPU (ARCHITECTURE §2).
 *
 * The floor positions *itself* rather than being positioned by `BuildingGroup`:
 * elevation depends on the floor's own height/index plus the view mode, and
 * keeping that here means a floor height edit does not re-render the building.
 */

import { memo } from 'react';

import type { FloorId } from '@/core/model/types';
import { findFloor, floorDisplayElevation } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';

import { ColumnMesh } from './meshes/ColumnMesh';
import { CoreMesh } from './meshes/CoreMesh';
import { FurnitureMesh } from './meshes/FurnitureMesh';
import { SlabMesh } from './meshes/SlabMesh';
import { WallMesh } from './meshes/WallMesh';
import { ZoneOverlay } from './meshes/ZoneOverlay';

export interface FloorGroupProps {
  floorId: FloorId;
  /**
   * Hidden floors keep their geometry mounted and cached — solo/explode are
   * culling modes, not unmounts (ARCHITECTURE §7.6).
   */
  visible: boolean;
}

function FloorGroupImpl({ floorId, visible }: FloorGroupProps) {
  const floor = useEditorStore((state) => findFloor(state.project, floorId));
  const elevation = useEditorStore((state) => {
    const current = findFloor(state.project, floorId);
    return current ? floorDisplayElevation(current, state.floorViewMode, state.explodeGap) : 0;
  });

  if (!floor) return null;

  return (
    <group position={[0, elevation, 0]} visible={visible}>
      {floor.slabs.map((slab) => (
        <SlabMesh key={slab.id} floorId={floorId} slabId={slab.id} />
      ))}

      {floor.zones.map((zone) => (
        <ZoneOverlay key={zone.id} floorId={floorId} zoneId={zone.id} />
      ))}

      {floor.cores.map((core) => (
        <CoreMesh key={core.id} floorId={floorId} coreId={core.id} />
      ))}

      {floor.columns.map((column) => (
        <ColumnMesh
          key={column.id}
          floorId={floorId}
          columnId={column.id}
          floorHeight={floor.height}
        />
      ))}

      {floor.walls.map((wall) => (
        <WallMesh
          key={wall.id}
          floorId={floorId}
          wallId={wall.id}
          floorHeight={floor.height}
          floorElevation={elevation}
        />
      ))}

      {floor.furniture.map((item) => (
        <FurnitureMesh key={item.id} floorId={floorId} furnitureId={item.id} />
      ))}
    </group>
  );
}

export const FloorGroup = memo(FloorGroupImpl);
