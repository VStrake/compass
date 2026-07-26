/**
 * Parametric furniture primitives.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Each catalog item resolves to 1–4 merged boxes derived from its footprint —
 * enough silhouette to read a floor plate in 3D at a fraction of the cost of
 * imported meshes, and cheap enough to keep hundreds of instances per floor.
 *
 * Local space: centered on the origin in X/Z, sitting on the floor plane
 * (y = 0 at the floor, growing up to the item height). Placement is
 * `position` (plan x, plan y → world z) + `rotation` radians about +Y.
 *
 * Geometry is a pure function of the *catalog item*, so it can (and should) be
 * cached per catalogId and later swapped for an `InstancedMesh` per item.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CatalogItem } from '../model/types';

const EPS = 1e-3;

/** Axis-aligned box with its center at (cx, cy, cz). */
function box(w: number, h: number, d: number, cx: number, cy: number, cz: number) {
  const g = new THREE.BoxGeometry(Math.max(w, EPS), Math.max(h, EPS), Math.max(d, EPS));
  g.translate(cx, cy, cz);
  return g;
}

function merge(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (pieces.length === 1) return pieces[0]!;
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) return box(EPS, EPS, EPS, 0, 0, 0);
  merged.computeBoundingSphere();
  return merged;
}

/** Work surface: thin top slab on two end panels. */
function deskPieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const topThickness = 0.04;
  const panel = 0.05;
  return [
    box(w, topThickness, d, 0, h - topThickness / 2, 0),
    box(panel, h - topThickness, d * 0.9, -(w / 2 - panel / 2), (h - topThickness) / 2, 0),
    box(panel, h - topThickness, d * 0.9, w / 2 - panel / 2, (h - topThickness) / 2, 0),
  ];
}

/** Desk + two acoustic partition panels (back + one side). */
function workstationPieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const deskH = 0.74;
  const deskD = Math.min(0.8, d * 0.45);
  const panel = 0.06;
  return [
    // work surface, pushed against the back panel
    box(w - panel, 0.04, deskD, panel / 2, deskH - 0.02, -(d / 2) + panel + deskD / 2),
    // back panel
    box(w, h, panel, 0, h / 2, -(d / 2) + panel / 2),
    // side panel
    box(panel, h, d, -(w / 2) + panel / 2, h / 2, 0),
    // pedestal / storage under the surface
    box(0.42, deskH - 0.06, deskD * 0.9, w / 2 - 0.3, (deskH - 0.06) / 2, -(d / 2) + panel + deskD / 2),
  ];
}

/** Seat pad, backrest, column and base. */
function seatingPieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const seatH = Math.min(0.45, h * 0.5);
  const seatThickness = 0.09;
  const backH = Math.max(h - seatH - seatThickness, 0.2);
  return [
    box(w, seatThickness, d, 0, seatH, 0),
    box(w * 0.9, backH, 0.09, 0, seatH + seatThickness / 2 + backH / 2, -(d / 2) + 0.05),
    box(0.12, seatH - seatThickness / 2, 0.12, 0, (seatH - seatThickness / 2) / 2, 0),
    box(w * 0.85, 0.07, d * 0.85, 0, 0.035, 0),
  ];
}

/** Long sofa: base, seat cushion, back cushion. */
function sofaPieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const baseH = 0.22;
  const cushionH = 0.18;
  const backD = 0.16;
  return [
    box(w, baseH, d, 0, baseH / 2, 0),
    box(w - 0.1, cushionH, d - backD - 0.05, 0, baseH + cushionH / 2, backD / 2),
    box(w, h - baseH, backD, 0, baseH + (h - baseH) / 2, -(d / 2) + backD / 2),
  ];
}

/** Table top on a center pedestal + foot. */
function conferencePieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const topThickness = 0.05;
  return [
    box(w, topThickness, d, 0, h - topThickness / 2, 0),
    box(w * 0.35, h - topThickness, d * 0.35, 0, (h - topThickness) / 2, 0),
    box(w * 0.5, 0.05, d * 0.6, 0, 0.025, 0),
  ];
}

/** Reception: transaction counter, lower work surface, front apron. */
function receptionPieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const counterThickness = 0.06;
  const workH = 0.74;
  return [
    box(w, counterThickness, d, 0, h - counterThickness / 2, 0),
    box(w - 0.2, 0.04, d * 0.6, 0, workH, d * 0.1),
    box(w, h - counterThickness, 0.1, 0, (h - counterThickness) / 2, -(d / 2) + 0.05),
  ];
}

