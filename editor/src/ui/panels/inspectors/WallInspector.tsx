'use client';

/**
 * Wall inspector: geometry, thickness/height, and the openings list.
 * Proprietary and confidential. © Partners Real Estate.
 */

import { useState } from 'react';

import type {
  FloorId,
  Opening,
  OpeningId,
  OpeningKind,
  Wall,
  WallId,
  WallKind,
} from '@/core/model/types';
import { formatLength } from '@/lib/units';
import { findFloor, findWallById } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';
import { NumberField } from '../../NumberField';
import {
  CheckboxField,
  InfoRow,
  MiniButton,
  SelectField,
  titleCase,
} from '../../primitives';
import { FieldGrid, InspectorSection, MissingEntity, useOwnerFloorId } from './shared';

const WALL_KINDS: WallKind[] = ['exterior', 'interior', 'partition', 'glass', 'demising'];
const OPENING_KINDS: OpeningKind[] = [
  'door',
  'double-door',
  'glass-door',
  'window',
  'ribbon-window',
  'pass-through',
];

function lengthOf(wall: Wall): number {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

function OpeningEditor({
  floorId,
  wallId,
  opening,
  wallLength,
}: {
  floorId: FloorId;
  wallId: WallId;
  opening: Opening;
  wallLength: number;
}) {
  const updateOpening = useEditorStore((state) => state.updateOpening);

  return (
    <div className="mt-1 rounded-sm border border-editor-border bg-editor-bg/60 p-1.5">
      <FieldGrid>
        <SelectField<OpeningKind>
          label="Type"
          value={opening.kind}
          options={OPENING_KINDS.map((kind) => ({ value: kind, label: titleCase(kind) }))}
          onChange={(next) => {
            if (next) updateOpening(floorId, wallId, opening.id, { kind: next as OpeningKind });
          }}
        />
        <NumberField
          label="Offset"
          unit="length"
          value={opening.offset}
          min={0}
          max={wallLength}
          step={0.1}
          onCommit={(next) => updateOpening(floorId, wallId, opening.id, { offset: next })}
        />
        <NumberField
          label="Width"
          unit="length"
          value={opening.width}
          min={0.1}
          step={0.05}
          onCommit={(next) => updateOpening(floorId, wallId, opening.id, { width: next })}
        />
        <NumberField
          label="Height"
          unit="length"
          value={opening.height}
          min={0.1}
          step={0.05}
          onCommit={(next) => updateOpening(floorId, wallId, opening.id, { height: next })}
        />
        <NumberField
          label="Sill"
          unit="length"
          value={opening.sillHeight}
          min={0}
          step={0.05}
          onCommit={(next) => updateOpening(floorId, wallId, opening.id, { sillHeight: next })}
        />
      </FieldGrid>
    </div>
  );
}

function OpeningsSection({
  floorId,
  wall,
  wallLength,
}: {
  floorId: FloorId;
  wall: Wall;
  wallLength: number;
}) {
  const addOpening = useEditorStore((state) => state.addOpening);
  const deleteOpening = useEditorStore((state) => state.deleteOpening);
  const units = useEditorStore((state) => state.project.settings.units);
  const [editingId, setEditingId] = useState<OpeningId | null>(null);

  const midpoint = wallLength / 2;

  return (
    <InspectorSection
      title={`Openings (${wall.openings.length})`}
      right={
        <>
          <MiniButton
            title="Add a door at the wall midpoint"
            onClick={() =>
              addOpening(floorId, wall.id, 'door', midpoint, {
                width: 0.9,
                height: 2.1,
                sillHeight: 0,
              })
            }
          >
            + Door
          </MiniButton>
          <MiniButton
            title="Add a window at the wall midpoint"
            onClick={() =>
              addOpening(floorId, wall.id, 'window', midpoint, {
                width: 1.8,
                height: 1.5,
                sillHeight: 0.9,
              })
            }
          >
            + Window
          </MiniButton>
        </>
      }
    >
      {wall.openings.length === 0 ? (
        <div className="text-xs text-gray-600">No openings on this wall.</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {wall.openings.map((opening) => {
            const open = editingId === opening.id;
            return (
              <div key={opening.id}>
                <div
                  className={`flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs ${
                    open ? 'bg-amber-500/15 text-amber-200' : 'text-gray-400 hover:bg-editor-raised'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setEditingId(open ? null : opening.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title="Edit this opening"
                  >
                    <span className="min-w-0 flex-1 truncate">{titleCase(opening.kind)}</span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-500">
                      w {formatLength(opening.width, units)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-500">
                      @ {formatLength(opening.offset, units)}
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Delete opening"
                    onClick={() => {
                      if (editingId === opening.id) setEditingId(null);
                      deleteOpening(floorId, wall.id, opening.id);
                    }}
                    className="shrink-0 px-1 text-[11px] text-gray-500 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
                {open ? (
                  <OpeningEditor
                    floorId={floorId}
                    wallId={wall.id}
                    opening={opening}
                    wallLength={wallLength}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </InspectorSection>
  );
}

export function WallInspector({ id, floorHint }: { id: WallId; floorHint: FloorId | null }) {
  const wall = useEditorStore((state) => findWallById(state.project, id));
  const floorId = useOwnerFloorId('wall', id, floorHint);
  const floorHeight = useEditorStore((state) => findFloor(state.project, floorId)?.height ?? 0);
  const units = useEditorStore((state) => state.project.settings.units);
  const updateWall = useEditorStore((state) => state.updateWall);

  if (!wall || !floorId) return <MissingEntity what="wall" />;

  const length = lengthOf(wall);
  const customHeight = wall.height !== null;

  return (
    <>
      <InspectorSection title="Wall">
        <FieldGrid>
          <SelectField<WallKind>
            label="Type"
            value={wall.kind}
            options={WALL_KINDS.map((kind) => ({ value: kind, label: titleCase(kind) }))}
            onChange={(next) => {
              if (next) updateWall(floorId, wall.id, { kind: next as WallKind });
            }}
          />
          <NumberField
            label="Thickness"
            unit="length"
            value={wall.thickness}
            min={0.01}
            step={0.05}
            onCommit={(next) => updateWall(floorId, wall.id, { thickness: next })}
          />
        </FieldGrid>

        <CheckboxField
          label="Custom height"
          checked={customHeight}
          onChange={(checked) =>
            updateWall(floorId, wall.id, { height: checked ? floorHeight : null })
          }
        />
        <NumberField
          label={customHeight ? 'Height' : 'Height — auto (floor)'}
          unit="length"
          value={customHeight ? wall.height ?? floorHeight : floorHeight}
          min={0.1}
          step={0.1}
          disabled={!customHeight}
          onCommit={(next) => updateWall(floorId, wall.id, { height: next })}
        />
      </InspectorSection>

      <InspectorSection title="Geometry">
        <FieldGrid>
          <NumberField
            label="Start X"
            unit="length"
            value={wall.start.x}
            onCommit={(next) => updateWall(floorId, wall.id, { start: { x: next, y: wall.start.y } })}
          />
          <NumberField
            label="Start Y"
            unit="length"
            value={wall.start.y}
            onCommit={(next) => updateWall(floorId, wall.id, { start: { x: wall.start.x, y: next } })}
          />
          <NumberField
            label="End X"
            unit="length"
            value={wall.end.x}
            onCommit={(next) => updateWall(floorId, wall.id, { end: { x: next, y: wall.end.y } })}
          />
          <NumberField
            label="End Y"
            unit="length"
            value={wall.end.y}
            onCommit={(next) => updateWall(floorId, wall.id, { end: { x: wall.end.x, y: next } })}
          />
        </FieldGrid>
        <div className="mt-1.5">
          <InfoRow label="Length" value={formatLength(length, units)} />
        </div>
      </InspectorSection>

      <OpeningsSection floorId={floorId} wall={wall} wallLength={length} />
    </>
  );
}

export default WallInspector;
