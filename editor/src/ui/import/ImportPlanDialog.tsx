'use client';

/**
 * Plan import dialog — the client half of M1.5 (ARCHITECTURE §8).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * Four steps, one modal, one undo entry:
 *
 *  1. **Source** — drop or pick a PDF/PNG/JPEG/WebP; PDFs are rasterized page-1
 *     only, client-side (`pdfToImage.ts`). Choose the target floor and its name.
 *  2. **Scale** — two-point calibration on the raster. This is the *primary*
 *     path: a scale the user measured beats a scale the model guessed.
 *  3. **Extract** — `POST /api/extract-plan`. The model's own scale estimate is
 *     offered here as a fallback (and back on step 2 once it exists), and a 503
 *     drops through to an underlay-only import.
 *  4. **Apply** — one `updateProject('Import floor plan', …)` that creates the
 *     floor (when asked), runs `applyExtractionToFloor`, and pins the raster as
 *     the floor's `underlay`. Everything lands in a single history entry.
 *
 * ## Never import without a scale
 * Step 4 is unreachable while `metersPerPixel` is null, whichever route the user
 * took: manual calibration, the AI estimate, or underlay-only after a 503. There
 * is no "import unscaled" escape hatch, because an unscaled plate silently
 * poisons every area figure the analytics tier reports.
 *
 * ## Isolation
 * The scrim covers the viewport and swallows pointer events, and keydowns are
 * stopped at the panel so `EditorShell`'s global tool shortcuts (V/W/M/Delete)
 * cannot fire while a field has focus-adjacent intent. Escape closes, with an
 * inline (not `window.confirm`) discard confirmation once work is in progress.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import {
  applyExtractionToFloor,
  frameUnitsScaleFromMetersPerPixel,
  metersPerPixelFromFrameUnits,
  underlayOffsetForPlan,
  type ExtractedPlan,
  type ExtractionApplyCounts,
} from '@/core/import/extraction';
import { DEFAULTS, createFloor, floorName, recomputeElevations } from '@/core/model/factories';
import type { Floor } from '@/core/model/types';
import { formatNumber } from '@/lib/format';
import { formatArea, formatLength } from '@/lib/units';
import { getEditorState, useEditorStore } from '@/store/useEditorStore';

import { NumberField } from '../NumberField';
import { Button, FieldLabel, TextField, titleCase } from '../primitives';
import {
  ExtractPlanError,
  extractionErrorTitle,
  isExtractionUnavailable,
  isRetryable,
  requestPlanExtraction,
} from './extractPlanClient';
import {
  DEFAULT_MAX_DIM,
  PLAN_FILE_ACCEPT,
  isPdfFile,
  isSupportedPlanFile,
  planNameFromFile,
  rasterizePlanFile,
  type RasterizedPdfPage,
} from './pdfToImage';
import { ScaleCalibrator, type PixelPoint } from './ScaleCalibrator';

type Step = 'source' | 'scale' | 'extract' | 'apply' | 'done';
type Target = 'new' | 'active';
/** Which calibration the import will actually use. */
type ScaleSource = 'manual' | 'ai';
type ExtractStatus = 'idle' | 'pending' | 'ok' | 'error';

const STEPS: { step: Step; label: string }[] = [
  { step: 'source', label: 'Source' },
  { step: 'scale', label: 'Scale' },
  { step: 'extract', label: 'Extract' },
  { step: 'apply', label: 'Apply' },
];

const EMPTY_COUNTS: ExtractionApplyCounts = {
  walls: 0,
  zones: 0,
  cores: 0,
  openings: 0,
  columns: 0,
  slabs: 0,
};

/** How long the success state lingers before the dialog gets out of the way. */
const SUCCESS_DWELL_MS = 1800;

