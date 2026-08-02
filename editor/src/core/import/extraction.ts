/**
 * Plan-import extraction contract (M1.5 — ARCHITECTURE §8).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * This module is the **single shared contract** between the three halves of
 * plan import:
 *
 *  1. the API route (`app/api/extract-plan/route.ts`) which asks Claude for a
 *     structured reading of a floor-plan image and validates the reply here;
 *  2. the import dialog UI, which calibrates scale and previews the result;
 *  3. `applyExtractionToFloor`, which turns the reading into real document
 *     entities inside one `updateProject` command (= one undo step).
 *
 * Pure TypeScript — no React, no three.js — so it stays importable from Node
 * (route handlers, tests, future server-side batch import).
 *
 * ## The extraction frame (`EXTRACTION_FRAME`)
 * Every coordinate the model returns is in a **normalized image frame** that is
 * independent of the source image's pixel dimensions:
 *
 *  - the image's **long edge spans `0 … 1000`**;
 *  - the short edge spans `0 … 1000 · (short / long)` — i.e. proportionally,
 *    so the frame is never distorted (a square drawn on the plan stays square);
 *  - the origin `(0, 0)` is the **top-left** of the image and `y` increases
 *    **downward**, matching how the model reads pixels.
 *
 * A landscape 2400×1600 scan therefore maps to a frame of 1000 × 666.7, and a
 * portrait 1600×2400 scan to 666.7 × 1000. Normalizing on the long edge (rather
 * than sending pixel coordinates) keeps the numeric range constant across
 * wildly different scan resolutions, which is what makes a single set of
 * validation clamps and a single prompt work for every input.
 *
 * ## Frame → plan mapping (no vertical flip)
 * `core/geometry/slab.ts` documents the plan → world mapping as
 * `Vec2 { x, y } → (x, ·, y)` — plan `y` becomes world `z`, "with **no
 * mirroring**". Image/frame `y` also increases downward, which is the same
 * direction a plan reader expects "down the page" to run. So frame `y` maps to
 * plan `y` **directly, with no flip**: a room drawn at the top of the scan lands
 * at negative plan `y` (north/back of the plate) once centered, and one at the
 * bottom lands at positive plan `y`. The underlay plane in
 * `scene/meshes/UnderlayMesh.tsx` uses the same handedness, so extracted
 * geometry and the source image sit on top of each other with no correction.
 */

import {
  createColumn,
  createCore,
  createOpening,
  createSlab,
  createWall,
  createZone,
  rect,
} from '../model/factories';
import { centroid, ensureCCW } from '../geometry/polygon';
import type {
  CoreKind,
  FloorId,
  OpeningKind,
  Polygon,
  ProjectDoc,
  Vec2,
  Wall,
  WallKind,
  ZoneKind,
} from '../model/types';

// —— frame ————————————————————————————————————————————————————————
/** Extent of the image's LONG edge in extraction coordinates. See the module doc. */
export const EXTRACTION_FRAME = 1000;

/** A point in the normalized extraction frame (0…1000 on the long edge). */
export interface FramePoint {
  x: number;
  y: number;
}

// —— classification vocabularies ————————————————————————————————
// Typed against the document model so the two can never drift: a kind that is
// not a real `WallKind`/`ZoneKind`/`CoreKind`/`OpeningKind` fails to compile.
const WALL_KINDS: readonly WallKind[] = [
  'exterior',
  'interior',
  'partition',
  'glass',
  'demising',
];
const ZONE_KINDS: readonly ZoneKind[] = [
  'tenant-suite',
  'common',
  'core',
  'amenity',
  'circulation',
  'service',
];
const CORE_KINDS: readonly CoreKind[] = [
  'elevator-bank',
  'stair',
  'restroom',
  'mechanical',
  'electrical',
  'telecom',
  'shaft',
];

export type ExtractedWallKind = (typeof WALL_KINDS)[number];
export type ExtractedZoneKind = (typeof ZONE_KINDS)[number];
export type ExtractedCoreKind = (typeof CORE_KINDS)[number];
/** Only the opening kinds a plan reader can identify from a 2D drawing. */
export type ExtractedOpeningKind = Extract<
  OpeningKind,
  'door' | 'double-door' | 'glass-door' | 'window'
>;

const OPENING_KINDS: readonly ExtractedOpeningKind[] = [
  'door',
  'double-door',
  'glass-door',
  'window',
];