/** Cabinet body with a slight top overhang and a plinth. */
function storagePieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const plinth = 0.06;
  const topThickness = 0.03;
  return [
    box(w - 0.04, h - plinth - topThickness, d - 0.02, 0, plinth + (h - plinth - topThickness) / 2, 0),
    box(w, topThickness, d, 0, h - topThickness / 2, 0),
    box(w - 0.1, plinth, d - 0.08, 0, plinth / 2, 0),
  ];
}

/** Counter-height casework: carcass + worktop + upstand. */
function counterPieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const topThickness = 0.05;
  return [
    box(w - 0.04, h - topThickness - 0.08, d - 0.06, 0, 0.08 + (h - topThickness - 0.08) / 2, 0),
    box(w, topThickness, d, 0, h - topThickness / 2, 0),
    box(w, 0.1, 0.03, 0, h + 0.05, -(d / 2) + 0.015),
    box(w - 0.12, 0.08, d - 0.1, 0, 0.04, 0),
  ];
}

/** Four-legged table (break room). */
function tablePieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const topThickness = 0.04;
  const leg = 0.06;
  const inset = 0.08;
  const legH = h - topThickness;
  return [
    box(w, topThickness, d, 0, h - topThickness / 2, 0),
    box(leg, legH, leg, -(w / 2 - inset), legH / 2, -(d / 2 - inset)),
    box(leg, legH, leg, w / 2 - inset, legH / 2, -(d / 2 - inset)),
    box(leg, legH, leg, 0, legH / 2, d / 2 - inset),
  ];
}

/** Tall equipment enclosure with a recessed front face. */
function enclosurePieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  return [
    box(w, h, d, 0, h / 2, 0),
    box(w * 0.8, h * 0.85, 0.03, 0, h / 2, d / 2 + 0.01),
  ];
}

/** Full-height acoustic booth: shell + glazed door band + base. */
function boothPieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  return [
    box(w, h, d, 0, h / 2, 0),
    box(w * 0.7, h * 0.6, 0.04, 0, h * 0.5, d / 2 + 0.02),
    box(w + 0.06, 0.06, d + 0.06, 0, 0.03, 0),
  ];
}

/** Planter: pot + mass of foliage. */
function planterPieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const potH = Math.min(0.45, h * 0.4);
  return [
    box(w, potH, d, 0, potH / 2, 0),
    box(w * 0.85, h - potH, d * 0.85, 0, potH + (h - potH) / 2, 0),
  ];
}

/** Mobile whiteboard: panel on a two-leg frame. */
function whiteboardPieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const panelH = h * 0.6;
  const legH = h - panelH;
  return [
    box(w, panelH, 0.06, 0, legH + panelH / 2, 0),
    box(0.06, legH, d, -(w / 2 - 0.08), legH / 2, 0),
    box(0.06, legH, d, w / 2 - 0.08, legH / 2, 0),
  ];
}

/** Printer / copier: body, output tray, paper drawer plinth. */
function machinePieces(w: number, d: number, h: number): THREE.BufferGeometry[] {
  const bodyH = h * 0.62;
  return [
    box(w, bodyH, d, 0, h - bodyH / 2, 0),
    box(w * 0.9, h - bodyH, d * 0.95, 0, (h - bodyH) / 2, 0),
    box(w * 0.7, 0.04, d * 0.5, 0, h - bodyH - 0.02, d * 0.15),
  ];
}

/**
 * Build the geometry for a catalog item. A handful of items are special-cased
 * where the category silhouette would be wrong (a phone booth is a full-height
 * enclosure, not a table); everything else is category-driven.
 */
export function buildFurnitureGeometry(item: CatalogItem): THREE.BufferGeometry {
  const { w, d, h } = item.footprint;

  switch (item.id) {
    case 'phone-booth':
      return merge(boothPieces(w, d, h));
    case 'planter-large':
      return merge(planterPieces(w, d, h));
    case 'whiteboard-mobile':
      return merge(whiteboardPieces(w, d, h));
    case 'printer-station':
      return merge(machinePieces(w, d, h));
    case 'sofa-lounge':
      return merge(sofaPieces(w, d, h));
    case 'breakroom-table':
      return merge(tablePieces(w, d, h));
    default:
      break;
  }

  switch (item.category) {
    case 'desk':
      return merge(deskPieces(w, d, h));
    case 'workstation':
      return merge(workstationPieces(w, d, h));
    case 'seating':
      return merge(seatingPieces(w, d, h));
    case 'conference':
      return merge(conferencePieces(w, d, h));
    case 'reception':
      return merge(receptionPieces(w, d, h));
    case 'storage':
      return merge(storagePieces(w, d, h));
    case 'break-room':
      return merge(counterPieces(w, d, h));
    case 'server':
      return merge(enclosurePieces(w, d, h));
    case 'fixture':
      return merge(planterPieces(w, d, h));
    default:
      return box(w, h, d, 0, h / 2, 0);
  }
}
