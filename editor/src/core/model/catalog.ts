/**
 * Compass Studio proprietary office furniture & fixture catalog.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Catalog entries are content-addressed by a stable string key. Furniture
 * instances reference `catalogId` only, which is what makes the future
 * `InstancedMesh`-per-catalog-item upgrade a drop-in (see ARCHITECTURE §7.4).
 *
 * Footprints are the bounding box in meters: w = width along local +X,
 * d = depth along local +Z, h = height along local +Y. They are derived from
 * typical North-American commercial office standards.
 */

import type { CatalogItem } from './types';

export const CATALOG: CatalogItem[] = [
  // —— desks & workstations ——
  {
    id: 'desk-standard',
    name: 'Desk — 1600×800',
    category: 'desk',
    footprint: { w: 1.6, d: 0.8, h: 0.74 },
  },
  {
    id: 'desk-executive',
    name: 'Executive Desk — 1800×900',
    category: 'desk',
    footprint: { w: 1.8, d: 0.9, h: 0.75 },
  },
  {
    id: 'desk-sit-stand',
    name: 'Sit-Stand Desk — 1400×700',
    category: 'desk',
    footprint: { w: 1.4, d: 0.7, h: 0.74 },
  },
  {
    id: 'workstation-cubicle',
    name: 'Workstation Cubicle — 2400×2400',
    category: 'workstation',
    footprint: { w: 2.4, d: 2.4, h: 1.2 },
  },
  {
    id: 'workstation-bench',
    name: 'Bench Workstation — 1500×1500',
    category: 'workstation',
    footprint: { w: 1.5, d: 1.5, h: 1.1 },
  },

  // —— seating ——
  {
    id: 'chair-task',
    name: 'Task Chair',
    category: 'seating',
    footprint: { w: 0.62, d: 0.62, h: 1.1 },
  },
  {
    id: 'chair-guest',
    name: 'Guest Chair',
    category: 'seating',
    footprint: { w: 0.58, d: 0.58, h: 0.85 },
  },
  {
    id: 'sofa-lounge',
    name: 'Lounge Sofa — 2-Seat',
    category: 'seating',
    footprint: { w: 1.8, d: 0.85, h: 0.78 },
  },

  // —— conference ——
  {
    id: 'conference-table-10',
    name: 'Conference Table — 10 Person',
    category: 'conference',
    footprint: { w: 4.2, d: 1.4, h: 0.74 },
  },
  {
    id: 'conference-table-6',
    name: 'Conference Table — 6 Person',
    category: 'conference',
    footprint: { w: 2.4, d: 1.2, h: 0.74 },
  },
  {
    id: 'phone-booth',
    name: 'Phone Booth — 1 Person',
    category: 'conference',
    footprint: { w: 1.1, d: 1.1, h: 2.2 },
  },

  // —— reception ——
  {
    id: 'reception-desk',
    name: 'Reception Desk',
    category: 'reception',
    footprint: { w: 2.8, d: 0.9, h: 1.1 },
  },

  // —— storage ——
  {
    id: 'file-cabinet',
    name: 'Lateral File Cabinet — 4 Drawer',
    category: 'storage',
    footprint: { w: 0.9, d: 0.5, h: 1.32 },
  },
  {
    id: 'storage-credenza',
    name: 'Storage Credenza',
    category: 'storage',
    footprint: { w: 1.6, d: 0.5, h: 0.72 },
  },

  // —— break room ——
  {
    id: 'breakroom-counter',
    name: 'Break-Room Counter',
    category: 'break-room',
    footprint: { w: 3.0, d: 0.65, h: 0.92 },
  },
  {
    id: 'breakroom-table',
    name: 'Break-Room Table — 4 Person',
    category: 'break-room',
    footprint: { w: 1.2, d: 1.2, h: 0.74 },
  },

  // —— technical ——
  {
    id: 'server-rack',
    name: 'Server Rack — 42U',
    category: 'server',
    footprint: { w: 0.6, d: 1.0, h: 2.0 },
  },
  {
    id: 'printer-station',
    name: 'Printer / Copy Station',
    category: 'server',
    footprint: { w: 0.8, d: 0.7, h: 1.15 },
  },

  // —— fixtures ——
  {
    id: 'planter-large',
    name: 'Planter — Large',
    category: 'fixture',
    footprint: { w: 0.7, d: 0.7, h: 1.4 },
  },
  {
    id: 'whiteboard-mobile',
    name: 'Mobile Whiteboard',
    category: 'fixture',
    footprint: { w: 1.8, d: 0.55, h: 1.9 },
  },
];

const CATALOG_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(
  CATALOG.map((item) => [item.id, item]),
);

/** Look up a catalog item by its stable key. Returns undefined if unknown. */
export function getCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG_BY_ID.get(id);
}

/** All catalog items in one category, in catalog order. */
export function getCatalogByCategory(category: CatalogItem['category']): CatalogItem[] {
  return CATALOG.filter((item) => item.category === category);
}
