'use client';

/**
 * Building → Floors → entities tree.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Floors are listed top-down (the way a stacking plan reads). Expansion state
 * is local component state — it is view chrome, never document data.
 */

import { useMemo, useState, type ReactNode } from 'react';

import { getCatalogItem } from '@/core/model/catalog';
import type {
  Core,
  EntityKind,
  Floor,
  FloorId,
  FurnitureInstance,
  Tenant,
  TenantId,
  Wall,
  Zone,
} from '@/core/model/types';
import { formatArea, formatLength, type Units } from '@/lib/units';
import { isSelected } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';
import {
  Chevron,
  ColorDot,
  EyeIcon,
  InlineEditableText,
  MiniButton,
  SectionHeader,
  titleCase,
} from '../primitives';

const VACANT_COLOR = '#4b5563';

function wallLength(wall: Wall): number {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

/** One leaf row in the tree. */
function EntityRow({
  kind,
  id,
  floorId,
  label,
  dot,
  meta,
}: {
  kind: EntityKind;
  id: string;
  floorId: FloorId;
  label: string;
  dot?: string;
  meta?: string;
}) {
  const selection = useEditorStore((state) => state.selection);
  const selectEntity = useEditorStore((state) => state.selectEntity);
  const selected = isSelected(selection, kind, id);

  return (
    <button
      type="button"
      onClick={() => selectEntity(kind, id, floorId)}
      title={label}
      className={`flex w-full items-center gap-1.5 py-0.5 pl-10 pr-2 text-left text-xs ${
        selected
          ? 'bg-amber-500/15 text-amber-200'
          : 'text-gray-400 hover:bg-editor-raised hover:text-gray-200'
      }`}
    >
      {dot ? <ColorDot color={dot} /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-600">{meta}</span>
      ) : null}
    </button>
  );
}

/** An expandable "Walls (12)" group inside a floor. */
function Group({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        disabled={count === 0}
        className="flex w-full items-center gap-1.5 py-0.5 pl-6 pr-2 text-left text-[11px] text-gray-500 hover:bg-editor-raised hover:text-gray-300 disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <Chevron open={open && count > 0} />
        <span className="flex-1 truncate uppercase tracking-wider">{label}</span>
        <span className="font-mono text-[10px] tabular-nums">{count}</span>
      </button>
      {open && count > 0 ? children : null}
    </div>
  );
}

function FloorNode({
  floor,
  grossArea,
  units,
  tenants,
}: {
  floor: Floor;
  grossArea: number;
  units: Units;
  tenants: Record<TenantId, Tenant>;
}) {
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const hidden = useEditorStore((state) => state.hiddenFloorIds.includes(floor.id));
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor);
  const selectEntity = useEditorStore((state) => state.selectEntity);
  const toggleFloorHidden = useEditorStore((state) => state.toggleFloorHidden);
  const selection = useEditorStore((state) => state.selection);

  const [expanded, setExpanded] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) =>
    setOpenGroups((current) => ({ ...current, [key]: !current[key] }));

  const isActive = activeFloorId === floor.id;
  const isFloorSelected = isSelected(selection, 'floor', floor.id);

  return (
    <div className={hidden ? 'opacity-45' : undefined}>
      <div
        className={`flex items-center gap-1 border-l-2 pr-1 ${
          isActive ? 'border-amber-500 bg-amber-500/10' : 'border-transparent'
        } ${isFloorSelected && !isActive ? 'bg-amber-500/10' : ''}`}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((open) => !open);
          }}
          title={expanded ? 'Collapse' : 'Expand'}
          className="flex h-6 w-5 items-center justify-center text-gray-500 hover:text-gray-200"
        >
          <Chevron open={expanded} />
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveFloor(floor.id);
            selectEntity('floor', floor.id, floor.id);
          }}
          title={`${floor.name} — make active`}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
        >
          <span
            className={`min-w-0 flex-1 truncate text-xs ${
              isActive ? 'text-amber-200' : 'text-gray-300'
            }`}
          >
            {floor.name}
          </span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-500">
            {formatArea(grossArea, units)}
          </span>
        </button>

        <button
          type="button"
          onClick={() => toggleFloorHidden(floor.id)}
          title={hidden ? 'Show floor' : 'Hide floor'}
          className={`flex h-6 w-6 items-center justify-center ${
            hidden ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-amber-300'
          }`}
        >
          <EyeIcon off={hidden} />
        </button>
      </div>

      {expanded ? (
        <div className="pb-1">
          <Group
            label="Walls"
            count={floor.walls.length}
            open={!!openGroups['walls']}
            onToggle={() => toggleGroup('walls')}
          >
            {floor.walls.map((wall) => (
              <EntityRow
                key={wall.id}
                kind="wall"
                id={wall.id}
                floorId={floor.id}
                label={`${titleCase(wall.kind)} ${formatLength(wallLength(wall), units)}`}
                meta={wall.openings.length > 0 ? `${wall.openings.length}○` : undefined}
              />
            ))}
          </Group>

          <Group
            label="Zones"
            count={floor.zones.length}
            open={!!openGroups['zones']}
            onToggle={() => toggleGroup('zones')}
          >
            {floor.zones.map((zone: Zone) => {
              const tenant = zone.tenantId ? tenants[zone.tenantId] : undefined;
              return (
                <EntityRow
                  key={zone.id}
                  kind="zone"
                  id={zone.id}
                  floorId={floor.id}
                  label={zone.name}
                  dot={tenant?.color ?? VACANT_COLOR}
                  meta={titleCase(zone.kind)}
                />
              );
            })}
          </Group>

          <Group
            label="Furniture"
            count={floor.furniture.length}
            open={!!openGroups['furniture']}
            onToggle={() => toggleGroup('furniture')}
          >
            {floor.furniture.map((item: FurnitureInstance) => (
              <EntityRow
                key={item.id}
                kind="furniture"
                id={item.id}
                floorId={floor.id}
                label={getCatalogItem(item.catalogId)?.name ?? item.catalogId}
              />
            ))}
          </Group>

          <Group
            label="Cores"
            count={floor.cores.length}
            open={!!openGroups['cores']}
            onToggle={() => toggleGroup('cores')}
          >
            {floor.cores.map((core: Core) => (
              <EntityRow
                key={core.id}
                kind="core"
                id={core.id}
                floorId={floor.id}
                label={core.label ?? titleCase(core.kind)}
                meta={core.label ? titleCase(core.kind) : undefined}
              />
            ))}
          </Group>
        </div>
      ) : null}
    </div>
  );
}