// —— extraction payload ————————————————————————————————————————
export interface ExtractedScale {
  /**
   * Plan meters per extraction-frame unit, or `null` when the drawing carries
   * no usable scale evidence. Multiply a frame delta by this to get meters.
   */
  metersPerFrameUnit: number | null;
  /** How the estimate was derived ("20 ft scale bar", "typical door ≈ 0.9 m"…). */
  basis: string;
}

export interface ExtractedWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: ExtractedWallKind;
}

export interface ExtractedZone {
  name: string;
  kind: ExtractedZoneKind;
  outline: FramePoint[];
  /** Rentable square feet printed on the drawing, when present. */
  labeledAreaSqft: number | null;
}

export interface ExtractedCore {
  kind: ExtractedCoreKind;
  outline: FramePoint[];
  /** Printed label ("STAIR A", "WOMEN'S"), or null. */
  label: string | null;
}

export interface ExtractedOpening {
  /** Index into `ExtractedPlan.walls`. */
  wallIndex: number;
  /** Position of the opening centre along the wall, 0 = start … 1 = end. */
  positionRatio: number;
  kind: ExtractedOpeningKind;
  /** Width in meters when the drawing states it, else null (defaults apply). */
  widthMeters: number | null;
}

export interface ExtractedColumn {
  x: number;
  y: number;
}

/** One AI reading of one floor-plan image. All coordinates in the extraction frame. */
export interface ExtractedPlan {
  scale: ExtractedScale;
  /** Building perimeter polygon, or null when it could not be traced. */
  footprint: FramePoint[] | null;
  walls: ExtractedWall[];
  zones: ExtractedZone[];
  cores: ExtractedCore[];
  openings: ExtractedOpening[];
  columns: ExtractedColumn[];
  /** Short free-text caveats ("space not demised", "scale bar illegible"). */
  notes: string;
}

// —— defensive limits ——————————————————————————————————————————
/**
 * Hard caps applied by {@link parseExtractedPlan}. A pathological reply (a
 * hatch pattern read as 4,000 wall segments) must not be able to lock up the
 * renderer, so surplus entries are dropped rather than trusted.
 */
export const EXTRACTION_LIMITS = {
  walls: 400,
  zones: 80,
  cores: 40,
  openings: 300,
  columns: 120,
  /** Max vertices kept per zone/core/footprint ring. */
  polygonPoints: 200,
  /** Max characters kept from `notes`. */
  notes: 2000,
  /** Max characters kept from a zone name / core label. */
  label: 120,
} as const;

/** Wall segments shorter than this (meters, after transform) are discarded. */
export const MIN_WALL_LENGTH_M = 0.3;
/** Slab thickness for an imported plate, meters. */
export const IMPORT_SLAB_THICKNESS = 0.3;
/** Imported columns are square blocks of this size, meters. */
export const IMPORT_COLUMN_SIZE = 0.5;

/** Opening dimensions used when the drawing does not state a width. */
export const IMPORT_OPENING_DEFAULTS: Record<
  ExtractedOpeningKind,
  { width: number; height: number; sillHeight: number }
> = {
  door: { width: 0.9, height: 2.1, sillHeight: 0 },
  'double-door': { width: 1.8, height: 2.1, sillHeight: 0 },
  'glass-door': { width: 1.0, height: 2.1, sillHeight: 0 },
  window: { width: 1.8, height: 1.5, sillHeight: 0.9 },
};

// —— JSON Schema (structured outputs) ————————————————————————————
/*
 * Structured-outputs rules encoded below (see the Claude structured-outputs
 * docs): every object level carries `additionalProperties: false` and a
 * `required` array listing *every* property; nullability is expressed as
 * `"type": ["number", "null"]`; there are **no** `minimum`/`maximum`/
 * `minLength`/`minItems` constraints anywhere, because numeric and length
 * constraints are not supported — all bounding happens in
 * {@link parseExtractedPlan} instead.
 */

function pointSchema(description: string): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y'],
    description,
    properties: {
      x: { type: 'number', description: 'Frame X, 0 at the left image edge.' },
      y: { type: 'number', description: 'Frame Y, 0 at the top image edge, increasing downward.' },
    },
  };
}

