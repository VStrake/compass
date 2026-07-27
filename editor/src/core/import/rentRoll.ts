/**
 * Rent roll import — tidy tabular leasing data into tenants, suites and plates.
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * A rent roll is the leasing source of truth for a real building: one row per
 * demised suite, carrying the tenant of record, the rentable square feet the
 * landlord bills on, and the lease expiration. This module turns a pasted or
 * uploaded roll into (a) `Tenant` records with stable colors and derived
 * status, and (b) `tenant-suite` `Zone`s on the right floors.
 *
 * Two hard rules:
 *
 *  1. **Never silently mangle a row.** Anything the parser cannot read becomes a
 *     `RentRollIssue` carrying the 1-based line number, and the row is either
 *     fixed up (missing expiration → `null`) or dropped. The caller shows the
 *     issue list before applying.
 *  2. **Never overwrite drawn geometry.** A floor that already has authored
 *     tenant-suite zones is *matched* by suite number, not regenerated. Only a
 *     floor with no suites gets schematic strips.
 *
 * Pure TypeScript: no React, no three.js, no DOM. Runs in Node.
 */

import { SF_PER_SM, SM_PER_SF } from '@/lib/units';
import {
  createFloor,
  createSlab,
  createTenant,
  createZone,
  defaultFloorHeight,
  recomputeElevations,
  rect,
} from '@/core/model/factories';
import type {
  Floor,
  Polygon,
  ProjectDoc,
  SuiteFacts,
  Tenant,
  TenantId,
  TenantStatus,
  Zone,
} from '@/core/model/types';

// —— unit constants ————————————————————————————————————————————————
/**
 * 1 RSF = 0.09290304 m² exactly (the international foot is defined, not
 * measured). Aliases of the display-layer constants in `src/lib/units.ts` under
 * the names the leasing code reads better with — one definition, two names.
 */
export const SQM_PER_SQFT = SM_PER_SF;
export const SQFT_PER_SQM = SF_PER_SM;

/** RSF → m². */
export const rsfToSqm = (rsf: number): number => rsf * SQM_PER_SQFT;
/** m² → RSF. */
export const sqmToRsf = (sqm: number): number => sqm * SQFT_PER_SQM;

// —— limits & defaults ————————————————————————————————————————————
/** Hard row cap — a paste larger than this is a mistake, not a rent roll. */
export const MAX_RENT_ROLL_ROWS = 5000;

/** Default plate proportion (width : depth) for a generated floor plate. */
export const DEFAULT_PLATE_ASPECT = 1.45;

const MS_PER_DAY = 86_400_000;
/** "Within 12 months" uses the mean Gregorian year so it is calendar-stable. */
const TWELVE_MONTHS_MS = 365.25 * MS_PER_DAY;

/** Copy-paste starter, shown in the import dialog. Tab separated. */
export const RENT_ROLL_TEMPLATE = [
  'floor\tsuite\ttenant\trsf\texpiration\tnotes',
  '12\t1200\tAcme Holdings, LLC\t12,450\t2029-06-30\tTermination option 6/30/27',
  '12\t1250\tVACANT\t4,110\t\tWhite box; western views',
].join('\n');

// —— types ————————————————————————————————————————————————————————
/** One normalized rent-roll row. `rsf` is rentable square feet, never m². */
export interface RentRollRow {
  /** 1-based line number in the source text (header included in the count). */
  line: number;
  /** Rent-roll floor number as printed, e.g. `12`. Maps to floor index 11. */
  floor: number;
  /** Suite number as printed, e.g. `"2450"`. Empty string when the roll omits it. */
  suite: string;
  /** `null` for a vacancy row (blank tenant, or a name starting with "vacant"). */
  tenantName: string | null;
  /** Rentable square feet per the roll. */
  rsf: number;
  /** ISO `YYYY-MM-DD`, or `null` when blank / month-to-month / unreadable. */
  expiration: string | null;
  /** True when the row reads "MTM" / "Month to Month". */
  monthToMonth: boolean;
  /** Condition or marketing note. Empty string when absent. */
  notes: string;
}

export type RentRollIssueSeverity = 'fatal' | 'warning';

