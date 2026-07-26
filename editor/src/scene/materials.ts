/**
 * Shared material instances for the whole tower (ARCHITECTURE §7.3).
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Every material here is created **once at module scope** and reused by every
 * mesh that needs it. A 40-story plate is ~6k meshes but only a dozen
 * materials, which keeps `WebGPURenderer` pipeline/bind-group churn near zero
 * and lets the backend batch aggressively.
 *
 * ## WebGPU compatibility
 * Classic three.js materials are fine under `WebGPURenderer`: its standard
 * node library maps `MeshStandardMaterial` → `MeshStandardNodeMaterial`,
 * `MeshBasicMaterial` → `MeshBasicNodeMaterial`, `LineBasicMaterial` →
 * `LineBasicNodeMaterial`, and so on. What is *not* supported is raw
 * `ShaderMaterial` / `RawShaderMaterial` (no GLSL path through the node
 * builder), so nothing in `scene/` may use one — see `ReferenceGrid` and
 * `SceneLine` for the hand-rolled replacements of drei's shader-based `<Grid>`
 * and `<Line>`.
 *
 * Nothing in this module is ever disposed: the instances live as long as the
 * page. Per-entity clones (zone overlays) are the caller's responsibility.
 */

import * as THREE from 'three';

import type {
  FurnitureCategory,
  Tenant,
  TenantId,
  WallKind,
  Zone,
  ZoneKind,
} from '@/core/model/types';
import type { ColorMode } from '@/store/useEditorStore';

// —— dark theme constants (shared with the UI's palette) ————————————
export const BACKGROUND_COLOR = '#14161c';
export const GROUND_COLOR = '#0c0e12';
export const GRID_CELL_COLOR = '#2b3140';
export const GRID_SECTION_COLOR = '#3d4657';
export const ACCENT_COLOR = '#f59e0b';

// —— walls ————————————————————————————————————————————————————————
/**
 * Exterior curtain wall: tinted, mostly transparent glass. `DoubleSide` so the
 * envelope reads correctly from inside the building as well as outside.
 */