/** The JSON Schema handed to `output_config.format` on the extraction call. */
export const EXTRACTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['scale', 'footprint', 'walls', 'zones', 'cores', 'openings', 'columns', 'notes'],
  properties: {
    scale: {
      type: 'object',
      additionalProperties: false,
      required: ['metersPerFrameUnit', 'basis'],
      description: 'Drawing scale estimate, expressed in the 0-1000 extraction frame.',
      properties: {
        metersPerFrameUnit: {
          type: ['number', 'null'],
          description:
            'Plan meters per frame unit. The image long edge is 1000 frame units, so a plan whose long edge covers 60 m gives 0.06. Null when no scale evidence is visible.',
        },
        basis: {
          type: 'string',
          description:
            'How the estimate was derived, e.g. "20 ft graphic scale bar", "printed 32\'-0\\" corridor dimension", "typical door leaf assumed 0.9 m". Empty string when metersPerFrameUnit is null.',
        },
      },
    },
    footprint: {
      type: ['array', 'null'],
      description:
        'Building perimeter as a closed polygon (do not repeat the first point). Null when the perimeter is not fully visible.',
      items: pointSchema('Perimeter vertex.'),
    },
    walls: {
      type: 'array',
      description: 'Wall centerline segments. Order matters: openings reference these by index.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x1', 'y1', 'x2', 'y2', 'kind'],
        properties: {
          x1: { type: 'number', description: 'Segment start, frame X.' },
          y1: { type: 'number', description: 'Segment start, frame Y.' },
          x2: { type: 'number', description: 'Segment end, frame X.' },
          y2: { type: 'number', description: 'Segment end, frame Y.' },
          kind: {
            type: 'string',
            enum: [...WALL_KINDS],
            description:
              'exterior = building perimeter/envelope; glass = interior glazed partition or storefront; demising = wall between two tenants or between tenant and common area; partition = light non-structural divider; interior = anything else.',
          },
        },
      },
    },
    zones: {
      type: 'array',
      description: 'Enclosed areas that carry a printed label or an obvious commercial function.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'outline', 'labeledAreaSqft'],
        properties: {
          name: {
            type: 'string',
            description:
              'The printed label verbatim where there is one ("SUITE 210", "LOBBY", "BREAK ROOM"); otherwise a short descriptive name.',
          },
          kind: {
            type: 'string',
            enum: [...ZONE_KINDS],
            description:
              'tenant-suite = leasable suite/office area; common = lobby, corridor-adjacent shared area; core = elevator/stair/restroom core area; amenity = conference centre, fitness, cafe; circulation = corridor, vestibule; service = janitor, storage, loading, mail.',
          },
          outline: {
            type: 'array',
            description: 'Closed boundary polygon (do not repeat the first point).',
            items: pointSchema('Zone boundary vertex.'),
          },
          labeledAreaSqft: {
            type: ['number', 'null'],
            description:
              'Rentable/usable square footage printed inside or beside the space (e.g. "4,512 RSF" -> 4512). Null when no figure is printed. Never estimate it.',
          },
        },
      },
    },
    cores: {
      type: 'array',
      description: 'Building-core elements: stairs, elevators, restrooms, and service shafts.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'outline', 'label'],
        properties: {
          kind: {
            type: 'string',
            enum: [...CORE_KINDS],
            description:
              'elevator-bank, stair, restroom, mechanical, electrical, telecom (IDF/MDF/data), or shaft (trash, plumbing, unlabeled vertical chase).',
          },
          outline: {
            type: 'array',
            description: 'Closed boundary polygon (do not repeat the first point).',
            items: pointSchema('Core boundary vertex.'),
          },
          label: {
            type: ['string', 'null'],
            description: 'Printed label verbatim ("STAIR A", "WOMEN\'S", "ELEC."), else null.',
          },
        },
      },
    },
    openings: {
      type: 'array',
      description: 'Doors and windows, each attached to the wall segment it sits in.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['wallIndex', 'positionRatio', 'kind', 'widthMeters'],
        properties: {
          wallIndex: {
            type: 'integer',
            description: 'Zero-based index into the walls array above.',
          },
          positionRatio: {
            type: 'number',
            description:
              'Where the opening centre sits along that wall: 0 at (x1,y1), 1 at (x2,y2), 0.5 at the midpoint.',
          },
          kind: {
            type: 'string',
            enum: [...OPENING_KINDS],
            description:
              'door = single leaf; double-door = pair of leaves; glass-door = glazed entry; window = opening in an exterior or glazed wall.',
          },
          widthMeters: {
            type: ['number', 'null'],
            description:
              'Clear width in meters when the drawing dimensions it or the scale makes it measurable; null to accept the default for the kind.',
          },
        },
      },
    },
    columns: {
      type: 'array',
      description: 'Structural columns — small filled/hatched squares, usually on a regular grid.',
      items: pointSchema('Column centre.'),
    },
    notes: {
      type: 'string',
      description:
        'One to three short sentences on anything ambiguous: illegible scale, space not demised, partial plan, overlapping labels. Empty string when the reading is unambiguous.',
    },
  },
};