/**
 * A problem found while reading the roll. `fatal` means nothing can be
 * imported (bad or missing header); `warning` means one row was fixed up or
 * dropped and the rest is usable.
 */
export interface RentRollIssue {
  severity: RentRollIssueSeverity;
  /** 1-based source line, or `null` for a whole-file problem. */
  line: number | null;
  message: string;
}

export interface RentRollParseResult {
  rows: RentRollRow[];
  issues: RentRollIssue[];
}

export interface RentRollFloorSummary {
  floor: number;
  totalRsf: number;
  leasedRsf: number;
  vacantRsf: number;
}

export interface RentRollSummary {
  /** Number of distinct floors present in the rows. */
  floors: number;
  totalRsf: number;
  leasedRsf: number;
  vacantRsf: number;
  /** leased / total × 100; 0 when total is 0. */
  occupancyPct: number;
  /** Distinct tenant names, compared case-insensitively. Vacancies excluded. */
  tenantCount: number;
  /** One entry per floor, **ascending** by floor number. */
  byFloor: RentRollFloorSummary[];
}

export interface RentRollApplyOptions {
  /**
   * Epoch ms used to derive `expiring` vs `leased`. Defaults to `Date.now()`.
   * Seeded content passes a fixed date so the document never changes shape
   * depending on when it is opened.
   */
  now?: number;
  /** Width : depth of a generated plate. Defaults to `DEFAULT_PLATE_ASPECT`. */
  plateAspect?: number;
}

export interface RentRollApplyResult {
  tenantsCreated: number;
  /** Tenants that already existed and had their status/expiry refreshed. */
  tenantsUpdated: number;
  floorsCreated: number;
  /** Suite zones generated on floors that had no drawn suites. */
  zonesCreated: number;
  /** Existing drawn suites matched by suite number and only re-tenanted. */
  zonesMatched: number;
  /** Rows that could not be placed (no matching suite on a drawn floor). */
  rowsSkipped: number;
  issues: RentRollIssue[];
}

// —— tenant palette ————————————————————————————————————————————————
/**
 * 16 mid-tone hues chosen for legibility on the dark canvas and for similar
 * luminance, so no single suite visually dominates a stacking diagram.
 * The index comes from a hash of the tenant name, so a tenant keeps the same
 * color across re-imports and across buildings.
 */
export const TENANT_PALETTE: readonly string[] = [
  '#4f9cf9',
  '#f59e0b',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#22d3ee',
  '#fb7185',
  '#a3e635',
  '#60a5fa',
  '#fbbf24',
  '#2dd4bf',
  '#c084fc',
  '#f97316',
  '#4ade80',
  '#818cf8',
  '#e879f9',
];

/** FNV-1a over the lower-cased name — small, stable, dependency-free. */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  const key = name.trim().toLowerCase();
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Stable palette color for a tenant name. */
export function tenantColorFor(name: string): string {
  const palette = TENANT_PALETTE;
  return palette[hashName(name) % palette.length] as string;
}

// —— header mapping ————————————————————————————————————————————————
type FieldKey = 'floor' | 'suite' | 'tenant' | 'rsf' | 'expiration' | 'notes';

/**
 * Header synonyms, pre-normalized (lower-cased, every non-alphanumeric
 * character stripped) so "Suite #", "suite_no" and "SUITE" all collapse to
 * `suite`, and "Sq Ft" / "sq. ft." collapse to `sqft`.
 */
const HEADER_SYNONYMS: Record<FieldKey, readonly string[]> = {
  floor: ['floor', 'floorno', 'floornumber', 'level', 'fl', 'flr', 'story'],
  suite: ['suite', 'suiteno', 'suitenumber', 'unit', 'unitno', 'space', 'spaceno', 'suitespace'],
  tenant: ['tenant', 'tenantname', 'occupant', 'name', 'lessee', 'tenantoccupant'],
  rsf: ['rsf', 'sf', 'sqft', 'squarefeet', 'squarefoot', 'area', 'size', 'rentablesf', 'rentablearea', 'totalsf'],
  expiration: [
    'expiration',
    'exp',
    'expdate',
    'expirationdate',
    'leaseexpiration',
    'leaseexp',
    'leaseexpirationdate',
    'expiry',
    'expirydate',
    'leaseend',
    'enddate',
  ],
  notes: ['notes', 'note', 'comments', 'comment', 'condition', 'remarks', 'status'],
};

