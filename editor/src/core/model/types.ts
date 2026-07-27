/**
 * Compass Studio — canonical data model.
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * Design rules (see docs/ARCHITECTURE.md §4):
 *  - Branded IDs so cross-references cannot be mixed up.
 *  - Plain JSON-serializable data — the document IS the save format.
 *  - 2D plan footprints + floor elevation/height for the third dimension.
 *  - Commercial-first: tenants, zone classification and ownership are
 *    first-class, not add-ons.
 *
 * This module is pure TypeScript: no React, no three.js. It must stay
 * importable from Node (tests, future server-side analytics/migrations).
 */

// —— primitives ————————————————————————————————————————————————
type Brand<T, B extends string> = T & { readonly __brand: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type BuildingId = Brand<string, 'BuildingId'>;
export type FloorId = Brand<string, 'FloorId'>;
export type WallId = Brand<string, 'WallId'>;
export type SlabId = Brand<string, 'SlabId'>;
export type OpeningId = Brand<string, 'OpeningId'>;
export type ZoneId = Brand<string, 'ZoneId'>;
export type ColumnId = Brand<string, 'ColumnId'>;
export type CoreId = Brand<string, 'CoreId'>;
export type FurnitureId = Brand<string, 'FurnitureId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;

/** A point in plan space, in meters. Plan `y` maps to world `z`. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Counter-clockwise ring with implicit closure (last point joins the first). */
export type Polygon = Vec2[];

/**
 * Every addressable entity kind in the document. Used by the selection model
 * so the UI/scene layers can discriminate on a single string.
 */
export type EntityKind =
  | 'building'
  | 'floor'
  | 'wall'
  | 'slab'
  | 'opening'
  | 'zone'
  | 'column'
  | 'core'
  | 'furniture'
  | 'tenant';

// —— document root ——————————————————————————————————————————————
export interface ProjectDoc {
  schemaVersion: 1;
  id: ProjectId;
  name: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  /** Ownership / sharing / export policy — the paid-tier enforcement point. */
  meta: ProjectMeta;
  building: Building;
  tenants: Record<TenantId, Tenant>;
}

export interface ProjectSettings {
  /** Display units only — storage is always meters. */
  units: 'metric' | 'imperial';
  grid: { size: number; snap: boolean; angleSnap: boolean };
}

// —— proprietary product layer (auth/db land later; shape is ready now) ——
export interface ProjectMeta {
  ownerId: UserId | null;
  collaborators: Collaborator[];
  export: ExportPolicy;
}

export interface Collaborator {
  userId: UserId;
  role: 'viewer' | 'commenter' | 'editor' | 'admin';
}

export interface ExportPolicy {
  watermark: { enabled: boolean; text: string };
  allowGltf: boolean;
  allowJson: boolean;
}

// —— building hierarchy —————————————————————————————————————————
export interface Building {
  id: BuildingId;
  name: string;
  address?: string;
  buildingClass: 'A' | 'B' | 'C';
  /** Sorted by `index`, ascending. */
  floors: Floor[];
}

export interface Floor {
  id: FloorId;
  /** Human label, e.g. "Level 12". */
  name: string;
  /** 0 = ground. */
  index: number;
  /** Meters to the slab top; cumulative from the floor heights below. */
  elevation: number;
  /** Floor-to-floor height in meters. */
  height: number;
  slabs: Slab[];
  walls: Wall[];
  columns: Column[];
  cores: Core[];
  zones: Zone[];
  furniture: FurnitureInstance[];
  /**
   * Imported source plan pinned under the plate for visual QA (M1.5 Plan
   * import). Optional and additive: absent/null on every document authored
   * before plan import, so `schemaVersion` stays 1.
   */
  underlay?: FloorUnderlay | null;
}

/**
 * A raster floor plan (marketing plan, as-built scan) laid flat on the plate as
 * a semi-transparent reference image.
 *
 * The image is stored **inline as a data URL** so the project document stays a
 * single self-contained JSON file (ARCHITECTURE §9 — the document is the save
 * format). Scale comes from two-point calibration, not from image DPI.
 */
export interface FloorUnderlay {
  /** PNG/JPEG/WebP data URL — `data:image/png;base64,…`. */
  imageDataUrl: string;
  /** Calibration result: plan meters per image pixel. */
  metersPerPixel: number;
  /** Natural image width, pixels. */
  imageWidth: number;
  /** Natural image height, pixels. */
  imageHeight: number;
  /** World offset of the image **center**, plan meters. */
  offset: Vec2;
  /** Radians about +Y (same convention as `FurnitureInstance.rotation`). */
  rotation: number;
  /** 0..1. */
  opacity: number;
  /** False hides the underlay without discarding the calibration. */
  visible: boolean;
}

// —— structure ——————————————————————————————————————————————————
export type WallKind = 'exterior' | 'interior' | 'partition' | 'glass' | 'demising';

export interface Wall {
  id: WallId;
  kind: WallKind;
  start: Vec2;
  end: Vec2;
  thickness: number;
  /** null → inherit the floor height. */
  height: number | null;
  /** Sorted by `offset`. */
  openings: Opening[];
}

export type OpeningKind =
  | 'door'
  | 'double-door'
  | 'glass-door'
  | 'window'
  | 'ribbon-window'
  | 'pass-through';

export interface Opening {
  id: OpeningId;
  kind: OpeningKind;
  /** Center of the opening along the wall, meters from `start`. */
  offset: number;
  width: number;
  height: number;
  /** Meters from the floor to the bottom of the opening; 0 for doors. */
  sillHeight: number;
}

export interface Slab {
  id: SlabId;
  outline: Polygon;
  holes: Polygon[];
  thickness: number;
}

export interface Column {
  id: ColumnId;
  position: Vec2;
  width: number;
  depth: number;
  shape: 'rect' | 'round';
}

export type CoreKind =
  | 'elevator-bank'
  | 'stair'
  | 'restroom'
  | 'mechanical'
  | 'electrical'
  | 'telecom'
  | 'shaft';

export interface Core {
  id: CoreId;
  kind: CoreKind;
  outline: Polygon;
  label?: string;
}

// —— commercial zoning & tenants ————————————————————————————————
export type ZoneKind = 'tenant-suite' | 'common' | 'core' | 'amenity' | 'circulation' | 'service';

export interface Zone {
  id: ZoneId;
  name: string;
  kind: ZoneKind;
  outline: Polygon;
  /** Only meaningful for `tenant-suite`; null = vacant / unassigned. */
  tenantId: TenantId | null;
  /**
   * Leasing facts carried over from a rent roll, when the zone came from one.
   * `rsf` is the *authoritative* rentable area off the rent roll and may differ
   * from the polygon's computed area — reports quote this when present and fall
   * back to geometry otherwise. Optional so documents without it stay
   * schemaVersion 1.
   */
  suite?: SuiteFacts;
}

/** Leasing facts for a suite, sourced from a rent roll rather than geometry. */
export interface SuiteFacts {
  /** Suite number as printed on the rent roll, e.g. "2450". */
  number?: string;
  /** Rentable square feet per the rent roll (not square meters). */
  rsf?: number;
  /** Asking base rent, $/RSF/year. */
  baseRent?: number;
  /** Operating expenses / NNN, $/RSF/year. */
  nnn?: number;
  /** ISO date the space becomes available, or "immediate". */
  availableDate?: string;
  /** Condition or marketing notes from the rent roll. */
  notes?: string;
}

export type TenantStatus = 'vacant' | 'leased' | 'proposed' | 'expiring';

export interface Tenant {
  id: TenantId;
  name: string;
  /** Hex color, e.g. "#4f9cf9". */
  color: string;
  status: TenantStatus;
  industry?: string;
  /** ISO date. */
  leaseExpiry?: string;
}

// —— furniture ——————————————————————————————————————————————————
export type FurnitureCategory =
  | 'desk'
  | 'workstation'
  | 'seating'
  | 'conference'
  | 'reception'
  | 'storage'
  | 'break-room'
  | 'server'
  | 'fixture';

export interface CatalogItem {
  /** Stable catalog key (not a branded id — it is a content address). */
  id: string;
  name: string;
  category: FurnitureCategory;
  /** Bounding footprint in meters: width (x), depth (z), height (y). */
  footprint: { w: number; d: number; h: number };
}

export interface FurnitureInstance {
  id: FurnitureId;
  catalogId: string;
  position: Vec2;
  /** Radians about +Y. */
  rotation: number;
}

// —— analytics (computed, never stored) —————————————————————————
export interface FloorAreaReport {
  floorId: FloorId;
  /** Slab outlines − holes, m². */
  grossArea: number;
  /** tenant-suite + amenity zones, m². */
  rentableArea: number;
  /** common + circulation + service zones, m². */
  commonArea: number;
  /** core zones (fallback: Core record outlines), m². */
  coreArea: number;
  /** rentable / gross; 0 when gross is 0. */
  efficiency: number;
  byTenant: { tenantId: TenantId | null; area: number }[];
}

export interface BuildingAreaReport {
  floors: FloorAreaReport[];
  totals: Omit<FloorAreaReport, 'floorId' | 'byTenant'> & {
    byTenant: FloorAreaReport['byTenant'];
  };
}