// —— parsing / clamping ————————————————————————————————————————
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Clamp a frame coordinate into 0…EXTRACTION_FRAME. */
function clampFrame(value: number): number {
  return clamp(value, 0, EXTRACTION_FRAME);
}

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // Collapse whitespace so labels read cleanly in the hierarchy panel.
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function parsePoint(value: unknown): FramePoint | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value['x']);
  const y = finiteNumber(value['y']);
  if (x === null || y === null) return null;
  return { x: clampFrame(x), y: clampFrame(y) };
}

/** Parse a ring, dropping malformed vertices. Returns null when < 3 survive. */
function parseRing(value: unknown): FramePoint[] | null {
  if (!Array.isArray(value)) return null;
  const points: FramePoint[] = [];
  for (const raw of value.slice(0, EXTRACTION_LIMITS.polygonPoints)) {
    const point = parsePoint(raw);
    if (point) points.push(point);
  }
  return points.length >= 3 ? points : null;
}

/**
 * Validate, clamp and cap a raw model reply.
 *
 * Deliberately lenient about *content* and strict about *shape*: entries whose
 * geometry cannot be salvaged are dropped, coordinates are clamped into the
 * frame, and an unrecognised `kind` falls back to the most neutral member of
 * its vocabulary rather than discarding otherwise-good geometry (the JSON
 * schema already constrains these, so a fallback only fires on a malformed
 * hand-written payload).
 *
 * Because malformed walls are dropped, `openings[].wallIndex` is **remapped**
 * onto the surviving walls; openings pointing at a dropped or out-of-range wall
 * are discarded.
 *
 * @throws Error when the payload is not a JSON object at all.
 */