// —— small presentational helpers ————————————————————————————————
function StepChips({ step }: { step: Step }) {
  const activeIndex = STEPS.findIndex((entry) => entry.step === step);
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((entry, index) => {
        const state = step === 'done' || index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo';
        const tone =
          state === 'active'
            ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
            : state === 'done'
              ? 'border-editor-border bg-editor-raised text-gray-400'
              : 'border-transparent text-gray-600';
        return (
          <span
            key={entry.step}
            className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
          >
            {index + 1} {entry.label}
          </span>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <FieldLabel>{label}</FieldLabel>
      <span className="truncate text-xs text-gray-300">{value}</span>
    </div>
  );
}

function CountPill({ label, value }: { label: string; value: number }) {
  return (
    <div
      className={`rounded-sm border px-2 py-1.5 text-center ${
        value > 0
          ? 'border-editor-border bg-editor-raised'
          : 'border-editor-border/60 bg-transparent opacity-50'
      }`}
    >
      <div className="font-mono text-sm tabular-nums text-gray-200">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
    </div>
  );
}

function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'error';
  title?: string;
  children?: ReactNode;
}) {
  const style =
    tone === 'error'
      ? 'border-red-900/70 bg-red-950/30 text-red-200'
      : tone === 'warn'
        ? 'border-amber-800/70 bg-amber-950/30 text-amber-200'
        : 'border-editor-border bg-editor-raised text-gray-300';
  return (
    <div className={`rounded-sm border px-2.5 py-2 text-xs ${style}`}>
      {title ? <div className="mb-0.5 font-semibold">{title}</div> : null}
      {children}
    </div>
  );
}

// —— dialog ————————————————————————————————————————————————————
export interface ImportPlanDialogProps {
  onClose: () => void;
}