function normalizeHeader(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Column index per field, or `-1` when the roll has no such column. */
type ColumnMap = Record<FieldKey, number>;

function mapHeader(cells: string[]): ColumnMap {
  const map: ColumnMap = { floor: -1, suite: -1, tenant: -1, rsf: -1, expiration: -1, notes: -1 };
  const normalized = cells.map(normalizeHeader);

  for (const key of Object.keys(HEADER_SYNONYMS) as FieldKey[]) {
    const synonyms = HEADER_SYNONYMS[key];
    for (let i = 0; i < normalized.length; i++) {
      const cell = normalized[i] as string;
      if (cell !== '' && synonyms.includes(cell) && !Object.values(map).includes(i)) {
        map[key] = i;
        break;
      }
    }
  }
  return map;
}

// —— line splitting ————————————————————————————————————————————————
/** Tab when the header has at least one tab and no more commas, else comma. */
function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  if (tabs > 0 && tabs >= commas) return '\t';
  if (commas > 0) return ',';
  // Single-column paste — pick tab so the header maps to one field and the
  // missing-column diagnostics fire with a useful message.
  return '\t';
}

/**
 * Split one delimited line. Double quotes are honored when they open a field,
 * so `"Smith, Jones & Co.",1200` survives comma-separated input; `""` inside a
 * quoted field is a literal quote.
 */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
      continue;
    }
    if (ch === delimiter) {
      out.push(cell);
      cell = '';
      continue;
    }
    cell += ch;
  }
  out.push(cell);
  return out;
}

// —— cell parsers ————————————————————————————————————————————————
/**
 * First integer in the cell: `"12"`, `"Level 12"`, `"12 (Mid-rise)"`,
 * `"FL 12 — high-rise"` all read as 12. Returns `null` when there is no digit.
 */
function parseFloorLabel(raw: string): number | null {
  const match = raw.match(/-?\d+/);
  if (!match) return null;
  const value = Number.parseInt(match[0], 10);
  return Number.isFinite(value) ? value : null;
}

/** `"12,450 SF"` / `"12450"` / `"12,450.5"` → 12450 / 12450 / 12450.5. */
function parseRsf(raw: string): number | null {
  const cleaned = raw
    .replace(/[,\s]/g, '')
    .replace(/rsf$/i, '')
    .replace(/sf$/i, '')
    .replace(/sqft$/i, '')
    .replace(/ft2$/i, '');
  if (cleaned === '') return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return value;
}

const MONTH_TO_MONTH = /^(mtm|m\/m|m-t-m|monthtomonth|monthly|monthtomonthtenancy)$/;

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = Date.UTC(year, month - 1, day);
  const check = new Date(stamp);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1) return null;
  if (check.getUTCDate() !== day) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Two-digit years: 00–69 → 2000s, 70–99 → 1900s (POSIX convention). */
function expandYear(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (raw.length <= 2) return value < 70 ? 2000 + value : 1900 + value;
  return value;
}

interface ExpirationParse {
  expiration: string | null;
  monthToMonth: boolean;
  /** False when the cell had content the parser could not read. */
  ok: boolean;
}

/**
 * Accepts ISO `YYYY-MM-DD`, `M/D/YYYY`, `MM/DD/YY`, the same with `-` or `.`
 * separators, and month-to-month spellings (→ `null` + `monthToMonth`).
 */