export function HierarchyPanel() {
  const buildingName = useEditorStore((state) => state.project.building.name);
  const buildingClass = useEditorStore((state) => state.project.building.buildingClass);
  const floors = useEditorStore((state) => state.project.building.floors);
  const tenants = useEditorStore((state) => state.project.tenants);
  const units = useEditorStore((state) => state.project.settings.units);
  const report = useEditorStore((state) => state.areaReport());
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const hiddenCount = useEditorStore((state) => state.hiddenFloorIds.length);

  const renameBuilding = useEditorStore((state) => state.renameBuilding);
  const addFloor = useEditorStore((state) => state.addFloor);
  const duplicateFloor = useEditorStore((state) => state.duplicateFloor);
  const deleteFloor = useEditorStore((state) => state.deleteFloor);
  const showAllFloors = useEditorStore((state) => state.showAllFloors);

  const topDown = useMemo(() => [...floors].sort((a, b) => b.index - a.index), [floors]);
  const grossByFloor = useMemo(() => {
    const map = new Map<string, number>();
    for (const floorReport of report.floors) map.set(floorReport.floorId, floorReport.grossArea);
    return map;
  }, [report]);

  const activeFloorName =
    floors.find((floor) => floor.id === activeFloorId)?.name ?? 'the active floor';

  return (
    <div className="flex min-h-0 flex-col">
      <SectionHeader
        right={
          hiddenCount > 0 ? (
            <MiniButton onClick={showAllFloors} title="Show every hidden floor">
              Show all
            </MiniButton>
          ) : null
        }
      >
        Building
      </SectionHeader>

      <div className="flex items-center gap-2 px-2 pb-2">
        <InlineEditableText
          value={buildingName}
          onCommit={renameBuilding}
          title="Building name — click to rename"
          className="min-w-0 flex-1 text-sm font-medium text-gray-200"
        />
        <span className="shrink-0 rounded-sm border border-editor-border px-1 text-[10px] uppercase tracking-wider text-gray-500">
          Class {buildingClass}
        </span>
      </div>

      <div className="flex items-center gap-1 border-y border-editor-border bg-editor-panel px-2 py-1">
        <MiniButton
          onClick={() => addFloor(activeFloorId)}
          title={`Insert a new floor above ${activeFloorName}`}
        >
          + Add
        </MiniButton>
        <MiniButton
          onClick={() => duplicateFloor(activeFloorId)}
          title={`Duplicate ${activeFloorName}`}
        >
          Duplicate
        </MiniButton>
        <MiniButton
          danger
          disabled={floors.length <= 1}
          onClick={() => {
            if (window.confirm(`Delete ${activeFloorName} and everything on it?`)) {
              deleteFloor(activeFloorId);
            }
          }}
          title={
            floors.length <= 1 ? 'A building must keep one floor' : `Delete ${activeFloorName}`
          }
        >
          Delete
        </MiniButton>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-gray-600">
          {floors.length} FL
        </span>
      </div>

      <div className="flex-1">
        {topDown.map((floor) => (
          <FloorNode
            key={floor.id}
            floor={floor}
            grossArea={grossByFloor.get(floor.id) ?? 0}
            units={units}
            tenants={tenants}
          />
        ))}
      </div>
    </div>
  );
}

export default HierarchyPanel;
