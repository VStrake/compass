/**
 * Pure document lookups used by the scene and UI layers.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * These are plain functions over `ProjectDoc` (no hooks, no store import) so
 * they compose inside `useEditorStore(s => findWall(s.project, …))`
 * subscriptions. Because immer preserves object identity along unmutated
 * paths, a lookup that returns the same entity object lets React skip the
 * component entirely — object identity IS the dirty flag (ARCHITECTURE §2).
 */

import type {
  Column,
  ColumnId,
  Core,
  CoreId,
  EntityKind,
  Floor,
  FloorId,
  FurnitureId,
  FurnitureInstance,
  Opening,
  OpeningId,
  ProjectDoc,
  Slab,
  SlabId,
  Tenant,
  TenantId,
  Wall,
  WallId,
  Zone,
  ZoneId,
} from '@/core/model/types';

export interface Selection {
  kind: EntityKind;
  id: string;
  floorId: FloorId | null;
}

// —— floors ——————————————————————————————————————————————————————
export function findFloor(project: ProjectDoc, floorId: FloorId | null): Floor | undefined {
  if (!floorId) return undefined;
  return project.building.floors.find((floor) => floor.id === floorId);
}

export function findFloorByIndex(project: ProjectDoc, index: number): Floor | undefined {
  return project.building.floors.find((floor) => floor.index === index);
}

export function floorCount(project: ProjectDoc): number {
  return project.building.floors.length;
}

/** Total structural height: Σ floor heights. */
export function buildingHeight(project: ProjectDoc): number {
  return project.building.floors.reduce((sum, floor) => sum + floor.height, 0);
}

/**
 * Y offset at which a floor should be drawn for the current view mode.
 * `stack` uses the authored elevation; `explode` adds a per-index gap.
 */
export function floorDisplayElevation(
  floor: Floor,
  mode: 'stack' | 'explode' | 'solo',
  explodeGap: number,
): number {
  return mode === 'explode' ? floor.elevation + floor.index * explodeGap : floor.elevation;
}

// —— walls ——————————————————————————————————————————————————————
export function findWall(
  project: ProjectDoc,
  floorId: FloorId | null,
  wallId: WallId,
): Wall | undefined {
  return findFloor(project, floorId)?.walls.find((wall) => wall.id === wallId);
}

/** Floor-agnostic wall lookup (scans every floor). */
export function findWallById(project: ProjectDoc, wallId: WallId): Wall | undefined {
  for (const floor of project.building.floors) {
    const wall = floor.walls.find((candidate) => candidate.id === wallId);
    if (wall) return wall;
  }
  return undefined;
}

/** The floor that owns a wall — needed when only the wall id is known. */
export function findFloorOfWall(project: ProjectDoc, wallId: WallId): Floor | undefined {
  return project.building.floors.find((floor) => floor.walls.some((wall) => wall.id === wallId));
}

export function findOpening(
  project: ProjectDoc,
  floorId: FloorId | null,
  wallId: WallId,
  openingId: OpeningId,
): Opening | undefined {
  return findWall(project, floorId, wallId)?.openings.find((o) => o.id === openingId);
}

/** Floor-agnostic opening lookup (scans every wall on every floor). */
export function findOpeningById(project: ProjectDoc, openingId: OpeningId): Opening | undefined {
  for (const floor of project.building.floors) {
    for (const wall of floor.walls) {
      const opening = wall.openings.find((candidate) => candidate.id === openingId);
      if (opening) return opening;
    }
  }
  return undefined;
}

// —— slabs / zones / furniture / columns / cores ————————————————
export function findSlab(
  project: ProjectDoc,
  floorId: FloorId | null,
  slabId: SlabId,
): Slab | undefined {
  return findFloor(project, floorId)?.slabs.find((slab) => slab.id === slabId);
}

export function findSlabById(project: ProjectDoc, slabId: SlabId): Slab | undefined {
  for (const floor of project.building.floors) {
    const slab = floor.slabs.find((candidate) => candidate.id === slabId);
    if (slab) return slab;
  }
  return undefined;
}