const EXTERIOR_GLASS = new THREE.MeshStandardMaterial({
  name: 'compass/wall/exterior',
  color: '#a8c6dd',
  transparent: true,
  opacity: 0.35,
  metalness: 0.1,
  roughness: 0.15,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const INTERIOR_WALL = new THREE.MeshStandardMaterial({
  name: 'compass/wall/interior',
  color: '#d6d3cd',
  roughness: 0.9,
  metalness: 0,
});

const PARTITION_WALL = new THREE.MeshStandardMaterial({
  name: 'compass/wall/partition',
  color: '#c9c4ba',
  roughness: 0.95,
  metalness: 0,
});

const DEMISING_WALL = new THREE.MeshStandardMaterial({
  name: 'compass/wall/demising',
  color: '#b8b2a6',
  roughness: 0.85,
  metalness: 0,
});

/** Interior glazed partition — clearer and thinner-reading than the envelope. */
const GLASS_PARTITION = new THREE.MeshStandardMaterial({
  name: 'compass/wall/glass',
  color: '#cfe3f0',
  transparent: true,
  opacity: 0.25,
  metalness: 0.05,
  roughness: 0.1,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const WALL_MATERIALS: Record<WallKind, THREE.Material> = {
  exterior: EXTERIOR_GLASS,
  interior: INTERIOR_WALL,
  partition: PARTITION_WALL,
  demising: DEMISING_WALL,
  glass: GLASS_PARTITION,
};

/** The shared material for a wall kind. Never dispose the result. */
export function getWallMaterial(kind: WallKind): THREE.Material {
  return WALL_MATERIALS[kind] ?? INTERIOR_WALL;
}

// —— structure ————————————————————————————————————————————————————
/** Structural slab: raw concrete, lit from above. */
export const SLAB_MATERIAL = new THREE.MeshStandardMaterial({
  name: 'compass/slab',
  color: '#8f8f95',
  roughness: 0.95,
  metalness: 0,
  side: THREE.DoubleSide,
});

/** Core massing blocks (elevator bank, stairs, restrooms, shafts). */
export const CORE_MATERIAL = new THREE.MeshStandardMaterial({
  name: 'compass/core',
  color: '#6b7280',
  roughness: 0.8,
  metalness: 0.05,
});

export const COLUMN_MATERIAL = new THREE.MeshStandardMaterial({
  name: 'compass/column',
  color: '#9aa0a8',
  roughness: 0.7,
  metalness: 0.1,
});

/** Infinite dark ground plane the tower sits on. */
export const GROUND_MATERIAL = new THREE.MeshStandardMaterial({
  name: 'compass/ground',
  color: GROUND_COLOR,
  roughness: 1,
  metalness: 0,
});

// —— zone overlays ————————————————————————————————————————————————
/**
 * Template for zone overlays. Never used directly — `createZoneMaterial()`
 * clones it per zone so each suite can carry its tenant colour. Zones are a
 * handful per floor, so the clone-per-zone pipeline cost is negligible.
 */
const ZONE_TEMPLATE = new THREE.MeshStandardMaterial({
  name: 'compass/zone',
  color: '#8b90a0',
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
  depthWrite: false,
  roughness: 1,
  metalness: 0,
});

/** A disposable per-zone overlay material. The caller owns/disposes it. */
export function createZoneMaterial(color: string, opacity: number): THREE.MeshStandardMaterial {
  const material = ZONE_TEMPLATE.clone();
  material.color.set(color);
  material.opacity = opacity;
  return material;
}

/** Fixed palette for `colorMode: 'zoneKind'`. */
const ZONE_KIND_COLORS: Record<ZoneKind, string> = {
  'tenant-suite': '#4f9cf9',
  common: '#7c8794',
  core: '#6b7280',
  amenity: '#34d399',
  circulation: '#a78bfa',
  service: '#f97316',
};

/** Suites with no tenant assigned. */
const VACANT_COLOR = '#565b66';
/** Non-suite zones in tenant mode: present but visually recessive. */
const TENANT_MODE_NEUTRAL = '#4b5160';

/**
 * Overlay colour (hex) for a zone under the current colour mode.
 *
 * - `tenant`    — the assigned tenant's colour; vacant suites go grey and
 *                 non-suite zones stay neutral so tenancy reads at a glance.
 * - `zoneKind`  — the fixed classification palette above.
 * - `material`  — a single neutral; overlays are nearly invisible in this mode
 *                 so the built materials are what you see (see
 *                 {@link zoneOpacityFor}).
 */
export function zoneColorFor(
  zone: Zone,
  tenants: Record<TenantId, Tenant>,
  colorMode: ColorMode,
): string {
  if (colorMode === 'zoneKind') return ZONE_KIND_COLORS[zone.kind] ?? TENANT_MODE_NEUTRAL;

  if (colorMode === 'tenant') {
    if (zone.kind !== 'tenant-suite') return TENANT_MODE_NEUTRAL;
    const tenant = zone.tenantId ? tenants[zone.tenantId] : undefined;
    return tenant?.color ?? VACANT_COLOR;
  }

  // 'material' — overlays recede entirely.
  return TENANT_MODE_NEUTRAL;
}

/** Overlay opacity for the current colour mode. */
export function zoneOpacityFor(colorMode: ColorMode): number {
  switch (colorMode) {
    case 'tenant':
      return 0.45;
    case 'zoneKind':
      return 0.42;
    default:
      return 0.08;
  }
}

// —— furniture ————————————————————————————————————————————————————
const FURNITURE_MATERIALS: Record<FurnitureCategory, THREE.MeshStandardMaterial> = {
  desk: new THREE.MeshStandardMaterial({
    name: 'compass/furniture/desk',
    color: '#a97e50',
    roughness: 0.7,
  }),
  workstation: new THREE.MeshStandardMaterial({
    name: 'compass/furniture/workstation',
    color: '#b8ab98',
    roughness: 0.85,
  }),
  seating: new THREE.MeshStandardMaterial({
    name: 'compass/furniture/seating',
    color: '#4a5a6a',
    roughness: 0.85,
  }),
  conference: new THREE.MeshStandardMaterial({
    name: 'compass/furniture/conference',
    color: '#7a5c3e',
    roughness: 0.65,
  }),
  reception: new THREE.MeshStandardMaterial({
    name: 'compass/furniture/reception',
    color: '#8a6d4f',
    roughness: 0.6,
  }),
  storage: new THREE.MeshStandardMaterial({
    name: 'compass/furniture/storage',
    color: '#6e7278',
    roughness: 0.7,
    metalness: 0.15,
  }),
  'break-room': new THREE.MeshStandardMaterial({
    name: 'compass/furniture/break-room',
    color: '#5d7a6a',
    roughness: 0.7,
  }),
  server: new THREE.MeshStandardMaterial({
    name: 'compass/furniture/server',
    color: '#3b4252',
    roughness: 0.5,
    metalness: 0.25,
  }),
  fixture: new THREE.MeshStandardMaterial({
    name: 'compass/furniture/fixture',
    color: '#4f6b52',
    roughness: 0.9,
  }),
};

/** The shared material for a furniture category. Never dispose the result. */
export function getFurnitureMaterial(category: FurnitureCategory): THREE.Material {
  return FURNITURE_MATERIALS[category] ?? FURNITURE_MATERIALS.fixture;
}

// —— selection & tooling ——————————————————————————————————————————
/**
 * Selection override for solid entities. Deliberately emissive so a selected
 * wall reads even when it faces away from the directional light.
 */
export const SELECTION_MATERIAL = new THREE.MeshStandardMaterial({
  name: 'compass/selection',
  color: ACCENT_COLOR,
  emissive: new THREE.Color('#7c4a02'),
  emissiveIntensity: 1,
  roughness: 0.4,
  metalness: 0.1,
  side: THREE.DoubleSide,
});

/** Selection override for flat overlays (zones), which must stay see-through. */
export const SELECTION_OVERLAY_MATERIAL = new THREE.MeshStandardMaterial({
  name: 'compass/selection/overlay',
  color: ACCENT_COLOR,
  emissive: new THREE.Color('#5a3502'),
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
  depthWrite: false,
  roughness: 1,
});

/**
 * Draggable endpoint handles. Unlit and depth-test-free so a handle is always
 * visible (and therefore findable) even when the wall body is in front of it.
 */
export const HANDLE_MATERIAL = new THREE.MeshBasicMaterial({
  name: 'compass/handle',
  color: ACCENT_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  // `transparent` (at full opacity) moves the handle into the transparent pass,
  // which three draws *after* the opaque one — otherwise the exterior curtain
  // wall, itself transparent, would paint over the handle regardless of
  // `renderOrder`.
  transparent: true,
});

/** Shared sphere for every endpoint handle in the building. */
export const HANDLE_GEOMETRY = new THREE.SphereGeometry(0.18, 16, 12);

/** Wall-draw preview / marker. */
export const PREVIEW_LINE_MATERIAL = new THREE.LineBasicMaterial({
  name: 'compass/preview/line',
  color: ACCENT_COLOR,
  depthTest: false,
  toneMapped: false,
  transparent: true,
  opacity: 0.95,
});

export const PREVIEW_POINT_MATERIAL = new THREE.MeshBasicMaterial({
  name: 'compass/preview/point',
  color: ACCENT_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
});

/** Shared marker sphere for hover/measure points. */
export const PREVIEW_POINT_GEOMETRY = new THREE.SphereGeometry(0.14, 12, 8);

/** Measurement line — a cooler colour so it never reads as a wall preview. */
export const MEASURE_LINE_MATERIAL = new THREE.LineBasicMaterial({
  name: 'compass/measure/line',
  color: '#38bdf8',
  depthTest: false,
  toneMapped: false,
  transparent: true,
});

export const MEASURE_POINT_MATERIAL = new THREE.MeshBasicMaterial({
  name: 'compass/measure/point',
  color: '#38bdf8',
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
});

/**
 * The invisible pointer-catcher plane used by the drawing tools. `opacity: 0`
 * (rather than `visible: false`) is deliberate: three only skips raycasting a
 * mesh when the *mesh* is invisible or has no material, so a fully transparent
 * material keeps the plane pickable while drawing nothing.
 */
export const PICK_PLANE_MATERIAL = new THREE.MeshBasicMaterial({
  name: 'compass/pickPlane',
  transparent: true,
  opacity: 0,
  depthWrite: false,
  depthTest: false,
  side: THREE.DoubleSide,
});

// —— grid ————————————————————————————————————————————————————————
export const GRID_CELL_MATERIAL = new THREE.LineBasicMaterial({
  name: 'compass/grid/cell',
  color: GRID_CELL_COLOR,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  toneMapped: false,
});

export const GRID_SECTION_MATERIAL = new THREE.LineBasicMaterial({
  name: 'compass/grid/section',
  color: GRID_SECTION_COLOR,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  toneMapped: false,
});
