/**
 * Entity factories & document defaults.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Every factory returns a fully-populated, JSON-serializable record with a
 * freshly minted branded id. Callers may narrow behaviour with `overrides`.
 */

import {
  newBuildingId,
  newColumnId,
  newCoreId,
  newFloorId,
  newFurnitureId,
  newOpeningId,
  newProjectId,
  newSlabId,
  newTenantId,
  newWallId,
  newZoneId,
} from './ids';
import { getCatalogItem } from './catalog';
import type {
  Building,
  Column,
  Core,
  CoreKind,
  Floor,
  FurnitureInstance,
  Opening,
  OpeningKind,
  Polygon,
  ProjectDoc,
  Slab,
  Tenant,
  TenantId,
  TenantStatus,
  Vec2,
  Wall,
  WallKind,
  Zone,
  ZoneKind,
} from './types';

/** Product-wide authoring defaults, in meters. */
export const DEFAULTS = {
  /** Wall thickness by kind (meters). */
  wallThickness: {
    exterior: 0.3,
    demising: 0.2,
    interior: 0.15,
    partition: 0.1,
    glass: 0.06,
  } as Record<WallKind, number>,

  /** Typical floor-to-floor height for an upper level. */
  floorHeight: 3.6,
  /** Ground floors carry lobby volume and building services. */
  groundFloorHeight: 4.5,
  /** Structural slab thickness. */
  slabThickness: 0.3,

  /** Plan grid. */
  gridSize: 0.5,
  gridSnap: true,
  angleSnap: true,

  /** Default opening dimensions by kind: width / height / sill (meters). */
  opening: {
    door: { width: 0.95, height: 2.1, sillHeight: 0 },
    'double-door': { width: 1.8, height: 2.1, sillHeight: 0 },
    'glass-door': { width: 1.0, height: 2.2, sillHeight: 0 },
    window: { width: 1.5, height: 1.5, sillHeight: 0.9 },
    'ribbon-window': { width: 3.0, height: 1.8, sillHeight: 0.75 },
    'pass-through': { width: 1.2, height: 1.1, sillHeight: 0.95 },
  } as Record<OpeningKind, { width: number; height: number; sillHeight: number }>,

  buildingClass: 'A' as Building['buildingClass'],
  units: 'imperial' as ProjectDoc['settings']['units'],
} as const;

/** Human floor label: index 0 is the ground floor, then "Level 2", "Level 3"… */
export function floorName(index: number): string {
  return index === 0 ? 'Ground Floor' : `Level ${index + 1}`;
}

/** Default floor-to-floor height for a given level index. */
export function defaultFloorHeight(index: number): number {
  return index === 0 ? DEFAULTS.groundFloorHeight : DEFAULTS.floorHeight;
}

export function createFloor(
  index: number,
  elevation: number,
  height: number,
  overrides?: Partial<Omit<Floor, 'id'>>,
): Floor {
  return {
    id: newFloorId(),
    name: floorName(index),
    index,
    elevation,
    height,
    slabs: [],
    walls: [],
    columns: [],
    cores: [],
    zones: [],
    furniture: [],
    ...overrides,
  };
}

export function createWall(
  kind: WallKind,
  start: Vec2,
  end: Vec2,
  overrides?: Partial<Omit<Wall, 'id' | 'kind' | 'start' | 'end'>>,
): Wall {
  return {
    id: newWallId(),
    kind,
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    thickness: DEFAULTS.wallThickness[kind],
    height: null,
    openings: [],
    ...overrides,
  };
}

export function createOpening(
  kind: OpeningKind,
  offset: number,
  overrides?: Partial<Omit<Opening, 'id' | 'kind' | 'offset'>>,
): Opening {
  const preset = DEFAULTS.opening[kind];
  return {
    id: newOpeningId(),
    kind,
    offset,
    width: preset.width,
    height: preset.height,
    sillHeight: preset.sillHeight,
    ...overrides,
  };
}

export function createSlab(
  outline: Polygon,
  holes: Polygon[] = [],
  thickness: number = DEFAULTS.slabThickness,
): Slab {
  return { id: newSlabId(), outline, holes, thickness };
}

export function createColumn(
  position: Vec2,
  width = 0.6,
  depth = 0.6,
  shape: Column['shape'] = 'rect',
): Column {
  return { id: newColumnId(), position, width, depth, shape };
}

export function createCore(kind: CoreKind, outline: Polygon, label?: string): Core {
  return label === undefined
    ? { id: newCoreId(), kind, outline }
    : { id: newCoreId(), kind, outline, label };
}

export function createZone(
  name: string,
  kind: ZoneKind,
  outline: Polygon,
  tenantId: TenantId | null = null,
): Zone {
  return { id: newZoneId(), name, kind, outline, tenantId };
}

export function createTenant(
  name: string,
  color: string,
  status: TenantStatus = 'leased',
  extras?: { industry?: string; leaseExpiry?: string },
): Tenant {
  const tenant: Tenant = { id: newTenantId(), name, color, status };
  if (extras?.industry !== undefined) tenant.industry = extras.industry;
  if (extras?.leaseExpiry !== undefined) tenant.leaseExpiry = extras.leaseExpiry;
  return tenant;
}

/**
 * Place a catalog item. `catalogId` is validated against the catalog so bad
 * ids fail loudly at authoring time rather than silently rendering nothing.
 */
export function createFurniture(
  catalogId: string,
  position: Vec2,
  rotation = 0,
): FurnitureInstance {
  if (!getCatalogItem(catalogId)) {
    throw new Error(`createFurniture: unknown catalogId "${catalogId}"`);
  }
  return { id: newFurnitureId(), catalogId, position: { x: position.x, y: position.y }, rotation };
}

/** An axis-aligned rectangle in plan space, CCW in the (x, y→z) plan mapping. */
export function rect(x: number, y: number, w: number, d: number): Polygon {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + d },
    { x, y: y + d },
  ];
}

/**
 * Recompute cumulative elevations from floor heights, bottom-up. The array is
 * assumed sorted by `index`; the first floor sits at elevation 0.
 * Mutates in place (immer-draft friendly) and returns the same array.
 */
export function recomputeElevations(floors: Floor[]): Floor[] {
  let elevation = 0;
  for (const floor of floors) {
    floor.elevation = elevation;
    elevation += floor.height;
  }
  return floors;
}

export function createEmptyProject(name: string): ProjectDoc {
  const now = new Date().toISOString();
  const ground = createFloor(0, 0, DEFAULTS.groundFloorHeight);
  const building: Building = {
    id: newBuildingId(),
    name,
    buildingClass: DEFAULTS.buildingClass,
    floors: [ground],
  };
  return {
    schemaVersion: 1,
    id: newProjectId(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: {
      units: DEFAULTS.units,
      grid: { size: DEFAULTS.gridSize, snap: DEFAULTS.gridSnap, angleSnap: DEFAULTS.angleSnap },
    },
    meta: {
      ownerId: null,
      collaborators: [],
      export: {
        watermark: { enabled: true, text: 'Compass Studio' },
        allowGltf: true,
        allowJson: true,
      },
    },
    building,
    tenants: {},
  };
}
