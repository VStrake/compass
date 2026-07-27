'use client';

/**
 * Rent-roll import dialog — the client half of M2 Slice B.
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * Three steps, one modal, **one undo entry**:
 *
 *  1. **Paste** — a tab/comma-separated roll pasted straight out of Excel, or a
 *     picked `.tsv`/`.csv`. "Copy template" drops `RENT_ROLL_TEMPLATE` into the
 *     box so the expected columns are self-documenting.
 *  2. **Review** — `parseRentRoll` + `summarizeRentRoll`: occupancy tiles, a
 *     per-floor table (top floor first, the way a stack sheet reads), and every
 *     parser issue with its line number. Fatal issues block Apply; row-level
 *     warnings do not — a roll with three unreadable rows out of four hundred is
 *     still worth importing, and the skipped rows are reported.
 *  3. **Apply** — a single `updateProject('Import rent roll', …)` wrapping
 *     `applyRentRollToProject`, so Ctrl+Z reverses the entire import.
 *
 * ## Isolation
 * Same conventions as `ImportPlanDialog`: the scrim is the pointer barrier that
 * keeps the 3D viewport inert, keydowns are stopped at the panel so the shell's
 * V/W/M/Delete map cannot fire while the textarea has focus, and discarding a
 * pasted roll is an inline confirmation rather than `window.confirm`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  RENT_ROLL_TEMPLATE,
  applyRentRollToProject,
  parseRentRoll,
  summarizeRentRoll,
  type RentRollApplyResult,
  type RentRollIssue,
  type RentRollParseResult,
} from '@/core/import/rentRoll';
import { formatInt, formatPercent } from '@/lib/format';
import { getEditorState, useEditorStore } from '@/store/useEditorStore';

import { Button, CheckboxField, FieldLabel } from '../primitives';

type Step = 'paste' | 'review' | 'done';
type IssueTone = 'error' | 'warn' | 'info';

const STEPS: { step: Step; label: string }[] = [
  { step: 'paste', label: 'Paste' },
  { step: 'review', label: 'Review' },
  { step: 'done', label: 'Apply' },
];

const ROLL_FILE_ACCEPT = '.tsv,.csv,.txt,text/tab-separated-values,text/csv,text/plain';

/** A parser issue that blocks the import rather than merely annotating a row. */
function isFatal(issue: RentRollIssue): boolean {
  return issue.severity === 'fatal';
}

function issueTone(issue: RentRollIssue): IssueTone {
  return issue.severity === 'fatal' ? 'error' : 'warn';
}

