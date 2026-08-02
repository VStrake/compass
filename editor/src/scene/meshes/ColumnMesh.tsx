'use client';

/**
 * One structural column, floor slab to floor slab.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Columns have no builder in `core/geometry` because they are a single
 * primitive: a box for `rect`, a cylinder for `round`, translated so the base
 * sits on the slab top (y = 0 in floor space) and the head reaches the floor
 * height.
 */

import { memo, useCallback, useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import type { Column, ColumnId, FloorId } from '@/core/model/types';
import { findFloor } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';

import { COLUMN_MATERIAL, SELECTION_MATERIAL } from '../materials';
import { useIsSelected } from '../hooks';
import { pickEntity } from '../pick';

const MIN_SIZE = 1e-3;

function buildColumnGeometry(column: Column, height: number): THREE.BufferGeometry {
  const h = Math.max(height, MIN_SIZE);
  const width = Math.max(column.width, MIN_SIZE);
  const depth = Math.max(column.depth, MIN_SIZE);

  const geometry =
    column.shape === 'round'
      ? new THREE.CylinderGeometry(width / 2, width / 2, h, 16, 1)
      : new THREE.BoxGeometry(width, h, depth);
  geometry.translate(0, h / 2, 0);
  geometry.computeBoundingSphere();
  return geometry;
}

export interface ColumnMeshProps {
  floorId: FloorId;
  columnId: ColumnId;
  floorHeight: number;
}

function ColumnMeshImpl({ floorId, columnId, floorHeight }: ColumnMeshProps) {
  const column = useEditorStore((state) =>
    findFloor(state.project, floorId)?.columns.find((candidate) => candidate.id === columnId),
  );
  const selected = useIsSelected('column', columnId);

  const geometry = useMemo(
    () => (column ? buildColumnGeometry(column, floorHeight) : null),
    [column, floorHeight],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => pickEntity(event, 'column', columnId, floorId),
    [floorId, columnId],
  );

  if (!column || !geometry) return null;

  return (
    <mesh
      position={[column.position.x, 0, column.position.y]}
      geometry={geometry}
      material={selected ? SELECTION_MATERIAL : COLUMN_MATERIAL}
      onClick={onClick}
    />
  );
}

export const ColumnMesh = memo(ColumnMeshImpl);
