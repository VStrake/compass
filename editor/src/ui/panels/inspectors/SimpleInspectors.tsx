'use client';

/**
 * Read-only inspectors for entity kinds without an editing tool yet
 * (column / core / slab / opening / building). Editing arrives with the M1
 * core-planner and column-grid tools; the store has no update commands for
 * these records today, so the panel reports measured facts only.
 * Proprietary and confidential. © Partners Real Estate.
 */

import { polygonArea, polygonBounds, polygonPerimeter } from '@/core/geometry/polygon';
import type {
  ColumnId,
  CoreId,
  FloorId,
  OpeningId,
  SlabId,
} from '@/core/model/types';
import { formatPercent } from '@/lib/format';
import { formatArea, formatLength } from '@/lib/units';
import {
  findColumnById,
  findCoreById,
  findFloor,
  findOpeningById,
  findSlabById,
} from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';
import { InfoRow, titleCase } from '../../primitives';
import { InspectorSection, MissingEntity, useOwnerFloorId } from './shared';

export function ColumnInspector({ id, floorHint }: { id: ColumnId; floorHint: FloorId | null }) {
  const column = useEditorStore((state) => findColumnById(state.project, id));
  const floorId = useOwnerFloorId('column', id, floorHint);
  const floorName = useEditorStore((state) => findFloor(state.project, floorId)?.name ?? '—');
  const units = useEditorStore((state) => state.project.settings.units);

  if (!column) return <MissingEntity what="column" />;

  return (
    <InspectorSection title="Column">
      <InfoRow label="Floor" value={floorName} mono={false} />
      <InfoRow label="Shape" value={titleCase(column.shape)} mono={false} />
      <InfoRow
        label="Size"
        value={`${formatLength(column.width, units)} × ${formatLength(column.depth, units)}`}
      />
      <InfoRow
        label="Position"
        value={`${formatLength(column.position.x, units)}, ${formatLength(column.position.y, units)}`}
      />
    </InspectorSection>
  );
}

export function CoreInspector({ id, floorHint }: { id: CoreId; floorHint: FloorId | null }) {
  const core = useEditorStore((state) => findCoreById(state.project, id));
  const floorId = useOwnerFloorId('core', id, floorHint);
  const floorName = useEditorStore((state) => findFloor(state.project, floorId)?.name ?? '—');
  const units = useEditorStore((state) => state.project.settings.units);

  if (!core) return <MissingEntity what="core" />;

  const bounds = polygonBounds(core.outline);

  return (
    <InspectorSection title="Core">
      <InfoRow label="Floor" value={floorName} mono={false} />
      <InfoRow label="Kind" value={titleCase(core.kind)} mono={false} />
      {core.label ? <InfoRow label="Label" value={core.label} mono={false} /> : null}
      <InfoRow label="Area" value={formatArea(polygonArea(core.outline), units)} />
      <InfoRow label="Perimeter" value={formatLength(polygonPerimeter(core.outline), units)} />
      <InfoRow
        label="Extents"
        value={`${formatLength(bounds.max.x - bounds.min.x, units)} × ${formatLength(
          bounds.max.y - bounds.min.y,
          units,
        )}`}
      />
    </InspectorSection>
  );
}

export function SlabInspector({ id, floorHint }: { id: SlabId; floorHint: FloorId | null }) {
  const slab = useEditorStore((state) => findSlabById(state.project, id));
  const floorId = useOwnerFloorId('slab', id, floorHint);
  const floorName = useEditorStore((state) => findFloor(state.project, floorId)?.name ?? '—');
  const units = useEditorStore((state) => state.project.settings.units);

  if (!slab) return <MissingEntity what="slab" />;

  const outlineArea = polygonArea(slab.outline);
  const holeArea = slab.holes.reduce((sum, hole) => sum + polygonArea(hole), 0);

  return (
    <InspectorSection title="Slab">
      <InfoRow label="Floor" value={floorName} mono={false} />
      <InfoRow label="Thickness" value={formatLength(slab.thickness, units)} />
      <InfoRow label="Outline" value={formatArea(outlineArea, units)} />
      <InfoRow label="Holes" value={`${slab.holes.length} · ${formatArea(holeArea, units)}`} />
      <InfoRow label="Net area" value={formatArea(Math.max(outlineArea - holeArea, 0), units)} />
    </InspectorSection>
  );
}

export function OpeningInspector({ id }: { id: OpeningId }) {
  const opening = useEditorStore((state) => findOpeningById(state.project, id));
  const units = useEditorStore((state) => state.project.settings.units);

  if (!opening) return <MissingEntity what="opening" />;

  return (
    <InspectorSection title="Opening">
      <InfoRow label="Kind" value={titleCase(opening.kind)} mono={false} />
      <InfoRow label="Offset" value={formatLength(opening.offset, units)} />
      <InfoRow label="Width" value={formatLength(opening.width, units)} />
      <InfoRow label="Height" value={formatLength(opening.height, units)} />
      <InfoRow label="Sill" value={formatLength(opening.sillHeight, units)} />
      <div className="mt-1 text-[11px] text-gray-600">
        Select the parent wall to edit this opening numerically.
      </div>
    </InspectorSection>
  );
}

export function BuildingInspector() {
  const building = useEditorStore((state) => state.project.building);
  const units = useEditorStore((state) => state.project.settings.units);
  const report = useEditorStore((state) => state.areaReport());

  const height = building.floors.reduce((sum, floor) => sum + floor.height, 0);

  return (
    <>
      <InspectorSection title="Building">
        <InfoRow label="Name" value={building.name} mono={false} />
        <InfoRow label="Class" value={building.buildingClass} />
        {building.address ? <InfoRow label="Address" value={building.address} mono={false} /> : null}
        <InfoRow label="Floors" value={String(building.floors.length)} />
        <InfoRow label="Structural height" value={formatLength(height, units)} />
      </InspectorSection>

      <InspectorSection title="Rollup">
        <InfoRow label="Gross" value={formatArea(report.totals.grossArea, units)} />
        <InfoRow label="Rentable" value={formatArea(report.totals.rentableArea, units)} />
        <InfoRow label="Efficiency" value={formatPercent(report.totals.efficiency)} />
      </InspectorSection>
    </>
  );
}
