/**
 * Number formatting helpers.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Deliberately locale-fixed to `en-US` grouping: floor plates and rent rolls
 * are exported into US commercial real-estate workflows, and a document that
 * renders differently per browser locale is a support problem.
 */

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function safe(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** `1234567.8` → `"1,234,568"` (rounded, thousands separators). */
export function formatInt(value: number): string {
  return GROUPED.format(Math.round(safe(value)));
}

/** Fixed decimals with thousands separators: `1234.5, 2` → `"1,234.50"`. */
export function formatFixed(value: number, decimals = 2): string {
  const digits = Math.max(0, Math.min(20, Math.trunc(decimals)));
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safe(value));
}

/** Thousands separators, trimming trailing zeros: `1234.50` → `"1,234.5"`. */
export function formatNumber(value: number, maxDecimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.max(0, Math.min(20, Math.trunc(maxDecimals))),
  }).format(safe(value));
}

/**
 * Ratio → percent string. `0.7231` → `"72.3%"`.
 * Pass `decimals = 0` for `"72%"`.
 */
export function formatPercent(ratio: number, decimals = 1): string {
  return `${formatFixed(safe(ratio) * 100, decimals)}%`;
}

/** Signed value with an explicit `+`/`−`: useful for deltas in the inspector. */
export function formatSigned(value: number, decimals = 2): string {
  const v = safe(value);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${formatFixed(Math.abs(v), decimals)}`;
}

/** Compact ordinal for floor labels: `1` → `"1st"`, `12` → `"12th"`. */
export function formatOrdinal(value: number): string {
  const n = Math.trunc(safe(value));
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  const suffix =
    abs >= 11 && abs <= 13 ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** Round to a fixed number of decimals without string round-tripping. */
export function round(value: number, decimals = 3): number {
  const factor = 10 ** Math.max(0, Math.trunc(decimals));
  return Math.round(safe(value) * factor) / factor;
}

/** Clamp helper used by numeric inputs. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(safe(value), min), max);
}
