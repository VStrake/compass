'use client';

/**
 * Floor inspector: name, floor-to-floor height, the area snapshot, and the
 * imported plan underlay (M1.5).
 * Proprietary and confidential. © Partners Real Estate.
 */

import { useState } from 'react';

import type { FloorId, FloorUnderlay } from '@/core/model/types';
import { formatNumber, formatPercent } from '@/lib/format';
import { formatArea, formatLength, type Units } from '@/lib/units';
import { findFloor } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';
import { NumberField } from '../../NumberField';
import { Button, CheckboxField, InfoRow, TextField } from '../../primitives';
import { FieldGrid, InspectorSection, MissingEntity } from './shared';

/**
 * Underlay controls for an imported floor.
 *
 * The opacity slider writes to the document **once per drag**: a range input
 * fires `onChange` on every pixel of travel, and one history entry per pixel
 * would bury whatever the user did before it. The live value lives in local
 * state while the pointer is down and is committed on release / change-end,
 * which keeps the scene responsive and history honest (ARCHITECTURE §5).
 */
function UnderlaySection({
  floorId,
  underlay,
  units,
}: {
  floorId: FloorId;
  underlay: FloorUnderlay;
  units: Units;
}) {
  const updateProject = useEditorStore((state) => state.updateProject);
  const [dragOpacity, setDragOpacity] = useState<number | null>(null);
  const shownOpacity = dragOpacity ?? underlay.opacity;

  /** Mutate this floor's underlay inside one labelled command. */
  function editUnderlay(label: string, patch: (target: FloorUnderlay) => void): void {
    updateProject(label, (draft) => {
      const floor = draft.building.floors.find((candidate) => candidate.id === floorId);
      if (!floor?.underlay) return;
      patch(floor.underlay);
    });
  }

  function commitOpacity(): void {
    const next = dragOpacity;
    setDragOpacity(null);
    if (next === null || Math.abs(next - underlay.opacity) < 1e-6) return;
    editUnderlay('Underlay opacity', (target) => {
      target.opacity = next;
    });
  }

  const widthMeters = underlay.imageWidth * underlay.metersPerPixel;
  const heightMeters = underlay.imageHeight * underlay.metersPerPixel;

  return (
    <InspectorSection title="Underlay">
      <CheckboxField
        label="Visible"
        checked={underlay.visible}
        onChange={(next) =>
          editUnderlay('Toggle underlay', (target) => {
            target.visible = next;
          })
        }
      />

      <label className="mt-0.5 flex flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">Opacity</span>
          <span className="font-mono text-[10px] tabular-nums text-gray-500">
            {Math.round(shownOpacity * 100)}%
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={shownOpacity}
          disabled={!underlay.visible}
          onChange={(event) => setDragOpacity(Number(event.currentTarget.value))}
          onPointerUp={commitOpacity}
          onKeyUp={commitOpacity}
          onBlur={commitOpacity}
          className="h-5 w-full accent-amber-500 disabled:opacity-40"
        />
      </label>

      <div className="mt-1">
        <InfoRow
          label="Extent"
          value={`${formatLength(widthMeters, units)} × ${formatLength(heightMeters, units)}`}
        />
        <InfoRow label="Scale" value={`${formatNumber(underlay.metersPerPixel, 5)} m/px`} />
        <InfoRow label="Source" value={`${underlay.imageWidth} × ${underlay.imageHeight} px`} />
      </div>

      <div className="mt-1.5">
        <Button
          danger
          onClick={() =>
            updateProject('Remove underlay', (draft) => {
              const floor = draft.building.floors.find((candidate) => candidate.id === floorId);
              if (!floor?.underlay) return;
              floor.underlay = null;
            })
          }
          title="Discard the imported plan image and its calibration"
        >
          Remove underlay
        </Button>
      </div>
    </InspectorSection>
  );
}

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

      {floor.underlay ? (
        <UnderlaySection floorId={id} underlay={floor.underlay} units={units} />
      ) : null}

      <InspectorSection title="Floor area">
        <InfoRow label="Gross" value={formatArea(floorReport?.grossArea ?? 0, units)} />
        <InfoRow label="Rentable" value={formatArea(floorReport?.rentableArea ?? 0, units)} />
        <InfoRow label="Common" value={formatArea(floorReport?.commonArea ?? 0, units)} />
        <InfoRow label="Core" value={formatArea(floorReport?.coreArea ?? 0, units)} />
        <InfoRow
          label="Efficiency"
          value={
            floorReport?.efficiencyMeasured ? formatPercent(floorReport.efficiency) : '—'
          }
        />
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
