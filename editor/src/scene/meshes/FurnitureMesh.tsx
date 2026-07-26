'use client';

/**
 * One furniture / fixture instance.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Furniture geometry is a pure function of the **catalog item**, not of the
 * instance, so it is cached module-wide per `catalogId` and shared by every
 * instance on every floor (ARCHITECTURE §7.4). A tower with 4,000 desks builds
 * one desk geometry. Cache entries are never disposed: the catalog is small and
 * bounded, and this is exactly the shape the future
 * `InstancedMesh`-per-catalog-item upgrade needs.
 */

import { memo, useCallback } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type * as THREE from 'three';

import { buildFurnitureGeometry } from '@/core/geometry/furniture';
import { getCatalogItem } from '@/core/model/catalog';
import type { FloorId, FurnitureId } from '@/core/model/types';
import { findFurniture } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';

import { SELECTION_MATERIAL, getFurnitureMaterial } from '../materials';
import { useIsSelected } from '../hooks';
import { pickEntity } from '../pick';

const GEOMETRY_CACHE = new Map<string, THREE.BufferGeometry>();

/** Shared geometry for a catalog id, built on first use. */
function getFurnitureGeometry(catalogId: string): THREE.BufferGeometry | null {
  const cached = GEOMETRY_CACHE.get(catalogId);
  if (cached) return cached;

  const item = getCatalogItem(catalogId);
  if (!item) return null;

  const geometry = buildFurnitureGeometry(item);
  GEOMETRY_CACHE.set(catalogId, geometry);
  return geometry;
}

export interface FurnitureMeshProps {
  floorId: FloorId;
  furnitureId: FurnitureId;
}

function FurnitureMeshImpl({ floorId, furnitureId }: FurnitureMeshProps) {
  const item = useEditorStore((state) => findFurniture(state.project, floorId, furnitureId));
  const selected = useIsSelected('furniture', furnitureId);

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => pickEntity(event, 'furniture', furnitureId, floorId),
    [floorId, furnitureId],
  );

  if (!item) return null;

  const catalogItem = getCatalogItem(item.catalogId);
  const geometry = getFurnitureGeometry(item.catalogId);
  // An instance referencing an unknown catalog key renders nothing rather than
  // throwing — imported documents may predate a catalog change.
  if (!catalogItem || !geometry) return null;

  return (
    <mesh
      position={[item.position.x, 0, item.position.y]}
      rotation={[0, item.rotation, 0]}
      geometry={geometry}
      material={selected ? SELECTION_MATERIAL : getFurnitureMaterial(catalogItem.category)}
      onClick={onClick}
    />
  );
}

export const FurnitureMesh = memo(FurnitureMeshImpl);
