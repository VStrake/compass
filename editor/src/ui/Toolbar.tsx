'use client';

/**
 * Top toolbar: identity, tools, view modes, units, history, export.
 * Proprietary and confidential. © Partners Real Estate.
 */

import type { WallKind } from '@/core/model/types';
import {
  getEditorState,
  useEditorStore,
  type ActiveTool,
  type ColorMode,
  type FloorViewMode,
} from '@/store/useEditorStore';
import { ImportPlanButton } from './import/ImportPlanButton';
import { RentRollButton } from './import/RentRollButton';
import { ProjectMenu } from './ProjectMenu';
import { downloadProject } from './projectFile';
import { Button, SegmentedControl, titleCase, type SegmentOption } from './primitives';

const TOOL_OPTIONS: { tool: ActiveTool; label: string; shortcut: string; hint: string }[] = [
  { tool: 'select', label: '⬈ Select', shortcut: 'V', hint: 'Pick and edit entities' },
  { tool: 'wall', label: '▤ Wall', shortcut: 'W', hint: 'Draw walls on the active floor' },
  { tool: 'measure', label: '⟺ Measure', shortcut: 'M', hint: 'Measure a distance in plan' },
];

const WALL_KINDS: WallKind[] = ['exterior', 'interior', 'partition', 'glass', 'demising'];

const VIEW_MODES: SegmentOption<FloorViewMode>[] = [
  { value: 'stack', label: 'Stack', title: 'Show floors at their true elevations' },
  { value: 'explode', label: 'Explode', title: 'Spread floors apart vertically' },
  { value: 'solo', label: 'Solo', title: 'Show the active floor only' },
];

const COLOR_MODES: SegmentOption<ColorMode>[] = [
  { value: 'material', label: 'Material', title: 'Color by construction material' },
  { value: 'tenant', label: 'Tenant', title: 'Color suites by tenant' },
  { value: 'zoneKind', label: 'Zone', title: 'Color by zone classification' },
  {
    value: 'expiry',
    label: 'Expiry',
    title: 'Color suites by lease-rollover bucket (< 12 months / 1–3 years / 3+ / vacant)',
  },
];

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-editor-border" />;
}

export function Toolbar() {
  const activeTool = useEditorStore((state) => state.activeTool);
  const drawingWallKind = useEditorStore((state) => state.drawingWallKind);
  const floorViewMode = useEditorStore((state) => state.floorViewMode);
  const explodeGap = useEditorStore((state) => state.explodeGap);
  const colorMode = useEditorStore((state) => state.colorMode);
  const units = useEditorStore((state) => state.project.settings.units);
  const allowJson = useEditorStore((state) => state.project.meta.export.allowJson);

  const undoDepth = useEditorStore((state) => state.undoDepth);
  const redoDepth = useEditorStore((state) => state.redoDepth);
  const undoLabel = useEditorStore((state) => state.undoLabel);
  const redoLabel = useEditorStore((state) => state.redoLabel);

  const setActiveTool = useEditorStore((state) => state.setActiveTool);
  const setDrawingWallKind = useEditorStore((state) => state.setDrawingWallKind);
  const setFloorViewMode = useEditorStore((state) => state.setFloorViewMode);
  const setExplodeGap = useEditorStore((state) => state.setExplodeGap);
  const setColorMode = useEditorStore((state) => state.setColorMode);
  const setUnits = useEditorStore((state) => state.setUnits);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-editor-border bg-editor-panel px-2">
      {/* —— identity —— */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="whitespace-nowrap text-xs font-semibold tracking-wide text-amber-400">
          COMPASS STUDIO
        </span>
        <ProjectMenu />
      </div>

      <Divider />

      {/* —— tools —— */}
      <div className="flex shrink-0 items-center gap-1">
        {TOOL_OPTIONS.map((option) => (
          <Button
            key={option.tool}
            active={activeTool === option.tool}
            onClick={() => setActiveTool(option.tool)}
            title={`${option.hint} (${option.shortcut})`}
            className="whitespace-nowrap"
          >
            {option.label}
          </Button>
        ))}
        {activeTool === 'wall' ? (
          <select
            value={drawingWallKind}
            onChange={(event) => setDrawingWallKind(event.currentTarget.value as WallKind)}
            title="Wall type to draw"
            className="h-7 shrink-0 cursor-pointer rounded-sm border border-editor-border bg-editor-bg px-1 text-xs text-editor-text outline-none focus:border-amber-500/70"
          >
            {WALL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {titleCase(kind)}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="min-w-2 flex-1" />

      {/* —— view modes —— */}
      <div className="flex shrink-0 items-center gap-1">
        <SegmentedControl value={floorViewMode} options={VIEW_MODES} onChange={setFloorViewMode} />
        {floorViewMode === 'explode' ? (
          <span className="flex shrink-0 items-center gap-1" title="Explode gap (m)">
            <input
              type="range"
              min={2}
              max={12}
              step={0.5}
              value={explodeGap}
              onChange={(event) => setExplodeGap(Number(event.currentTarget.value))}
              className="h-7 w-20 accent-amber-500"
            />
            <span className="w-8 font-mono text-[10px] tabular-nums text-gray-500">
              {explodeGap.toFixed(1)}
            </span>
          </span>
        ) : null}
      </div>

      <Divider />

      <SegmentedControl value={colorMode} options={COLOR_MODES} onChange={setColorMode} />

      <Divider />

      {/* —— units —— */}
      <SegmentedControl
        value={units}
        options={[
          { value: 'metric', label: 'm', title: 'Metric display units' },
          { value: 'imperial', label: 'ft', title: 'Imperial display units' },
        ]}
        onChange={setUnits}
      />

      <Divider />

      {/* —— history —— */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          onClick={undo}
          disabled={undoDepth === 0}
          title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
        >
          ↶
        </Button>
        <Button
          onClick={redo}
          disabled={redoDepth === 0}
          title={redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}
        >
          ↷
        </Button>
      </div>

      <Divider />

      <ImportPlanButton />
      <RentRollButton />

      <Button
        onClick={() => downloadProject(getEditorState().project)}
        disabled={!allowJson}
        title={
          allowJson
            ? 'Download the project document (.compass.json)'
            : 'JSON export is disabled by this project’s export policy'
        }
        className="whitespace-nowrap"
      >
        Export JSON
      </Button>
    </div>
  );
}

export default Toolbar;