function parseExpiration(raw: string): ExpirationParse {
  const trimmed = raw.trim();
  if (trimmed === '' || /^(n\/a|na|none|-|—|tbd)$/i.test(trimmed)) {
    return { expiration: null, monthToMonth: false, ok: true };
  }

  const compact = trimmed.toLowerCase().replace(/[\s.]/g, '');
  if (MONTH_TO_MONTH.test(compact)) {
    return { expiration: null, monthToMonth: true, ok: true };
  }

  const iso = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const date = isoDate(
      Number.parseInt(iso[1] as string, 10),
      Number.parseInt(iso[2] as string, 10),
      Number.parseInt(iso[3] as string, 10),
    );
    return date
      ? { expiration: date, monthToMonth: false, ok: true }
      : { expiration: null, monthToMonth: false, ok: false };
  }

  const us = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (us) {
    const date = isoDate(
      expandYear(us[3] as string),
      Number.parseInt(us[1] as string, 10),
      Number.parseInt(us[2] as string, 10),
    );
    return date
      ? { expiration: date, monthToMonth: false, ok: true }
      : { expiration: null, monthToMonth: false, ok: false };
  }

  return { expiration: null, monthToMonth: false, ok: false };
}

/** Blank, or any name beginning with "vacant", is a vacancy row. */
function isVacantName(name: string): boolean {
  return name.trim() === '' || /^vacant/i.test(name.trim());
}

// —— parse ————————————————————————————————————————————————————————
/**
 * Read a pasted or uploaded rent roll.
 *
 * Tab **or** comma separated, detected from the header. Header matching is
 * case/space/punctuation-insensitive with synonyms, so real-world exports drop
 * in unchanged. A missing `floor` or `rsf` column is fatal — everything else
 * degrades to a warning.
 */
export function parseRentRoll(text: string): RentRollParseResult {
  const issues: RentRollIssue[] = [];
  const rows: RentRollRow[] = [];

  if (typeof text !== 'string' || text.trim() === '') {
    issues.push({
      severity: 'fatal',
      line: null,
      message:
        'The rent roll is empty. Paste a header row plus one row per suite, e.g. "floor, suite, tenant, rsf, expiration, notes".',
    });
    return { rows, issues };
  }

  // Keep the original numbering: `line` always points at the source text.
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);

  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] as string).trim() !== '') {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) {
    issues.push({
      severity: 'fatal',
      line: null,
      message: 'The rent roll has no header row.',
    });
    return { rows, issues };
  }

  const headerLine = lines[headerIndex] as string;
  const delimiter = detectDelimiter(headerLine);
  const headerCells = splitLine(headerLine, delimiter).map((cell) => cell.trim());
  const columns = mapHeader(headerCells);

  const missing: FieldKey[] = [];
  if (columns.floor < 0) missing.push('floor');
  if (columns.rsf < 0) missing.push('rsf');
  if (missing.length > 0) {
    const seen = headerCells.filter((cell) => cell !== '').join(', ') || '(no columns found)';
    for (const field of missing) {
      const accepted = HEADER_SYNONYMS[field].slice(0, 4).join(', ');
      issues.push({
        severity: 'fatal',
        line: headerIndex + 1,
        message:
          `No "${field}" column found in the header row. Rename one of your columns to ` +
          `${field} (also accepted: ${accepted}). Header read as: ${seen}.`,
      });
    }
    return { rows, issues };
  }

  if (columns.tenant < 0) {
    issues.push({
      severity: 'warning',
      line: headerIndex + 1,
      message:
        'No "tenant" column found — every row will import as vacant space. Add a tenant (or occupant) column to bring tenancy in.',
    });
  }

  const cellAt = (cells: string[], index: number): string =>
    index >= 0 && index < cells.length ? (cells[index] as string).trim() : '';

  let dataRows = 0;
  let capped = false;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    const lineNumber = i + 1;
    if (line.trim() === '') continue;

    if (dataRows >= MAX_RENT_ROLL_ROWS) {
      capped = true;
      break;
    }
    dataRows += 1;

    const cells = splitLine(line, delimiter);
    // Tolerate an unquoted delimiter inside the last column (usually notes) by
    // folding the extra cells back together instead of shifting the row.
    if (cells.length > headerCells.length && headerCells.length > 0) {
      const tail = cells.splice(headerCells.length - 1).join(delimiter);
      cells.push(tail);
    }
    if (cells.every((cell) => cell.trim() === '')) continue;

    const floorRaw = cellAt(cells, columns.floor);
    const floor = parseFloorLabel(floorRaw);
    if (floor === null) {
      issues.push({
        severity: 'warning',
        line: lineNumber,
        message: `Row skipped — could not read a floor number from "${floorRaw}".`,
      });
      continue;
    }
    if (floor < 1) {
      issues.push({
        severity: 'warning',
        line: lineNumber,
        message: `Row skipped — floor "${floorRaw}" is below grade. Basement and garage levels are not imported yet.`,
      });
      continue;
    }

    const rsfRaw = cellAt(cells, columns.rsf);
    const rsf = parseRsf(rsfRaw);
    if (rsf === null || rsf <= 0) {
      issues.push({
        severity: 'warning',
        line: lineNumber,
        message: `Row skipped — "${rsfRaw}" is not a usable RSF figure (a suite needs a positive area).`,
      });
      continue;
    }

    const suite = cellAt(cells, columns.suite);
    const tenantRaw = cellAt(cells, columns.tenant);
    const vacant = isVacantName(tenantRaw);

    const expirationCell = cellAt(cells, columns.expiration);
    const parsedExpiration = parseExpiration(expirationCell);
    if (!parsedExpiration.ok) {
      issues.push({
        severity: 'warning',
        line: lineNumber,
        message: `Expiration "${expirationCell}" not understood — imported with no expiry. Use YYYY-MM-DD, M/D/YYYY or MTM.`,
      });
    }

    rows.push({
      line: lineNumber,
      floor,
      suite,
      tenantName: vacant ? null : tenantRaw,
      rsf,
      expiration: parsedExpiration.expiration,
      monthToMonth: parsedExpiration.monthToMonth,
      notes: cellAt(cells, columns.notes),
    });
  }

  if (capped) {
    issues.push({
      severity: 'warning',
      line: null,
      message: `Only the first ${MAX_RENT_ROLL_ROWS.toLocaleString('en-US')} rows were read. Split the roll and import it in parts.`,
    });
  }

  if (rows.length === 0 && !issues.some((issue) => issue.severity === 'fatal')) {
    issues.push({
      severity: 'fatal',
      line: null,
      message: 'No usable rows found below the header row.',
    });
  }

  return { rows, issues };
}