export function parseExtractedPlan(json: unknown): ExtractedPlan {
  if (!isRecord(json)) {
    throw new Error('parseExtractedPlan: extraction payload must be a JSON object');
  }

  // —— scale ——
  const rawScale = isRecord(json['scale']) ? json['scale'] : {};
  const rawMpu = finiteNumber(rawScale['metersPerFrameUnit']);
  const scale: ExtractedScale = {
    metersPerFrameUnit: rawMpu !== null && rawMpu > 0 ? rawMpu : null,
    basis: cleanString(rawScale['basis'], EXTRACTION_LIMITS.label * 4),
  };

  // —— footprint ——
  const footprint = parseRing(json['footprint']);

  // —— walls (index map feeds the openings pass) ——
  const walls: ExtractedWall[] = [];
  const wallIndexMap = new Map<number, number>();
  if (Array.isArray(json['walls'])) {
    const source = json['walls'];
    for (let i = 0; i < source.length && walls.length < EXTRACTION_LIMITS.walls; i++) {
      const raw = source[i];
      if (!isRecord(raw)) continue;
      const x1 = finiteNumber(raw['x1']);
      const y1 = finiteNumber(raw['y1']);
      const x2 = finiteNumber(raw['x2']);
      const y2 = finiteNumber(raw['y2']);
      if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
      const wall: ExtractedWall = {
        x1: clampFrame(x1),
        y1: clampFrame(y1),
        x2: clampFrame(x2),
        y2: clampFrame(y2),
        kind: oneOf(raw['kind'], WALL_KINDS, 'interior'),
      };
      // Degenerate in frame space — cannot become a wall at any scale.
      if (wall.x1 === wall.x2 && wall.y1 === wall.y2) continue;
      wallIndexMap.set(i, walls.length);
      walls.push(wall);
    }
  }

  // —— zones ——
  const zones: ExtractedZone[] = [];
  if (Array.isArray(json['zones'])) {
    for (const raw of json['zones']) {
      if (zones.length >= EXTRACTION_LIMITS.zones) break;
      if (!isRecord(raw)) continue;
      const outline = parseRing(raw['outline']);
      if (!outline) continue;
      const kind = oneOf(raw['kind'], ZONE_KINDS, 'tenant-suite');
      const area = finiteNumber(raw['labeledAreaSqft']);
      zones.push({
        name: cleanString(raw['name'], EXTRACTION_LIMITS.label) || defaultZoneName(kind),
        kind,
        outline,
        labeledAreaSqft: area !== null && area > 0 ? area : null,
      });
    }
  }

  // —— cores ——
  const cores: ExtractedCore[] = [];
  if (Array.isArray(json['cores'])) {
    for (const raw of json['cores']) {
      if (cores.length >= EXTRACTION_LIMITS.cores) break;
      if (!isRecord(raw)) continue;
      const outline = parseRing(raw['outline']);
      if (!outline) continue;
      const label = cleanString(raw['label'], EXTRACTION_LIMITS.label);
      cores.push({
        kind: oneOf(raw['kind'], CORE_KINDS, 'shaft'),
        outline,
        label: label === '' ? null : label,
      });
    }
  }

  // —— openings (remapped onto the surviving walls) ——
  const openings: ExtractedOpening[] = [];
  if (Array.isArray(json['openings'])) {
    for (const raw of json['openings']) {
      if (openings.length >= EXTRACTION_LIMITS.openings) break;
      if (!isRecord(raw)) continue;
      const sourceIndex = finiteNumber(raw['wallIndex']);
      if (sourceIndex === null) continue;
      const mapped = wallIndexMap.get(Math.trunc(sourceIndex));
      if (mapped === undefined) continue;
      const ratio = finiteNumber(raw['positionRatio']);
      const width = finiteNumber(raw['widthMeters']);
      openings.push({
        wallIndex: mapped,
        positionRatio: ratio === null ? 0.5 : clamp(ratio, 0, 1),
        kind: oneOf(raw['kind'], OPENING_KINDS, 'door'),
        widthMeters: width !== null && width > 0 ? width : null,
      });
    }
  }

  // —— columns ——
  const columns: ExtractedColumn[] = [];
  if (Array.isArray(json['columns'])) {
    for (const raw of json['columns']) {
      if (columns.length >= EXTRACTION_LIMITS.columns) break;
      const point = parsePoint(raw);
      if (point) columns.push({ x: point.x, y: point.y });
    }
  }

  return {
    scale,
    footprint,
    walls,
    zones,
    cores,
    openings,
    columns,
    notes: cleanString(json['notes'], EXTRACTION_LIMITS.notes),
  };
}

function defaultZoneName(kind: ExtractedZoneKind): string {
  switch (kind) {
    case 'tenant-suite':
      return 'Suite';
    case 'common':
      return 'Common Area';
    case 'core':
      return 'Core';
    case 'amenity':
      return 'Amenity';
    case 'circulation':
      return 'Circulation';
    default:
      return 'Service';
  }
}