export function ImportPlanDialog({ onClose }: ImportPlanDialogProps) {
  const units = useEditorStore((state) => state.project.settings.units);
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const activeFloorName = useEditorStore(
    (state) =>
      state.project.building.floors.find((floor) => floor.id === state.activeFloorId)?.name ?? '—',
  );

  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const [step, setStep] = useState<Step>('source');
  const [raster, setRaster] = useState<RasterizedPdfPage | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceIsPdf, setSourceIsPdf] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [target, setTarget] = useState<Target>('new');
  const [nameDraft, setNameDraft] = useState('');
  const [nameTouched, setNameTouched] = useState(false);

  const [points, setPoints] = useState<PixelPoint[]>([]);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [scaleSource, setScaleSource] = useState<ScaleSource>('manual');

  const [extractStatus, setExtractStatus] = useState<ExtractStatus>('idle');
  const [plan, setPlan] = useState<ExtractedPlan | null>(null);
  const [extractError, setExtractError] = useState<ExtractPlanError | null>(null);
  const [underlayOnly, setUnderlayOnly] = useState(false);

  const [appliedCounts, setAppliedCounts] = useState<ExtractionApplyCounts | null>(null);
  const [appliedFloorLabel, setAppliedFloorLabel] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  // Mirrored in a ref so `requestClose` can decide "second Escape closes"
  // without a state updater that StrictMode would run twice.
  const confirmCloseRef = useRef(false);

  // —— derived calibration ——
  const first = points[0];
  const second = points[1];
  const pixelDistance = first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
  const manualMetersPerPixel =
    pixelDistance > 0 && distanceMeters > 0 ? distanceMeters / pixelDistance : null;

  const aiMetersPerFrameUnit = plan?.scale.metersPerFrameUnit ?? null;
  const aiMetersPerPixel =
    raster && aiMetersPerFrameUnit !== null && aiMetersPerFrameUnit > 0
      ? metersPerPixelFromFrameUnits(aiMetersPerFrameUnit, raster.width, raster.height)
      : null;

  const metersPerPixel = scaleSource === 'ai' ? aiMetersPerPixel : manualMetersPerPixel;
  const scaled = metersPerPixel !== null && metersPerPixel > 0;

  const planWidthMeters = raster && metersPerPixel ? raster.width * metersPerPixel : 0;
  const planHeightMeters = raster && metersPerPixel ? raster.height * metersPerPixel : 0;

  const appliedPlan = underlayOnly ? null : plan;
  const busy = reading || extractStatus === 'pending';
  const dirty = raster !== null || reading;

  // —— close / escape ——
  const requestClose = useCallback(() => {
    if (busy) return;
    if (!dirty || step === 'done') {
      onClose();
      return;
    }
    if (confirmCloseRef.current) {
      onClose();
      return;
    }
    confirmCloseRef.current = true;
    setConfirmClose(true);
  }, [busy, dirty, onClose, step]);

  const dismissConfirm = useCallback(() => {
    confirmCloseRef.current = false;
    setConfirmClose(false);
  }, []);

  // Focus the panel so Escape and the shortcut shield work without a click.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Success state closes itself; the counts stay visible long enough to read.
  useEffect(() => {
    if (step !== 'done') return;
    const timer = window.setTimeout(onClose, SUCCESS_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [step, onClose]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // Shield the editor's global shortcuts for the whole dialog subtree.
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    // A field that already consumed Escape (draft revert) wins over closing.
    if (event.defaultPrevented) return;
    event.preventDefault();
    requestClose();
  }

  // —— file intake ——
  const acceptFile = useCallback(async (file: File) => {
    setFileError(null);
    if (!isSupportedPlanFile(file)) {
      setFileError(`"${file.name}" is not a supported plan file. Use PDF, PNG, JPEG or WebP.`);
      return;
    }
    setReading(true);
    setRaster(null);
    setPoints([]);
    setDistanceMeters(0);
    setScaleSource('manual');
    setPlan(null);
    setExtractError(null);
    setExtractStatus('idle');
    setUnderlayOnly(false);
    try {
      const result = await rasterizePlanFile(file, DEFAULT_MAX_DIM);
      if (!aliveRef.current) return;
      setRaster(result);
      setSourceLabel(file.name);
      setSourceIsPdf(isPdfFile(file));
      setNameDraft((current) => (current && nameTouched ? current : planNameFromFile(file)));
    } catch (error) {
      if (!aliveRef.current) return;
      setFileError(error instanceof Error ? error.message : 'This file could not be read.');
    } finally {
      if (aliveRef.current) setReading(false);
    }
  }, [nameTouched]);

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) void acceptFile(file);
  }

  // —— extraction ——
  const runExtraction = useCallback(async () => {
    const current = raster;
    if (!current) return;
    setExtractStatus('pending');
    setExtractError(null);
    setPlan(null);
    setUnderlayOnly(false);
    // A failed/cleared reading must not leave the AI scale selected.
    setScaleSource((source) => (source === 'ai' ? 'manual' : source));
    try {
      const result = await requestPlanExtraction(current.dataUrl, { floorName: nameDraft.trim() });
      if (!aliveRef.current) return;
      setPlan(result);
      setExtractStatus('ok');
    } catch (error) {
      if (!aliveRef.current) return;
      setExtractError(
        error instanceof ExtractPlanError
          ? error
          : new ExtractPlanError(
              'extraction-failed',
              error instanceof Error ? error.message : 'Plan extraction failed unexpectedly.',
              0,
            ),
      );
      setExtractStatus('error');
    }
  }, [raster, nameDraft]);

  function goToExtract(): void {
    setStep('extract');
    if (extractStatus === 'idle') void runExtraction();
  }

  // —— apply: exactly one history entry ——
  function handleApply(): void {
    if (!raster || metersPerPixel === null || metersPerPixel <= 0) return;

    const store = getEditorState();
    const floors = store.project.building.floors;
    const metersPerFrameUnit = frameUnitsScaleFromMetersPerPixel(
      metersPerPixel,
      raster.width,
      raster.height,
    );

    // The floor is minted *outside* the recipe so its id is known up front, then
    // spliced in *inside* it — the whole import therefore stays one commit
    // (ARCHITECTURE §8.4) instead of the two `addFloor` + `updateProject` would cost.
    let newFloor: Floor | null = null;
    let insertIndex = floors.length;
    if (target === 'new') {
      const reference =
        floors.find((floor) => floor.id === activeFloorId) ?? floors[floors.length - 1];
      insertIndex = reference ? reference.index + 1 : floors.length;
      newFloor = createFloor(insertIndex, 0, DEFAULTS.floorHeight);
    }

    const floorId = newFloor ? newFloor.id : activeFloorId;
    const desiredName = nameDraft.trim();
    const rename = desiredName !== '' && (target === 'new' || nameTouched);

    let counts: ExtractionApplyCounts = { ...EMPTY_COUNTS };
    let label = '';

    store.updateProject('Import floor plan', (draft) => {
      if (newFloor) {
        draft.building.floors.splice(insertIndex, 0, newFloor);
        // Same post-insert fixup the store performs for `addFloor`: renumber,
        // keep auto-generated names in step with the new index, then restack.
        draft.building.floors.forEach((floor, index) => {
          if (floor.name === floorName(floor.index)) floor.name = floorName(index);
          floor.index = index;
        });
        recomputeElevations(draft.building.floors);
      }

      const floor = draft.building.floors.find((candidate) => candidate.id === floorId);
      if (!floor) return;

      if (appliedPlan) {
        counts = applyExtractionToFloor(draft, floorId, appliedPlan, { metersPerFrameUnit });
      }
      if (rename) floor.name = desiredName;
      label = floor.name;

      floor.underlay = {
        imageDataUrl: raster.dataUrl,
        metersPerPixel,
        imageWidth: raster.width,
        imageHeight: raster.height,
        // Line the bitmap up with the geometry that came out of the same plan;
        // with no plan there is no geometry to line up with, so it centres.
        offset: appliedPlan
          ? underlayOffsetForPlan(appliedPlan, metersPerFrameUnit, raster.width, raster.height)
          : { x: 0, y: 0 },
        rotation: 0,
        opacity: 0.5,
        visible: true,
      };
    });

    store.setActiveFloor(floorId);
    setAppliedCounts(counts);
    setAppliedFloorLabel(label);
    setStep('done');
  }

  // —— step bodies ————————————————————————————————————————————
  function renderSource() {
    return (
      <div className="flex flex-col gap-3">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed px-4 py-7 text-center transition-colors ${
            dragActive
              ? 'border-amber-500/70 bg-amber-500/10'
              : 'border-editor-border bg-editor-raised/40'
          }`}
        >
          <div className="text-xs text-gray-300">Drop a floor plan here</div>
          <div className="text-[11px] text-gray-500">PDF, PNG, JPEG or WebP — first page of a PDF</div>
          <input
            ref={fileInputRef}
            type="file"
            accept={PLAN_FILE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void acceptFile(file);
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={reading} className="mt-1">
            Choose file…
          </Button>
        </div>

        {reading ? <Notice>Reading the plan…</Notice> : null}
        {fileError ? (
          <Notice tone="error" title="That file could not be imported">
            {fileError}
          </Notice>
        ) : null}

        {raster ? (
          <div className="flex gap-3 rounded-sm border border-editor-border bg-editor-raised/40 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a client-side data URL has nothing to optimize */}
            <img
              src={raster.dataUrl}
              alt="Imported plan preview"
              className="h-28 w-40 shrink-0 rounded-sm border border-editor-border bg-white object-contain"
            />
            <div className="min-w-0 flex-1">
              <Row label="File" value={sourceLabel} />
              <Row label="Raster" value={`${raster.width} × ${raster.height} px`} />
              {sourceIsPdf ? (
                <Row
                  label="Pages"
                  value={`${raster.pageCount} — first page imported`}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <FieldLabel>Target</FieldLabel>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-300">
              <input
                type="radio"
                name="compass-import-target"
                checked={target === 'new'}
                onChange={() => setTarget('new')}
                className="h-3 w-3 accent-amber-500"
              />
              New floor above active
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-300">
              <input
                type="radio"
                name="compass-import-target"
                checked={target === 'active'}
                onChange={() => setTarget('active')}
                className="h-3 w-3 accent-amber-500"
              />
              Into active floor ({activeFloorName})
            </label>
            <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
              {target === 'new'
                ? 'A new level is inserted directly above the active floor.'
                : 'Imported entities are appended to the active floor; nothing already there is removed.'}
            </p>
          </div>
          <div>
            <TextField
              label="Floor name"
              value={nameDraft}
              placeholder="e.g. Level 12"
              onCommit={(next) => {
                setNameTouched(true);
                setNameDraft(next);
              }}
            />
            <p className="mt-1 text-[11px] leading-snug text-gray-500">
              Also sent to the extraction as context for reading suite labels.
            </p>
          </div>
        </div>
      </div>
    );
  }

  function renderScale() {
    if (!raster) return null;
    return (
      <div className="flex flex-col gap-3">
        <Notice>
          Click two points on the plan whose real distance you know — a printed dimension, a scale
          bar, or a column bay — then type that distance.
        </Notice>

        <div className="flex justify-center">
          <ScaleCalibrator
            imageDataUrl={raster.dataUrl}
            imageWidth={raster.width}
            imageHeight={raster.height}
            points={points}
            onPointsChange={(next) => {
              setPoints(next);
              // Touching the markers means the manual calibration is in charge again.
              setScaleSource('manual');
            }}
          />
        </div>

        <div className="grid grid-cols-[12rem,1fr,auto] items-end gap-3">
          <NumberField
            label="Real distance between points"
            unit="length"
            value={distanceMeters}
            min={0}
            step={units === 'imperial' ? 1 : 0.5}
            onCommit={(next) => {
              setDistanceMeters(next);
              setScaleSource('manual');
            }}
          />
          <div className="text-xs">
            {pixelDistance > 0 ? (
              <Row label="Measured" value={`${Math.round(pixelDistance)} px`} />
            ) : (
              <Row label="Measured" value={`${points.length} of 2 points placed`} />
            )}
            {manualMetersPerPixel ? (
              <>
                <Row
                  label="Scale"
                  value={`${formatNumber(manualMetersPerPixel, 5)} m / px`}
                />
                <Row
                  label="Plan extent"
                  value={`${formatLength(raster.width * manualMetersPerPixel, units)} × ${formatLength(
                    raster.height * manualMetersPerPixel,
                    units,
                  )}`}
                />
              </>
            ) : (
              <Row label="Scale" value="—" />
            )}
          </div>
          <Button onClick={() => setPoints([])} disabled={points.length === 0}>
            Reset points
          </Button>
        </div>

        {scaleSource === 'ai' && aiMetersPerPixel ? (
          <Notice tone="warn" title="Using the AI scale estimate">
            {formatNumber(aiMetersPerPixel, 5)} m / px
            {plan?.scale.basis ? ` — ${plan.scale.basis}` : ''}. Place two points above to override it.
          </Notice>
        ) : null}
      </div>
    );
  }

  function renderExtract() {
    return (
      <div className="flex flex-col gap-3">
        {extractStatus === 'pending' ? (
          <div className="flex items-center gap-2 rounded-sm border border-editor-border bg-editor-raised px-2.5 py-3 text-xs text-gray-300">
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border border-amber-400/80 border-t-transparent"
            />
            Reading the plan with Claude — walls, zones, cores, openings and columns. This usually
            takes 20–60 seconds.
          </div>
        ) : null}

        {extractStatus === 'error' && extractError ? (
          <>
            <Notice tone="error" title={extractionErrorTitle(extractError.code)}>
              {extractError.message}
              <div className="mt-1 font-mono text-[10px] text-red-300/70">
                {extractError.code}
                {extractError.status > 0 ? ` · HTTP ${extractError.status}` : ''}
              </div>
            </Notice>
            <div className="flex items-center gap-2">
              {isRetryable(extractError) ? (
                <Button onClick={() => void runExtraction()}>Re-run extraction</Button>
              ) : null}
              {isExtractionUnavailable(extractError) ? (
                scaled ? (
                  <Button
                    onClick={() => {
                      setUnderlayOnly(true);
                      setStep('apply');
                    }}
                  >
                    Import as underlay only →
                  </Button>
                ) : (
                  <Button
                    onClick={() => setStep('scale')}
                    title="An underlay still needs a scale — calibrate first"
                  >
                    ← Calibrate to import as underlay
                  </Button>
                )
              ) : null}
            </div>
          </>
        ) : null}

        {extractStatus === 'ok' && plan ? (
          <>
            <div className="grid grid-cols-6 gap-2">
              <CountPill label="Walls" value={plan.walls.length} />
              <CountPill label="Zones" value={plan.zones.length} />
              <CountPill label="Cores" value={plan.cores.length} />
              <CountPill label="Openings" value={plan.openings.length} />
              <CountPill label="Columns" value={plan.columns.length} />
              <CountPill label="Footprint" value={plan.footprint ? plan.footprint.length : 0} />
            </div>

            <div className="rounded-sm border border-editor-border bg-editor-raised/40 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                AI scale estimate
              </div>
              {aiMetersPerPixel ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-xs text-gray-300">
                    <span className="font-mono tabular-nums">
                      {formatNumber(aiMetersPerPixel, 5)} m / px
                    </span>
                    {plan.scale.basis ? (
                      <span className="text-gray-500"> — {plan.scale.basis}</span>
                    ) : null}
                    <div className="text-[11px] text-gray-500">
                      Implies a plate of{' '}
                      {formatLength(raster ? raster.width * aiMetersPerPixel : 0, units)} ×{' '}
                      {formatLength(raster ? raster.height * aiMetersPerPixel : 0, units)}
                      {manualMetersPerPixel
                        ? ` · your calibration says ${formatNumber(manualMetersPerPixel, 5)} m / px`
                        : ''}
                    </div>
                  </div>
                  <Button
                    onClick={() => setScaleSource('ai')}
                    active={scaleSource === 'ai'}
                    className="shrink-0"
                  >
                    {scaleSource === 'ai' ? 'In use' : manualMetersPerPixel ? 'Use instead' : 'Use this'}
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-gray-500">
                  No usable scale evidence was found in the drawing
                  {plan.scale.basis ? ` (${plan.scale.basis})` : ''} — your two-point calibration is
                  required.
                </div>
              )}
            </div>

            {plan.notes ? <Notice tone="warn" title="Reader notes">{plan.notes}</Notice> : null}

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                Zones read ({plan.zones.length})
              </div>
              {plan.zones.length === 0 ? (
                <div className="text-xs text-gray-500">No labelled areas were identified.</div>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-sm border border-editor-border">
                  {plan.zones.map((zone, index) => (
                    <div
                      key={`${zone.name}-${index}`}
                      className="flex items-baseline justify-between gap-2 border-b border-editor-border/60 px-2 py-1 text-xs last:border-b-0"
                    >
                      <span className="truncate text-gray-300">{zone.name}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-gray-500">
                        {titleCase(zone.kind)}
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-gray-400">
                        {zone.labeledAreaSqft === null
                          ? '—'
                          : `${formatNumber(zone.labeledAreaSqft, 0)} SF`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Button onClick={() => void runExtraction()}>Re-run extraction</Button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  function renderApply() {
    if (!raster) return null;
    const zonesWithLabels = appliedPlan
      ? appliedPlan.zones.filter((zone) => zone.labeledAreaSqft !== null).length
      : 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-sm border border-editor-border bg-editor-raised/40 p-2">
          <Row
            label="Target"
            value={
              target === 'new'
                ? `New floor above ${activeFloorName}`
                : `Existing floor ${activeFloorName}`
            }
          />
          <Row label="Floor name" value={nameDraft.trim() || '(unchanged)'} />
          <Row
            label="Scale"
            value={`${formatNumber(metersPerPixel ?? 0, 5)} m / px · ${
              scaleSource === 'ai' ? 'AI estimate' : 'two-point calibration'
            }`}
          />
          <Row
            label="Plate extent"
            value={`${formatLength(planWidthMeters, units)} × ${formatLength(planHeightMeters, units)} (${formatArea(
              planWidthMeters * planHeightMeters,
              units,
            )} of paper)`}
          />
          <Row label="Underlay" value="Pinned at 50% opacity, visible" />
        </div>

        {appliedPlan ? (
          <>
            <div className="grid grid-cols-6 gap-2">
              <CountPill label="Walls" value={appliedPlan.walls.length} />
              <CountPill label="Zones" value={appliedPlan.zones.length} />
              <CountPill label="Cores" value={appliedPlan.cores.length} />
              <CountPill label="Openings" value={appliedPlan.openings.length} />
              <CountPill label="Columns" value={appliedPlan.columns.length} />
              <CountPill label="Slab" value={appliedPlan.footprint ? 1 : 0} />
            </div>
            <p className="text-[11px] leading-snug text-gray-500">
              Everything above is created in a single undoable step (“Import floor plan”). Very short
              segments and openings that cannot fit their wall are dropped by the importer.
              {zonesWithLabels > 0
                ? ` ${zonesWithLabels} zone${zonesWithLabels === 1 ? '' : 's'} carried a printed area figure — cross-check it against the Area panel once imported.`
                : ''}
            </p>
          </>
        ) : (
          <Notice tone="warn" title="Underlay-only import">
            No geometry will be created — the plan is pinned to the floor as a calibrated reference
            image so it can be traced with the wall tool.
          </Notice>
        )}
      </div>
    );
  }

  function renderDone() {
    const counts = appliedCounts ?? EMPTY_COUNTS;
    const created =
      counts.walls + counts.zones + counts.cores + counts.openings + counts.columns + counts.slabs;
    return (
      <div className="flex flex-col gap-2 py-6 text-center">
        <div className="text-sm text-amber-300">Plan imported onto {appliedFloorLabel || 'the floor'}</div>
        <div className="font-mono text-xs tabular-nums text-gray-400">
          {created === 0
            ? 'underlay only — no geometry created'
            : `${counts.slabs} slab · ${counts.walls} walls · ${counts.openings} openings · ${counts.zones} zones · ${counts.cores} cores · ${counts.columns} columns`}
        </div>
        <div className="text-[11px] text-gray-500">One undo step reverses the whole import.</div>
      </div>
    );
  }

  // —— footer ————————————————————————————————————————————————
  function renderFooter() {
    if (step === 'done') {
      return (
        <>
          <span className="text-[11px] text-gray-500">Closing…</span>
          <Button onClick={onClose}>Close</Button>
        </>
      );
    }

    const back =
      step === 'scale' ? 'source' : step === 'extract' ? 'scale' : step === 'apply' ? 'extract' : null;

    return (
      <>
        <div className="flex items-center gap-2">
          {back ? (
            <Button onClick={() => setStep(back)} disabled={busy}>
              ← Back
            </Button>
          ) : null}
          {step === 'scale' ? (
            <Button
              onClick={() => setScaleSource('ai')}
              disabled={aiMetersPerPixel === null}
              title={
                aiMetersPerPixel === null
                  ? 'Available once an extraction has returned a scale estimate'
                  : 'Use the scale Claude read from the drawing'
              }
            >
              Skip — use AI scale estimate
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {step === 'source' ? (
            <Button onClick={() => setStep('scale')} disabled={!raster || reading} active>
              Next: calibrate →
            </Button>
          ) : null}

          {step === 'scale' ? (
            scaled ? (
              <Button onClick={goToExtract} active>
                Next: extract →
              </Button>
            ) : (
              <Button
                onClick={goToExtract}
                title="Run the extraction first, then adopt the scale estimate it returns"
              >
                Extract first (for an AI scale estimate) →
              </Button>
            )
          ) : null}

          {step === 'extract' ? (
            <Button
              onClick={() => setStep('apply')}
              disabled={!scaled || !(extractStatus === 'ok' || underlayOnly)}
              active
              title={scaled ? undefined : 'A scale is required before anything can be imported'}
            >
              Next: apply →
            </Button>
          ) : null}

          {step === 'apply' ? (
            <Button onClick={handleApply} disabled={!scaled} active>
              Apply import
            </Button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Scrim: also the pointer barrier that keeps the 3D viewport inert. */}
      <div
        className="absolute inset-0 bg-black/70"
        onPointerDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Import floor plan"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative flex max-h-[90vh] w-[860px] max-w-full flex-col overflow-hidden rounded-md border border-editor-border bg-editor-panel shadow-2xl shadow-black/60 outline-none"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-editor-border px-3 py-2">
          <span className="whitespace-nowrap text-xs font-semibold tracking-wide text-amber-400">
            IMPORT PLAN
          </span>
          <StepChips step={step} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            title="Close (Esc)"
            className="rounded-sm px-1.5 text-sm text-gray-500 hover:bg-editor-raised hover:text-gray-200 disabled:opacity-40"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {step === 'source' ? renderSource() : null}
          {step === 'scale' ? renderScale() : null}
          {step === 'extract' ? renderExtract() : null}
          {step === 'apply' ? renderApply() : null}
          {step === 'done' ? renderDone() : null}
        </div>

        {confirmClose && step !== 'done' ? (
          <div className="flex shrink-0 items-center gap-2 border-t border-amber-800/70 bg-amber-950/30 px-3 py-2">
            <span className="flex-1 text-xs text-amber-200">
              Discard this plan import? Nothing has been added to the document yet.
            </span>
            <Button onClick={onClose} danger>
              Discard
            </Button>
            <Button onClick={dismissConfirm}>Keep editing</Button>
          </div>
        ) : null}

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-editor-border bg-editor-panel px-3 py-2">
          {renderFooter()}
        </footer>
      </div>
    </div>
  );
}

export default ImportPlanDialog;