// —— presentational helpers ——————————————————————————————————————
function StepChips({ step }: { step: Step }) {
  const activeIndex = STEPS.findIndex((entry) => entry.step === step);
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((entry, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo';
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

function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: IssueTone;
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

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-sm border border-editor-border bg-editor-raised px-2 py-1.5 text-center">
      <div
        className={`font-mono text-sm tabular-nums ${accent ? 'text-amber-400' : 'text-gray-200'}`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
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
      <div className="font-mono text-sm tabular-nums text-gray-200">{formatInt(value)}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
    </div>
  );
}

function IssueList({ issues, max = 200 }: { issues: RentRollIssue[]; max?: number }) {
  if (issues.length === 0) return null;
  const shown = issues.slice(0, max);
  return (
    <div className="max-h-40 overflow-y-auto rounded-sm border border-editor-border">
      {shown.map((issue, index) => {
        const tone = issueTone(issue);
        const line = issue.line;
        const style =
          tone === 'error'
            ? 'bg-red-950/30 text-red-200'
            : tone === 'warn'
              ? 'bg-amber-950/20 text-amber-200'
              : 'text-gray-400';
        return (
          <div
            key={`${line ?? 'x'}-${index}`}
            className={`flex items-baseline gap-2 border-b border-editor-border/60 px-2 py-1 text-[11px] leading-snug last:border-b-0 ${style}`}
          >
            <span className="w-12 shrink-0 font-mono tabular-nums opacity-70">
              {line === null ? '—' : `L${line}`}
            </span>
            <span className="min-w-0 flex-1">{issue.message}</span>
          </div>
        );
      })}
      {issues.length > shown.length ? (
        <div className="px-2 py-1 text-[11px] text-gray-500">
          …and {formatInt(issues.length - shown.length)} more.
        </div>
      ) : null}
    </div>
  );
}

// —— dialog ————————————————————————————————————————————————————
export interface RentRollDialogProps {
  onClose: () => void;
}

export function RentRollDialog({ onClose }: RentRollDialogProps) {
  const projectName = useEditorStore((state) => state.project.name);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const [step, setStep] = useState<Step>('paste');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<RentRollParseResult | null>(null);
  const [switchToTenantColors, setSwitchToTenantColors] = useState(true);
  const [result, setResult] = useState<RentRollApplyResult | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // Mirrored in a ref so "second Escape closes" needs no state updater that
  // StrictMode would run twice.
  const confirmCloseRef = useRef(false);

  const lineCount = useMemo(
    () => text.split(/\r?\n/).filter((line) => line.trim() !== '').length,
    [text],
  );

  const summary = useMemo(
    () => (parsed ? summarizeRentRoll(parsed.rows) : null),
    [parsed],
  );

  const fatalIssues = useMemo(
    () => (parsed ? parsed.issues.filter(isFatal) : []),
    [parsed],
  );

  // `summarizeRentRoll` returns floors ascending; a stack sheet reads top-down.
  const byFloor = useMemo(
    () => (summary ? [...summary.byFloor].sort((a, b) => b.floor - a.floor) : []),
    [summary],
  );

  const dirty = text.trim() !== '';

  // —— close / escape ——
  const requestClose = useCallback(() => {
    if (reading) return;
    if (!dirty || step === 'done' || confirmCloseRef.current) {
      onClose();
      return;
    }
    confirmCloseRef.current = true;
    setConfirmClose(true);
  }, [dirty, onClose, reading, step]);

  const dismissConfirm = useCallback(() => {
    confirmCloseRef.current = false;
    setConfirmClose(false);
  }, []);

  // Focus the panel so Escape and the shortcut shield work without a click.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // Shield the editor's global shortcuts for the whole dialog subtree.
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    requestClose();
  }

  // —— intake ——
  const acceptFile = useCallback(async (file: File) => {
    setFileError(null);
    setReading(true);
    try {
      const content = await file.text();
      if (!aliveRef.current) return;
      setText(content);
      setParsed(null);
    } catch (error) {
      if (!aliveRef.current) return;
      setFileError(error instanceof Error ? error.message : 'That file could not be read.');
    } finally {
      if (aliveRef.current) setReading(false);
    }
  }, []);

  function goToReview(): void {
    setParsed(parseRentRoll(text));
    setStep('review');
  }

  // —— apply: exactly one history entry ——
  function handleApply(): void {
    if (!parsed || fatalIssues.length > 0) return;
    const rows = parsed.rows;
    const store = getEditorState();

    let applied = null as RentRollApplyResult | null;
    store.updateProject('Import rent roll', (draft) => {
      applied = applyRentRollToProject(draft, rows);
    });

    setResult(applied);
    if (switchToTenantColors) store.setColorMode('tenant');
    setStep('done');
  }

  // —— step bodies ————————————————————————————————————————————
  function renderPaste() {
    return (
      <div className="flex flex-col gap-3">
        <Notice>
          Paste a rent roll straight out of Excel — one row per suite, tab or comma separated, with a
          header line. Recognised columns: <span className="font-mono">floor</span>,{' '}
          <span className="font-mono">suite</span>, <span className="font-mono">tenant</span>,{' '}
          <span className="font-mono">rsf</span>, <span className="font-mono">expiration</span>,{' '}
          <span className="font-mono">notes</span>. Vacancies are rows with no tenant (or the word
          VACANT).
        </Notice>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <FieldLabel>Rent roll</FieldLabel>
            <div className="flex-1" />
            <span className="font-mono text-[10px] tabular-nums text-gray-500">
              {formatInt(lineCount)} line{lineCount === 1 ? '' : 's'}
            </span>
          </div>
          <textarea
            rows={14}
            value={text}
            spellCheck={false}
            placeholder={'floor\tsuite\ttenant\trsf\texpiration\tnotes'}
            onChange={(event) => {
              setText(event.currentTarget.value);
              setParsed(null);
            }}
            className="w-full resize-y rounded-sm border border-editor-border bg-editor-bg px-2 py-1.5 font-mono text-[11px] leading-snug text-editor-text outline-none placeholder:text-gray-600 focus:border-amber-500/70"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ROLL_FILE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void acceptFile(file);
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={reading}>
            Upload .tsv / .csv…
          </Button>
          <Button
            onClick={() => {
              setText(RENT_ROLL_TEMPLATE);
              setParsed(null);
              setFileError(null);
            }}
            title="Replace the box with a blank template showing every recognised column"
          >
            Copy template
          </Button>
          <Button onClick={() => { setText(''); setParsed(null); }} disabled={!dirty}>
            Clear
          </Button>
          <div className="flex-1" />
          <span className="text-[11px] text-gray-500">Target: {projectName}</span>
        </div>

        {reading ? <Notice>Reading the file…</Notice> : null}
        {fileError ? (
          <Notice tone="error" title="That file could not be read">
            {fileError}
          </Notice>
        ) : null}
      </div>
    );
  }

  function renderReview() {
    if (!parsed || !summary) return null;
    // `occupancyPct` is leased/total × 100; `formatPercent` wants the ratio.
    const occupancy = summary.occupancyPct / 100;
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-6 gap-2">
          <StatTile label="Floors" value={formatInt(summary.floors)} />
          <StatTile label="Total RSF" value={formatInt(summary.totalRsf)} />
          <StatTile label="Leased RSF" value={formatInt(summary.leasedRsf)} />
          <StatTile label="Vacant RSF" value={formatInt(summary.vacantRsf)} />
          <StatTile label="Occupancy" value={formatPercent(occupancy, 1)} accent />
          <StatTile label="Tenants" value={formatInt(summary.tenantCount)} />
        </div>

        <div>
          <div className="flex items-center gap-2 px-1 py-1 text-[10px] uppercase tracking-wider text-gray-600">
            <span className="min-w-0 flex-1">Floor</span>
            <span className="w-20 text-right">Total RSF</span>
            <span className="w-20 text-right">Leased</span>
            <span className="w-20 text-right">Vacant</span>
          </div>
          {byFloor.length === 0 ? (
            <div className="px-1 text-xs text-gray-500">No floors were recognised in this roll.</div>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-sm border border-editor-border">
              {byFloor.map((row) => (
                <div
                  key={row.floor}
                  className="flex items-center gap-2 border-b border-editor-border/60 px-2 py-0.5 font-mono text-[11px] tabular-nums last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate font-ui text-gray-300">
                    Floor {row.floor}
                  </span>
                  <span className="w-20 text-right text-gray-300">{formatInt(row.totalRsf)}</span>
                  <span className="w-20 text-right text-gray-400">{formatInt(row.leasedRsf)}</span>
                  <span
                    className={`w-20 text-right ${row.vacantRsf > 0 ? 'text-amber-300/90' : 'text-gray-600'}`}
                  >
                    {formatInt(row.vacantRsf)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {parsed.issues.length > 0 ? (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">
              Parser issues ({formatInt(parsed.issues.length)}
              {fatalIssues.length > 0 ? `, ${formatInt(fatalIssues.length)} fatal` : ''})
            </div>
            <IssueList issues={parsed.issues} />
          </div>
        ) : (
          <Notice>Every row parsed cleanly.</Notice>
        )}

        {fatalIssues.length > 0 ? (
          <Notice tone="error" title="This roll cannot be imported yet">
            Fix the lines flagged above and paste it again. Nothing has been added to the document.
          </Notice>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-sm border border-editor-border bg-editor-raised/40 px-2 py-1.5">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-gray-500">
            {formatInt(parsed.rows.length)} row{parsed.rows.length === 1 ? '' : 's'} will be applied
            to <span className="text-gray-300">{projectName}</span>. Floors that already have drawn
            geometry are matched on suite number and only get their tenant assigned — real geometry
            is never overwritten. One undo step reverses the whole import.
          </p>
          <CheckboxField
            label="Switch to tenant colouring"
            checked={switchToTenantColors}
            onChange={setSwitchToTenantColors}
            className="shrink-0"
          />
        </div>
      </div>
    );
  }

  function renderDone() {
    return (
      <div className="flex flex-col gap-3 py-4">
        <div className="text-center text-sm text-amber-300">Rent roll imported</div>
        {result ? (
          <>
            <div className="grid grid-cols-5 gap-2">
              <CountPill label="Tenants new" value={result.tenantsCreated} />
              <CountPill label="Tenants upd." value={result.tenantsUpdated} />
              <CountPill label="Floors new" value={result.floorsCreated} />
              <CountPill label="Suites new" value={result.zonesCreated} />
              <CountPill label="Suites matched" value={result.zonesMatched} />
            </div>
            {result.rowsSkipped > 0 ? (
              <Notice tone="warn" title={`${formatInt(result.rowsSkipped)} row(s) skipped`}>
                Those rows carried no usable floor, area or tenant. Everything else was applied.
              </Notice>
            ) : null}
            {result.issues.length > 0 ? <IssueList issues={result.issues} max={40} /> : null}
          </>
        ) : null}
        <div className="text-center text-[11px] text-gray-500">
          One undo step reverses the whole import.
        </div>
      </div>
    );
  }

  // —— footer ————————————————————————————————————————————————
  function renderFooter() {
    if (step === 'done') {
      return (
        <>
          <span className="text-[11px] text-gray-500">
            Check the Stacking panel against your source sheet.
          </span>
          <Button onClick={onClose} active>
            Close
          </Button>
        </>
      );
    }

    return (
      <>
        <div className="flex items-center gap-2">
          {step === 'review' ? (
            <Button onClick={() => setStep('paste')}>← Back</Button>
          ) : (
            <span className="text-[11px] text-gray-500">
              Nothing is written to the document until you apply.
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {step === 'paste' ? (
            <Button onClick={goToReview} disabled={!dirty || reading} active>
              Next: review →
            </Button>
          ) : null}
          {step === 'review' ? (
            <Button
              onClick={handleApply}
              disabled={!parsed || parsed.rows.length === 0 || fatalIssues.length > 0}
              active
              title={
                fatalIssues.length > 0
                  ? 'Fatal parser issues must be fixed first'
                  : 'Apply the roll in a single undoable step'
              }
            >
              Apply rent roll
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
        aria-label="Import rent roll"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative flex max-h-[90vh] w-[860px] max-w-full flex-col overflow-hidden rounded-md border border-editor-border bg-editor-panel shadow-2xl shadow-black/60 outline-none"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-editor-border px-3 py-2">
          <span className="whitespace-nowrap text-xs font-semibold tracking-wide text-amber-400">
            RENT ROLL
          </span>
          <StepChips step={step} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={requestClose}
            disabled={reading}
            title="Close (Esc)"
            className="rounded-sm px-1.5 text-sm text-gray-500 hover:bg-editor-raised hover:text-gray-200 disabled:opacity-40"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {step === 'paste' ? renderPaste() : null}
          {step === 'review' ? renderReview() : null}
          {step === 'done' ? renderDone() : null}
        </div>

        {confirmClose && step !== 'done' ? (
          <div className="flex shrink-0 items-center gap-2 border-t border-amber-800/70 bg-amber-950/30 px-3 py-2">
            <span className="flex-1 text-xs text-amber-200">
              Discard this rent roll? Nothing has been added to the document yet.
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

export default RentRollDialog;