// —— frame ↔ plan geometry ————————————————————————————————————
/** Every frame point the plan mentions, in one flat list. */
function allFramePoints(plan: ExtractedPlan): FramePoint[] {
  const points: FramePoint[] = [];
  if (plan.footprint) points.push(...plan.footprint);
  for (const wall of plan.walls) {
    points.push({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
  }
  for (const zone of plan.zones) points.push(...zone.outline);
  for (const core of plan.cores) points.push(...core.outline);
  for (const column of plan.columns) points.push({ x: column.x, y: column.y });
  return points;
}

/**
 * The frame point that becomes the plan origin: the footprint centroid when a
 * perimeter was traced, else the bounding-box centre of everything extracted.
 * Anchoring on the centroid lands the imported plate near the world origin so
 * the existing camera framing shows it without a hunt.
 */
export function extractionFrameCenter(plan: ExtractedPlan): FramePoint {
  if (plan.footprint && plan.footprint.length >= 3) {
    const c = centroid(plan.footprint);
    return { x: c.x, y: c.y };
  }

  const points = allFramePoints(plan);
  if (points.length === 0) return { x: EXTRACTION_FRAME / 2, y: EXTRACTION_FRAME / 2 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Frame units per image pixel: the long edge is always `EXTRACTION_FRAME`. */
export function frameUnitsPerPixel(imageWidth: number, imageHeight: number): number {
  const longEdge = Math.max(imageWidth, imageHeight);
  return longEdge > 0 ? EXTRACTION_FRAME / longEdge : 0;
}

/** Convert the AI's frame-unit scale estimate into `FloorUnderlay.metersPerPixel`. */
export function metersPerPixelFromFrameUnits(
  metersPerFrameUnit: number,
  imageWidth: number,
  imageHeight: number,
): number {
  const perPixel = frameUnitsPerPixel(imageWidth, imageHeight);
  return metersPerFrameUnit * perPixel;
}

/** Convert a two-point pixel calibration into the frame-unit scale used here. */
export function frameUnitsScaleFromMetersPerPixel(
  metersPerPixel: number,
  imageWidth: number,
  imageHeight: number,
): number {
  const perPixel = frameUnitsPerPixel(imageWidth, imageHeight);
  return perPixel > 0 ? metersPerPixel / perPixel : 0;
}

/**
 * Where the underlay image's **centre** must sit so the image lines up with the
 * geometry `applyExtractionToFloor` produced from the same plan and scale.
 * Feed the result straight into `FloorUnderlay.offset`.
 */
export function underlayOffsetForPlan(
  plan: ExtractedPlan,
  metersPerFrameUnit: number,
  imageWidth: number,
  imageHeight: number,
): Vec2 {
  const perPixel = frameUnitsPerPixel(imageWidth, imageHeight);
  const center = extractionFrameCenter(plan);
  const imageCenterFrame: FramePoint = {
    x: (imageWidth * perPixel) / 2,
    y: (imageHeight * perPixel) / 2,
  };
  return {
    x: (imageCenterFrame.x - center.x) * metersPerFrameUnit,
    y: (imageCenterFrame.y - center.y) * metersPerFrameUnit,
  };
}

// —— apply ————————————————————————————————————————————————————
/** What {@link applyExtractionToFloor} created, for the import summary. */
export interface ExtractionApplyCounts {
  walls: number;
  zones: number;
  cores: number;
  openings: number;
  columns: number;
  slabs: number;
}

/** The calibration the dialog settled on (may differ from the AI estimate). */
export interface ExtractionCalibration {
  /** Plan meters per extraction-frame unit; must be finite and > 0. */
  metersPerFrameUnit: number;
}

const NO_COUNTS: ExtractionApplyCounts = {
  walls: 0,
  zones: 0,
  cores: 0,
  openings: 0,
  columns: 0,
  slabs: 0,
};

function boundsOf(points: FramePoint[]): { min: FramePoint; max: FramePoint } | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/**
 * Turn a validated extraction into document entities on one floor.
 *
 * Pure mutation of an immer draft — designed to run inside
 * `updateProject('Import plan', draft => applyExtractionToFloor(draft, …))`,
 * which makes the whole import exactly one undo entry (ARCHITECTURE §8.4).
 * Deterministic apart from the fresh ids `create*` mints, so it is directly
 * unit-testable.
 *
 * Existing content on the floor is **kept**; imported entities are appended.
 *
 * @returns per-kind counts of what was created (all zero for an unknown floor
 *          or a non-positive scale).
 */
export function applyExtractionToFloor(
  draft: ProjectDoc,
  floorId: FloorId,
  plan: ExtractedPlan,
  calib: ExtractionCalibration,
): ExtractionApplyCounts {
  const floor = draft.building.floors.find((candidate) => candidate.id === floorId);
  if (!floor) return { ...NO_COUNTS };

  const metersPerFrameUnit = calib.metersPerFrameUnit;
  if (!Number.isFinite(metersPerFrameUnit) || metersPerFrameUnit <= 0) return { ...NO_COUNTS };

  const center = extractionFrameCenter(plan);
  /** Frame → plan meters, centered on `center`. Frame y → plan y, no flip. */
  const toPlan = (point: FramePoint): Vec2 => ({
    x: (point.x - center.x) * metersPerFrameUnit,
    y: (point.y - center.y) * metersPerFrameUnit,
  });
  const toPolygon = (ring: FramePoint[]): Polygon => ring.map(toPlan);

  const counts: ExtractionApplyCounts = { ...NO_COUNTS };

  // —— slab: traced footprint first, exterior-wall bounds as the fallback ——
  const slabOutline = importSlabOutline(plan, toPolygon, toPlan);
  if (slabOutline) {
    // A plate generated from a rent roll is a placeholder for exactly this
    // drawing. Drop it rather than stack the traced plate on top, which would
    // double the floor's gross area. Slabs the user drew or traced are kept.
    floor.slabs = floor.slabs.filter((slab) => slab.schematic !== true);
    floor.slabs.push(createSlab(ensureCCW(slabOutline), [], IMPORT_SLAB_THICKNESS));
    counts.slabs += 1;
  }

  // —— walls (index-aligned with plan.walls so openings can find them) ——
  const createdWalls: (Wall | null)[] = [];
  for (const source of plan.walls) {
    const start = toPlan({ x: source.x1, y: source.y1 });
    const end = toPlan({ x: source.x2, y: source.y2 });
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_WALL_LENGTH_M) {
      createdWalls.push(null);
      continue;
    }
    const wall = createWall(source.kind, start, end);
    floor.walls.push(wall);
    createdWalls.push(wall);
    counts.walls += 1;
  }

  // —— openings on those walls ——
  const touchedWalls = new Set<Wall>();
  for (const source of plan.openings) {
    const wall = createdWalls[source.wallIndex];
    if (!wall) continue;

    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    // Below this there is no room for an opening plus a stub of wall either side.
    if (length <= 0.4) continue;

    const preset = IMPORT_OPENING_DEFAULTS[source.kind];
    // Honour a stated width when it fits; fall back to the per-kind default.
    const requested = source.widthMeters ?? preset.width;
    const width = clamp(requested, 0.2, length - 0.1);
    const offset = clamp(source.positionRatio * length, width / 2, length - width / 2);

    // Keep the opening inside the wall's vertical extent as well.
    const wallHeight = wall.height ?? floor.height;
    const headroom = wallHeight > 0 ? wallHeight - preset.sillHeight - 0.05 : preset.height;
    const height = headroom > 0.1 ? Math.min(preset.height, headroom) : preset.height;

    wall.openings.push(
      createOpening(source.kind, offset, { width, height, sillHeight: preset.sillHeight }),
    );
    touchedWalls.add(wall);
    counts.openings += 1;
  }
  // `Wall.openings` is documented as sorted by offset.
  for (const wall of touchedWalls) wall.openings.sort((a, b) => a.offset - b.offset);

  // —— zones ——
  for (const source of plan.zones) {
    const outline = toPolygon(source.outline);
    if (outline.length < 3) continue;
    floor.zones.push(createZone(source.name, source.kind, outline, null));
    counts.zones += 1;
  }

  // —— cores ——
  for (const source of plan.cores) {
    const outline = toPolygon(source.outline);
    if (outline.length < 3) continue;
    floor.cores.push(
      source.label === null
        ? createCore(source.kind, outline)
        : createCore(source.kind, outline, source.label),
    );
    counts.cores += 1;
  }

  // —— columns ——
  for (const source of plan.columns) {
    floor.columns.push(
      createColumn(toPlan({ x: source.x, y: source.y }), IMPORT_COLUMN_SIZE, IMPORT_COLUMN_SIZE),
    );
    counts.columns += 1;
  }

  return counts;
}

/**
 * Plan-space outline for the imported slab, or null when the drawing gives no
 * usable plate boundary (no footprint and no exterior walls).
 */
function importSlabOutline(
  plan: ExtractedPlan,
  toPolygon: (ring: FramePoint[]) => Polygon,
  toPlan: (point: FramePoint) => Vec2,
): Polygon | null {
  if (plan.footprint && plan.footprint.length >= 3) {
    return toPolygon(plan.footprint);
  }

  const exteriorPoints: FramePoint[] = [];
  for (const wall of plan.walls) {
    if (wall.kind !== 'exterior') continue;
    exteriorPoints.push({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
  }
  const frameBounds = boundsOf(exteriorPoints);
  if (!frameBounds) return null;

  const min = toPlan(frameBounds.min);
  const max = toPlan(frameBounds.max);
  const width = max.x - min.x;
  const depth = max.y - min.y;
  if (width < MIN_WALL_LENGTH_M || depth < MIN_WALL_LENGTH_M) return null;
  return rect(min.x, min.y, width, depth);
}
