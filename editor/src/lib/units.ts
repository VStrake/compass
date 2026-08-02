/**
 * Unit conversion & display formatting.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * The document always stores **meters** and **square meters**; units are a
 * display concern only (`ProjectDoc.settings.units`). Imperial output follows
 * US commercial real-estate convention: lengths as feet-inches (`41'-0"`),
 * areas as whole square feet with thousands separators (`13,455 SF`).
 */

import { formatFixed, formatInt } from './format';
import type { ProjectSettings } from '@/core/model/types';

export type Units = ProjectSettings['units'];

export const FEET_PER_METER = 3.280839895013123;
export const METERS_PER_FOOT = 0.3048;
export const INCHES_PER_METER = 39.37007874015748;
export const SF_PER_SM = 10.763910416709722;
export const SM_PER_SF = 0.09290304;

// —— scalar conversion ——————————————————————————————————————————
export const metersToFeet = (m: number): number => m * FEET_PER_METER;
export const feetToMeters = (ft: number): number => ft * METERS_PER_FOOT;
export const metersToInches = (m: number): number => m * INCHES_PER_METER;
export const inchesToMeters = (inches: number): number => inches / INCHES_PER_METER;
export const sqmToSqft = (m2: number): number => m2 * SF_PER_SM;
export const sqftToSqm = (sf: number): number => sf * SM_PER_SF;

/** Convert a stored length (m) into the display unit's numeric value. */
export function lengthToDisplay(meters: number, units: Units): number {
  return units === 'imperial' ? metersToFeet(meters) : meters;
}

/** Convert a display length back into stored meters. */
export function displayToLength(value: number, units: Units): number {
  return units === 'imperial' ? feetToMeters(value) : value;
}

/** Convert a stored area (m²) into the display unit's numeric value. */
export function areaToDisplay(sqm: number, units: Units): number {
  return units === 'imperial' ? sqmToSqft(sqm) : sqm;
}

/** Convert a display area back into stored m². */
export function displayToArea(value: number, units: Units): number {
  return units === 'imperial' ? sqftToSqm(value) : value;
}

// —— display strings ——————————————————————————————————————————
/** Short unit suffixes for axis labels and column headers. */
export function lengthUnitLabel(units: Units): string {
  return units === 'imperial' ? 'ft' : 'm';
}

export function areaUnitLabel(units: Units): string {
  return units === 'imperial' ? 'SF' : 'm²';
}

/**
 * Feet-and-inches for a stored length. Inches are rounded to the nearest whole
 * inch and carried into feet when they round up to 12.
 *
 * `12.5` → `41'-0"`; `0.9` → `2'-11"`; `-1.2` → `-3'-11"`.
 */
export function formatFeetInches(meters: number): string {
  const totalInches = metersToInches(Math.abs(meters));
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - feet * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  const sign = meters < 0 ? '-' : '';
  return `${sign}${formatInt(feet)}'-${inches}"`;
}

/**
 * Length for display.
 * metric → `"12.50 m"`; imperial → `"41'-0\""`.
 */
export function formatLength(meters: number, units: Units): string {
  const value = Number.isFinite(meters) ? meters : 0;
  return units === 'imperial' ? formatFeetInches(value) : `${formatFixed(value, 2)} m`;
}

/**
 * Area for display, rounded to whole units.
 * metric → `"1,250 m²"`; imperial → `"13,455 SF"`.
 */
export function formatArea(sqm: number, units: Units): string {
  const value = Number.isFinite(sqm) ? sqm : 0;
  return units === 'imperial'
    ? `${formatInt(sqmToSqft(value))} SF`
    : `${formatInt(value)} m²`;
}

/**
 * Rentable-area style rate helper: area per unit, e.g. SF per person.
 * Kept here so unit conversion stays in one place.
 */
export function formatAreaPer(sqm: number, count: number, units: Units): string {
  if (!Number.isFinite(count) || count <= 0) return '—';
  return formatArea(sqm / count, units);
}