// —— summarize ————————————————————————————————————————————————————
/**
 * Exact rollup of parsed rows — the number the import preview shows and the
 * number a reconciliation against the landlord's own sheet is checked against.
 * No rounding is applied anywhere.
 */
export function summarizeRentRoll(rows: readonly RentRollRow[]): RentRollSummary {
  const perFloor = new Map<number, RentRollFloorSummary>();
  const tenantKeys = new Set<string>();

  let totalRsf = 0;
  let leasedRsf = 0;
  let vacantRsf = 0;

  for (const row of rows) {
    let entry = perFloor.get(row.floor);
    if (!entry) {
      entry = { floor: row.floor, totalRsf: 0, leasedRsf: 0, vacantRsf: 0 };
      perFloor.set(row.floor, entry);
    }
    entry.totalRsf += row.rsf;
    totalRsf += row.rsf;

    if (row.tenantName === null) {
      entry.vacantRsf += row.rsf;
      vacantRsf += row.rsf;
    } else {
      entry.leasedRsf += row.rsf;
      leasedRsf += row.rsf;
      tenantKeys.add(row.tenantName.trim().toLowerCase());
    }
  }

  const byFloor = [...perFloor.values()].sort((a, b) => a.floor - b.floor);

  return {
    floors: byFloor.length,
    totalRsf,
    leasedRsf,
    vacantRsf,
    occupancyPct: totalRsf > 0 ? (leasedRsf / totalRsf) * 100 : 0,
    tenantCount: tenantKeys.size,
    byFloor,
  };
}

// —— apply ————————————————————————————————————————————————————————
/** Rent-roll floor number → document floor index. Floor 1 is index 0. */
export const floorNumberToIndex = (floor: number): number => floor - 1;
/** Document floor index → rent-roll floor number. */
export const floorIndexToNumber = (index: number): number => index + 1;