export function findZone(
  project: ProjectDoc,
  floorId: FloorId | null,
  zoneId: ZoneId,
): Zone | undefined {
  return findFloor(project, floorId)?.zones.find((zone) => zone.id === zoneId);
}

export function findZoneById(project: ProjectDoc, zoneId: ZoneId): Zone | undefined {
  for (const floor of project.building.floors) {
    const zone = floor.zones.find((candidate) => candidate.id === zoneId);
    if (zone) return zone;
  }
  return undefined;
}

export function findFurniture(
  project: ProjectDoc,
  floorId: FloorId | null,
  furnitureId: FurnitureId,
): FurnitureInstance | undefined {
  return findFloor(project, floorId)?.furniture.find((item) => item.id === furnitureId);
}

export function findFurnitureById(
  project: ProjectDoc,
  furnitureId: FurnitureId,
): FurnitureInstance | undefined {
  for (const floor of project.building.floors) {
    const item = floor.furniture.find((candidate) => candidate.id === furnitureId);
    if (item) return item;
  }
  return undefined;
}

export function findColumnById(project: ProjectDoc, columnId: ColumnId): Column | undefined {
  for (const floor of project.building.floors) {
    const column = floor.columns.find((candidate) => candidate.id === columnId);
    if (column) return column;
  }
  return undefined;
}

export function findCoreById(project: ProjectDoc, coreId: CoreId): Core | undefined {
  for (const floor of project.building.floors) {
    const core = floor.cores.find((candidate) => candidate.id === coreId);
    if (core) return core;
  }
  return undefined;
}

// —— tenants ————————————————————————————————————————————————————
export function findTenant(project: ProjectDoc, tenantId: TenantId | null): Tenant | undefined {
  if (!tenantId) return undefined;
  return project.tenants[tenantId];
}

export function listTenants(project: ProjectDoc): Tenant[] {
  return Object.values(project.tenants);
}

/** Every zone in the building assigned to a tenant, with its floor. */
export function findTenantZones(
  project: ProjectDoc,
  tenantId: TenantId,
): { floor: Floor; zone: Zone }[] {
  const out: { floor: Floor; zone: Zone }[] = [];
  for (const floor of project.building.floors) {
    for (const zone of floor.zones) {
      if (zone.tenantId === tenantId) out.push({ floor, zone });
    }
  }
  return out;
}

// —— selection ——————————————————————————————————————————————————
/**
 * Resolve a selection to its entity object, or `undefined` when the entity no
 * longer exists (e.g. after an undo). The store uses this to prune stale
 * selections.
 */
export function findEntityBySelection(
  project: ProjectDoc,
  selection: Selection | null,
): unknown | undefined {
  if (!selection) return undefined;
  const { kind, id, floorId } = selection;
  switch (kind) {
    case 'building':
      return project.building.id === id ? project.building : undefined;
    case 'floor':
      return findFloor(project, id as FloorId);
    case 'wall':
      return floorId ? findWall(project, floorId, id as WallId) : findWallById(project, id as WallId);
    case 'opening':
      return findOpeningById(project, id as OpeningId);
    case 'slab':
      return floorId ? findSlab(project, floorId, id as SlabId) : findSlabById(project, id as SlabId);
    case 'zone':
      return floorId ? findZone(project, floorId, id as ZoneId) : findZoneById(project, id as ZoneId);
    case 'furniture':
      return floorId
        ? findFurniture(project, floorId, id as FurnitureId)
        : findFurnitureById(project, id as FurnitureId);
    case 'column':
      return findColumnById(project, id as ColumnId);
    case 'core':
      return findCoreById(project, id as CoreId);
    case 'tenant':
      return project.tenants[id as TenantId];
    default:
      return undefined;
  }
}

/** True when the selection still points at a live entity. */
export function selectionExists(project: ProjectDoc, selection: Selection | null): boolean {
  return findEntityBySelection(project, selection) !== undefined;
}

/** Convenience predicate for scene meshes: "am I the selected entity?" */
export function isSelected(
  selection: Selection | null,
  kind: EntityKind,
  id: string,
): boolean {
  return selection !== null && selection.kind === kind && selection.id === id;
}
