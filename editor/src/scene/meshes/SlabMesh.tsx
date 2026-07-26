'use client';

/**
 * One structural slab.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Subscribes to exactly its own `Slab` object. `buildSlabGeometry` puts the top
 * face at y = 0 with the body hanging below, so the mesh sits at the floor
 * group's origin with no offset (ARCHITECTURE §2, rules 1–2).
 */

import { memo, useCallback, useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';

import { buildSlabGeometry } from '@/core/geometry/slab';
import type { FloorId, SlabId } from '@/core/model/types';
import { findSlab } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';

import { SELECTION_MATERIAL, SLAB_MATERIAL } from '../materials';
import { useIsSelected } from '../hooks';
import { pickEntity } from '../pick';

export interface SlabMeshProps {
  floorId: FloorId;
  slabId: SlabId;
}

function SlabMeshImpl({ floorId, slabId }: SlabMeshProps) {
  const slab = useEditorStore((state) => findSlab(state.project, floorId, slabId));
  const selected = useIsSelected('slab', slabId);

  const geometry = useMemo(() => (slab ? buildSlabGeometry(slab) : null), [slab]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => pickEntity(event, 'slab', slabId, floorId),
    [floorId, slabId],
  );

  if (!slab || !geometry) return null;

  return (
    <mesh
      geometry={geometry}
      material={selected ? SELECTION_MATERIAL : SLAB_MATERIAL}
      onClick={onClick}
    />
  );
}

export const SlabMesh = memo(SlabMeshImpl);