/** `Level 1` is the lobby; every other level is named after its number. */
function floorLabelFor(floorNumber: number): string {
  return floorNumber === 1 ? 'Lobby' : `Level ${floorNumber}`;
}

/**
 * Deterministic suite order: biggest suite first, ties broken by suite number
 * (numerically when both are numeric) then by source line. Strip layout and
 * zone order therefore never change between two imports of the same roll.
 */
function compareRows(a: RentRollRow, b: RentRollRow): number {
  if (b.rsf !== a.rsf) return b.rsf - a.rsf;
  const an = Number.parseFloat(a.suite);
  const bn = Number.parseFloat(b.suite);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  if (a.suite !== b.suite) return a.suite < b.suite ? -1 : 1;
  return a.line - b.line;
}

/** Axis-aligned bounds of every slab outline on a floor. */
function plateBounds(floor: Floor): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const slab of floor.slabs) {
    for (const point of slab.outline) {
      if (point.x < x0) x0 = point.x;
      if (point.y < y0) y0 = point.y;
      if (point.x > x1) x1 = point.x;
      if (point.y > y1) y1 = point.y;
    }
  }
  if (!Number.isFinite(x0) || x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * A rectangle centered on the origin whose **area equals** `rsf` converted to
 * m², proportioned `aspect` wide to deep. Used when a floor has no plate yet,
 * so the model reconciles against the rent roll by construction.
 */
export function plateOutlineForRsf(rsf: number, aspect = DEFAULT_PLATE_ASPECT): Polygon {
  const area = Math.max(rsfToSqm(rsf), 1);
  const ratio = aspect > 0 ? aspect : DEFAULT_PLATE_ASPECT;
  const width = Math.sqrt(area * ratio);
  const depth = area / width;
  return rect(-width / 2, -depth / 2, width, depth);
}

/** Suite number carried by a zone, from its suite facts or its name. */
function zoneMatchesSuite(zone: Zone, suite: string): boolean {
  if (suite === '') return false;
  const target = suite.trim().toLowerCase();
  const number = zone.suite?.number?.trim().toLowerCase();
  if (number !== undefined && number !== '' && number === target) return true;
  // "Suite 2450", "2450 — Acme" etc.
  return zone.name.toLowerCase().includes(target);
}

interface TenantAggregate {
  name: string;
  /** Soonest expiration across every suite the tenant occupies. */
  earliestExpiration: string | null;
  monthToMonth: boolean;
}

function deriveStatus(aggregate: TenantAggregate, now: number): TenantStatus {
  if (aggregate.monthToMonth) return 'expiring';
  if (aggregate.earliestExpiration === null) return 'leased';
  const stamp = Date.parse(`${aggregate.earliestExpiration}T00:00:00.000Z`);
  if (Number.isNaN(stamp)) return 'leased';
  return stamp - now <= TWELVE_MONTHS_MS ? 'expiring' : 'leased';
}

/**
 * Apply parsed rows to a project **draft**, in place. Designed to be called
 * inside `updateProject('Import rent roll', draft => …)` so the whole import is
 * one undo entry.
 *
 * What it does, in order:
 *
 *  1. **Tenants.** One `Tenant` per distinct name (deduped case-insensitively,
 *     original casing kept). Color comes from a hash of the name so it is
 *     stable across imports; an existing tenant keeps whatever color it has, so
 *     a manual recolor survives a re-import. Status is derived: month-to-month
 *     and anything expiring inside 12 months of `now` → `expiring`, otherwise
 *     `leased`. Vacancy rows create no tenant at all.
 *  2. **Floors.** Rent-roll floor N maps to floor index N−1. Missing floors are
 *     created (named "Lobby" / "Level N") and elevations recomputed. Floors
 *     that already exist are never recreated, and a roll that skips a floor
 *     number (superstitious buildings skip 13) simply leaves a gap in the
 *     index sequence.
 *  3. **Geometry.** A floor that already has drawn `tenant-suite` zones is
 *     *matched*: zones are found by suite number and only get `tenantId` and
 *     suite facts — authored geometry is never touched. A floor with no suites
 *     gets schematic strips: the plate is split along its long axis into one
 *     strip per row, each strip's width proportional to its RSF share, so the
 *     floor's suite areas sum exactly to the plate.
 */
export function applyRentRollToProject(
  draft: ProjectDoc,
  rows: readonly RentRollRow[],
  opts?: RentRollApplyOptions,
): RentRollApplyResult {
  const now = opts?.now ?? Date.now();
  const aspect = opts?.plateAspect ?? DEFAULT_PLATE_ASPECT;
  const issues: RentRollIssue[] = [];

  const result: RentRollApplyResult = {
    tenantsCreated: 0,
    tenantsUpdated: 0,
    floorsCreated: 0,
    zonesCreated: 0,
    zonesMatched: 0,
    rowsSkipped: 0,
    issues,
  };

  if (rows.length === 0) return result;

  // —— 1. tenants ——————————————————————————————————————————————
  const aggregates = new Map<string, TenantAggregate>();
  for (const row of rows) {
    if (row.tenantName === null) continue;
    const key = row.tenantName.trim().toLowerCase();
    let aggregate = aggregates.get(key);
    if (!aggregate) {
      aggregate = {
        name: row.tenantName.trim(),
        earliestExpiration: null,
        monthToMonth: false,
      };
      aggregates.set(key, aggregate);
    }
    if (row.monthToMonth) aggregate.monthToMonth = true;
    if (
      row.expiration !== null &&
      (aggregate.earliestExpiration === null || row.expiration < aggregate.earliestExpiration)
    ) {
      aggregate.earliestExpiration = row.expiration;
    }
  }

  const existingByName = new Map<string, TenantId>();
  for (const [id, tenant] of Object.entries(draft.tenants) as [TenantId, Tenant][]) {
    existingByName.set(tenant.name.trim().toLowerCase(), id);
  }

  const tenantIdByKey = new Map<string, TenantId>();
  for (const [key, aggregate] of aggregates) {
    const status = deriveStatus(aggregate, now);
    const existingId = existingByName.get(key);

    if (existingId && draft.tenants[existingId]) {
      const tenant = draft.tenants[existingId] as Tenant;
      tenant.status = status;
      if (aggregate.monthToMonth || aggregate.earliestExpiration === null) {
        delete tenant.leaseExpiry;
      } else {
        tenant.leaseExpiry = aggregate.earliestExpiration;
      }
      tenantIdByKey.set(key, existingId);
      result.tenantsUpdated += 1;
      continue;
    }

    const tenant = createTenant(
      aggregate.name,
      tenantColorFor(aggregate.name),
      status,
      aggregate.monthToMonth || aggregate.earliestExpiration === null
        ? undefined
        : { leaseExpiry: aggregate.earliestExpiration },
    );
    draft.tenants[tenant.id] = tenant;
    existingByName.set(key, tenant.id);
    tenantIdByKey.set(key, tenant.id);
    result.tenantsCreated += 1;
  }

  const tenantIdFor = (name: string | null): TenantId | null =>
    name === null ? null : (tenantIdByKey.get(name.trim().toLowerCase()) ?? null);

  // —— 2. floors ————————————————————————————————————————————————
  const rowsByFloor = new Map<number, RentRollRow[]>();
  for (const row of rows) {
    const bucket = rowsByFloor.get(row.floor);
    if (bucket) bucket.push(row);
    else rowsByFloor.set(row.floor, [row]);
  }
  const floorNumbers = [...rowsByFloor.keys()].sort((a, b) => a - b);

  let createdAnyFloor = false;
  for (const floorNumber of floorNumbers) {
    const index = floorNumberToIndex(floorNumber);
    if (draft.building.floors.some((floor) => floor.index === index)) continue;
    const floor = createFloor(index, 0, defaultFloorHeight(index), {
      name: floorLabelFor(floorNumber),
    });
    // Keep `building.floors` sorted ascending by index (model invariant).
    const insertAt = draft.building.floors.findIndex((candidate) => candidate.index > index);
    if (insertAt < 0) draft.building.floors.push(floor);
    else draft.building.floors.splice(insertAt, 0, floor);
    result.floorsCreated += 1;
    createdAnyFloor = true;
  }
  if (createdAnyFloor) recomputeElevations(draft.building.floors);

  // —— 3. geometry ——————————————————————————————————————————————
  for (const floorNumber of floorNumbers) {
    const index = floorNumberToIndex(floorNumber);
    const floor = draft.building.floors.find((candidate) => candidate.index === index);
    const floorRows = (rowsByFloor.get(floorNumber) as RentRollRow[]).slice().sort(compareRows);
    if (!floor) {
      for (const row of floorRows) {
        result.rowsSkipped += 1;
        issues.push({
          severity: 'warning',
          line: row.line,
          message: `Row skipped — floor ${floorNumber} could not be created in this building.`,
        });
      }
      continue;
    }

    const drawnSuites = floor.zones.filter((zone) => zone.kind === 'tenant-suite');

    // —— match mode: the floor is already demised, only re-tenant it ——
    if (drawnSuites.length > 0) {
      const claimed = new Set<string>();
      for (const row of floorRows) {
        const zone = drawnSuites.find(
          (candidate) => !claimed.has(candidate.id) && zoneMatchesSuite(candidate, row.suite),
        );
        if (!zone) {
          result.rowsSkipped += 1;
          issues.push({
            severity: 'warning',
            line: row.line,
            message:
              `No drawn suite on ${floor.name} matches suite "${row.suite || '(blank)'}" — ` +
              `tenancy not applied. Rename the zone to include the suite number, or clear the floor's suites to regenerate them.`,
          });
          continue;
        }
        claimed.add(zone.id);
        zone.tenantId = tenantIdFor(row.tenantName);
        zone.suite = mergeSuiteFacts(zone.suite, row);
        result.zonesMatched += 1;
      }
      continue;
    }

    // —— strip mode: generate a schematic demising layout ——
    const floorTotalRsf = floorRows.reduce((sum, row) => sum + row.rsf, 0);
    if (floorTotalRsf <= 0) continue;

    if (floor.slabs.length === 0) {
      floor.slabs.push(createSlab(plateOutlineForRsf(floorTotalRsf, aspect)));
    }
    const bounds = plateBounds(floor);
    if (!bounds) {
      // A slab exists but is degenerate — replace it rather than emit zero-area
      // suites, which would poison the area report.
      floor.slabs = [createSlab(plateOutlineForRsf(floorTotalRsf, aspect))];
    }
    const plate = plateBounds(floor) as { x0: number; y0: number; x1: number; y1: number };

    const width = plate.x1 - plate.x0;
    const depth = plate.y1 - plate.y0;
    const alongX = width >= depth;
    const span = alongX ? width : depth;

    let cumulative = 0;
    floorRows.forEach((row, i) => {
      const start = (cumulative / floorTotalRsf) * span;
      cumulative += row.rsf;
      // Snap the last strip to the plate edge so rounding never leaves a sliver.
      const end = i === floorRows.length - 1 ? span : (cumulative / floorTotalRsf) * span;

      const outline: Polygon = alongX
        ? rect(plate.x0 + start, plate.y0, end - start, depth)
        : rect(plate.x0, plate.y0 + start, width, end - start);

      const name = row.suite !== '' ? `Suite ${row.suite}` : (row.tenantName ?? 'Vacant');
      const zone = createZone(name, 'tenant-suite', outline, tenantIdFor(row.tenantName));
      zone.suite = mergeSuiteFacts(undefined, row);
      floor.zones.push(zone);
      result.zonesCreated += 1;
    });
  }

  return result;
}

/**
 * Rent-roll facts merged onto a zone. Existing asking rents / availability are
 * preserved — the roll only speaks to suite number, RSF and condition notes.
 * Keys are omitted rather than set to `undefined` so the JSON stays clean.
 */
function mergeSuiteFacts(existing: SuiteFacts | undefined, row: RentRollRow): SuiteFacts {
  const facts: SuiteFacts = { ...(existing ?? {}) };
  if (row.suite !== '') facts.number = row.suite;
  facts.rsf = row.rsf;
  if (row.notes !== '') facts.notes = row.notes;
  else if (existing?.notes === undefined) delete facts.notes;
  return facts;
}
