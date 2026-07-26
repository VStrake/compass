'use client';

/**
 * Bottom status bar: active tool hint on the left, document context on the right.
 * Proprietary and confidential. © Partners Real Estate.
 */

import { formatArea, areaUnitLabel } from '@/lib/units';
import { findFloor } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';
import { titleCase, shortId } from './primitives';

const TOOL_HINT: Record<string, string> = {
  wall: 'click to place points · Enter to finish · Esc to cancel',
  measure: 'click two points to measure · Esc to cancel',
};

export function StatusBar() {
  const activeTool = useEditorStore((state) => state.activeTool);
  const selection = useEditorStore((state) => state.selection);
  const drawingWallKind = useEditorStore((state) => state.drawingWallKind);
  const floorCount = useEditorStore((state) => state.project.building.floors.length);
  const activeFloorName = useEditorStore(
    (state) => findFloor(state.project, state.activeFloorId)?.name ?? '—',
  );
  const hiddenCount = useEditorStore((state) => state.hiddenFloorIds.length);
  const units = useEditorStore((state) => state.project.settings.units);
  const grossArea = useEditorStore((state) => state.areaReport().totals.grossArea);

  const toolLabel =
    activeTool === 'wall' ? `Wall (${titleCase(drawingWallKind)})` : titleCase(activeTool);

  const hint =
    activeTool === 'select'
      ? selection
        ? `${titleCase(selection.kind)} ${shortId(selection.id)} selected · Del to delete`
        : 'click an entity in the viewport or tree'
      : TOOL_HINT[activeTool] ?? '';

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-t border-editor-border bg-editor-panel px-2 text-xs text-gray-500">
      <span className="shrink-0 text-gray-300">{toolLabel}</span>
      <span className="min-w-0 flex-1 truncate">{hint}</span>
      <span className="shrink-0 text-gray-400">{activeFloorName}</span>
      <span className="shrink-0">·</span>
      <span className="shrink-0">
        {floorCount} floor{floorCount === 1 ? '' : 's'}
        {hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
      </span>
      <span className="shrink-0">·</span>
      <span className="shrink-0 font-mono tabular-nums">{formatArea(grossArea, units)} gross</span>
      <span className="shrink-0">·</span>
      <span className="shrink-0 uppercase tracking-wider">
        {units === 'imperial' ? 'Imperial' : 'Metric'} / {areaUnitLabel(units)}
      </span>
    </div>
  );
}

export default StatusBar;
