'use client';

/**
 * Floor inspector: name, floor-to-floor height, and the floor's area snapshot.
 * Proprietary and confidential. © Partners Real Estate.
 */

import type { FloorId } from '@/core/model/types';
import { formatPercent } from '@/lib/format';
import { formatArea, formatLength } from '@/lib/units';
import { findFloor } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';
import { NumberField } from '../../NumberField';
import { InfoRow, TextField } from '../../primitives';
import { FieldGrid, InspectorSection, MissingEntity } from './shared';

export function FloorInspector({ id }: { id: FloorId }) {
  const floor = useEditorStore((state) => findFloor(state.project, id));
  const units = useEditorStore((state) => state.project.settings.units);
  const report = useEditorStore((state) => state.areaReport());
  const updateFloor = useEditorStore((state) => state.updateFloor);
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor);

  if (!floor) return <MissingEntity what="floor" />;

  const floorReport = report.floors.find((entry) => entry.floorId === id);

  return (
    <>
      <InspectorSection title="Floor">
        <FieldGrid cols={1}>
          <TextField
            label="Name"
            value={floor.name}
            onCommit={(next) => updateFloor(id, { name: next })}
          />
        </FieldGrid>
        <div className="mt-1.5">
          <FieldGrid>
            <NumberField
              label="Floor-to-floor"
              unit="length"
              value={floor.height}
              min={2}
              step={0.1}
              onCommit={(next) => updateFloor(id, { height: next })}
            />
            <div className="flex flex-col justify-end gap-0.5">
              <InfoRow label="Elevation" value={formatLength(floor.elevation, units)} />
              <InfoRow label="Index" value={String(floor.index)} />
            </div>
          </FieldGrid>
        </div>
        {activeFloorId !== id ? (
          <button
            type="button"
            onClick={() => setActiveFloor(id)}
            className="mt-2 text-[11px] text-amber-400 hover:text-amber-300"
          >
            Make this the active floor →
          </button>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Floor area">
        <InfoRow label="Gross" value={formatArea(floorReport?.grossArea ?? 0, units)} />
        <InfoRow label="Rentable" value={formatArea(floorReport?.rentableArea ?? 0, units)} />
        <InfoRow label="Common" value={formatArea(floorReport?.commonArea ?? 0, units)} />
        <InfoRow label="Core" value={formatArea(floorReport?.coreArea ?? 0, units)} />
        <InfoRow label="Efficiency" value={formatPercent(floorReport?.efficiency ?? 0)} />
      </InspectorSection>

      <InspectorSection title="Contents">
        <FieldGrid cols={3}>
          <InfoRow label="Walls" value={String(floor.walls.length)} />
          <InfoRow label="Zones" value={String(floor.zones.length)} />
          <InfoRow label="Furn." value={String(floor.furniture.length)} />
          <InfoRow label="Cores" value={String(floor.cores.length)} />
          <InfoRow label="Cols" value={String(floor.columns.length)} />
          <InfoRow label="Slabs" value={String(floor.slabs.length)} />
        </FieldGrid>
      </InspectorSection>
    </>
  );
}

export default FloorInspector;
