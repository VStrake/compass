/**
 * Area & efficiency analytics.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * ## Area semantics (simplified BOMA-style model, v1)
 * The v1 model is intentionally a *zone-accounting* model rather than a full
 * BOMA 2017 measurement standard — it is exact with respect to the authored
 * polygons, which is what brokers and designers need while a plate is being
 * laid out, and it is the analytics contract the SaaS reporting tier persists
 * (see ARCHITECTURE §4 / §8 M6).
 *
 *   grossArea    Σ slab outlines − Σ slab holes (the constructed plate).
 *   coreArea     Σ zones of kind `core`. If a floor has no core zone authored,
 *                falls back to the union-free sum of `Core` record outlines so
 *                early-stage plates still report a core.
 *   commonArea   Σ zones of kind `common`, `circulation`, `service`.
 *   rentableArea Σ zones of kind `tenant-suite`, `amenity`.
 *   efficiency   rentableArea / grossArea (0 when grossArea is 0).
 *   byTenant     tenant-suite zone area grouped by `tenantId`; a `null` key is
 *                vacant/unassigned suite area.
 *
 * Overlapping zones are summed as authored (no boolean union) — the editor's
 * zone tools keep zones disjoint, and silently "fixing" overlaps would hide
 * authoring mistakes from the person measuring the plate.
 *
 * Pure TypeScript: no three.js, no React. Runs in Node for server-side reports.
 */

import { polygonArea } from '../geometry/polygon';
import type {
  BuildingAreaReport,
  Floor,
  FloorAreaReport,
  ProjectDoc,
  TenantId,
} from '../model/types';

/** Net slab area: outlines minus holes. */
export function computeGrossArea(floor: Floor): number {
  let area = 0;
  for (const slab of floor.slabs) {
    area += polygonArea(slab.outline);
    for (const hole of slab.holes) area -= polygonArea(hole);
  }
  return Math.max(area, 0);
}

function mergeByTenant(
  target: Map<TenantId | null, number>,
  entries: { tenantId: TenantId | null; area: number }[],
): void {
  for (const entry of entries) {
    target.set(entry.tenantId, (target.get(entry.tenantId) ?? 0) + entry.area);
  }
}

function byTenantToArray(map: Map<TenantId | null, number>) {
  // Insertion order is deterministic for a given document; nulls (vacant) last
  // so reports read "tenants first, then vacancy".
  const entries = [...map.entries()].map(([tenantId, area]) => ({ tenantId, area }));
  entries.sort((a, b) => {
    if (a.tenantId === null) return 1;
    if (b.tenantId === null) return -1;
    return b.area - a.area;
  });
  return entries;
}

/** Per-floor area report. */
export function computeFloorAreaReport(floor: Floor): FloorAreaReport {
  const grossArea = computeGrossArea(floor);

  let rentableArea = 0;
  let commonArea = 0;
  let coreZoneArea = 0;
  const tenantAreas = new Map<TenantId | null, number>();

  for (const zone of floor.zones) {
    const area = polygonArea(zone.outline);
    switch (zone.kind) {
      case 'tenant-suite':
        rentableArea += area;
        tenantAreas.set(zone.tenantId, (tenantAreas.get(zone.tenantId) ?? 0) + area);
        break;
      case 'amenity':
        rentableArea += area;
        break;
      case 'common':
      case 'circulation':
      case 'service':
        commonArea += area;
        break;
      case 'core':
        coreZoneArea += area;
        break;
    }
  }

  // Fallback: derive core area from the Core records when no core zone exists.
  let coreArea = coreZoneArea;
  if (coreArea === 0 && floor.cores.length > 0) {
    for (const core of floor.cores) coreArea += polygonArea(core.outline);
  }

  return {
    floorId: floor.id,
    grossArea,
    rentableArea,
    commonArea,
    coreArea,
    efficiency: grossArea > 0 ? rentableArea / grossArea : 0,
    byTenant: byTenantToArray(tenantAreas),
  };
}

/** Whole-building rollup: per-floor reports plus merged totals. */
export function computeBuildingAreaReport(project: ProjectDoc): BuildingAreaReport {
  const floors = project.building.floors.map(computeFloorAreaReport);

  let grossArea = 0;
  let rentableArea = 0;
  let commonArea = 0;
  let coreArea = 0;
  const tenantAreas = new Map<TenantId | null, number>();

  for (const report of floors) {
    grossArea += report.grossArea;
    rentableArea += report.rentableArea;
    commonArea += report.commonArea;
    coreArea += report.coreArea;
    mergeByTenant(tenantAreas, report.byTenant);
  }

  return {
    floors,
    totals: {
      grossArea,
      rentableArea,
      commonArea,
      coreArea,
      efficiency: grossArea > 0 ? rentableArea / grossArea : 0,
      byTenant: byTenantToArray(tenantAreas),
    },
  };
}
