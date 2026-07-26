'use client';

/**
 * Precise numeric input for the inspector.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Design (one consistent contract everywhere in the UI):
 *  - `value` is always the **stored** value — meters for `unit="length"`,
 *    square meters for `unit="area"`, raw numbers for `plain`/`degrees`.
 *  - Conversion to/from the project's display units happens inside the field,
 *    so no call site ever converts. `onCommit` receives stored units back.
 *  - Typing edits a local draft; the store is written only on Enter or blur,
 *    and only when the parsed value actually differs (NaN or unchanged reverts).
 *    Escape reverts and blurs. ArrowUp/Down step (Shift = 10×) and commit
 *    immediately, which is what precise nudging of a plan needs.
 *
 * Degrees are *not* converted (radians↔degrees is the caller's concern, since
 * only furniture rotation stores radians); the unit only drives the suffix.
 */

import { useState } from 'react';

import { formatNumber, round } from '@/lib/format';
import {
  areaToDisplay,
  areaUnitLabel,
  displayToArea,
  displayToLength,
  lengthToDisplay,
  lengthUnitLabel,
  type Units,
} from '@/lib/units';
import { useEditorStore } from '@/store/useEditorStore';

export type NumberFieldUnit = 'length' | 'area' | 'plain' | 'degrees';

export interface NumberFieldProps {
  label?: string;
  /** Stored value (meters / m² / raw). */
  value: number;
  /** Called with the next value in stored units. Never called for no-ops. */
  onCommit: (next: number) => void;
  unit?: NumberFieldUnit;
  /** Arrow-key step, in display units. */
  step?: number;
  /** Bounds, in display units. */
  min?: number;
  max?: number;
  /** Decimals shown when the field is idle. */
  decimals?: number;
  disabled?: boolean;
  /** Overrides the derived unit suffix (pass '' to hide it). */
  suffix?: string;
  title?: string;
  className?: string;
}

function toDisplay(value: number, unit: NumberFieldUnit, units: Units): number {
  if (unit === 'length') return lengthToDisplay(value, units);
  if (unit === 'area') return areaToDisplay(value, units);
  return value;
}

function fromDisplay(value: number, unit: NumberFieldUnit, units: Units): number {
  if (unit === 'length') return displayToLength(value, units);
  if (unit === 'area') return displayToArea(value, units);
  return value;
}

function derivedSuffix(unit: NumberFieldUnit, units: Units): string {
  if (unit === 'length') return lengthUnitLabel(units);
  if (unit === 'area') return areaUnitLabel(units);
  if (unit === 'degrees') return '°';
  return '';
}

/** Tolerant parse: accepts grouped digits and a trailing unit. */
function parseNumeric(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').replace(/[^0-9+\-.eE]/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '+' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function NumberField({
  label,
  value,
  onCommit,
  unit = 'plain',
  step = 0.1,
  min,
  max,
  decimals,
  disabled,
  suffix,
  title,
  className,
}: NumberFieldProps) {
  const units = useEditorStore((state) => state.project.settings.units);
  const [draft, setDraft] = useState<string | null>(null);

  const display = toDisplay(Number.isFinite(value) ? value : 0, unit, units);
  const places = decimals ?? (unit === 'degrees' ? 1 : 2);
  const shown = draft ?? formatNumber(display, places);
  const suffixLabel = suffix ?? derivedSuffix(unit, units);

  function clampDisplay(next: number): number {
    let out = next;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    return round(out, 6);
  }

  /** Commit a value expressed in display units. Returns the clamped value. */
  function commitDisplay(next: number): number {
    const clamped = clampDisplay(next);
    if (Math.abs(clamped - display) > 1e-9) onCommit(fromDisplay(clamped, unit, units));
    return clamped;
  }

  function commitDraft() {
    if (draft === null) return;
    const parsed = parseNumeric(draft);
    setDraft(null);
    if (parsed === null) return; // unparseable → revert, no store write
    commitDisplay(parsed);
  }

  function nudge(direction: 1 | -1, multiplier: number) {
    const base = draft !== null ? (parseNumeric(draft) ?? display) : display;
    const next = commitDisplay(base + direction * step * multiplier);
    if (draft !== null) setDraft(String(round(next, places + 2)));
  }

  return (
    <label className={`flex min-w-0 flex-col gap-0.5 ${className ?? ''}`} title={title}>
      {label ? (
        <span className="truncate text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      ) : null}
      <span className="relative flex items-center">
        <input
          type="text"
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          value={shown}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onFocus={(event) => {
            setDraft(String(round(display, places + 2)));
            event.currentTarget.select();
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitDraft();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
              event.currentTarget.blur();
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              nudge(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey ? 10 : 1);
            }
          }}
          className={`h-7 w-full rounded-sm border border-editor-border bg-editor-bg py-0 pl-1.5 text-right font-mono text-xs tabular-nums text-editor-text outline-none focus:border-amber-500/70 disabled:opacity-50 ${
            suffixLabel ? 'pr-7' : 'pr-1.5'
          }`}
        />
        {suffixLabel ? (
          <span className="pointer-events-none absolute right-1.5 text-[10px] text-gray-500">
            {suffixLabel}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export default NumberField;
