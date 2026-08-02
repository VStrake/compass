/**
 * Branded ID factory.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * IDs are prefixed, human-scannable strings ("wall_9f3a…"). The prefix makes
 * documents debuggable; the brand makes them type-safe.
 */

import type {
  BuildingId,
  ColumnId,
  CoreId,
  FloorId,
  FurnitureId,
  OpeningId,
  ProjectId,
  SlabId,
  TenantId,
  UserId,
  WallId,
  ZoneId,
} from './types';

/**
 * RFC-4122-ish v4 fallback for non-secure contexts (plain http, older
 * WebViews, Node < 19) where `crypto.randomUUID` is unavailable. Not
 * cryptographically strong — ids only need to be collision-free within one
 * document, and the document is authored by a single client.
 */
function fallbackUuid(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += '-';
    } else if (i === 14) {
      out += '4';
    } else if (i === 19) {
      out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
    } else {
      out += hex[Math.floor(Math.random() * 16)];
    }
  }
  return out;
}

function uuid(): string {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // Some environments expose the method but throw outside secure contexts.
    }
  }
  return fallbackUuid();
}

/**
 * Mint a new branded id.
 *
 * @param prefix short entity tag, e.g. `'wall'`.
 * @returns `${prefix}_${uuid}` cast to the requested branded type.
 *
 * @example const id = newId<WallId>('wall');
 */
export function newId<T extends string>(prefix: string): T {
  return `${prefix}_${uuid()}` as T;
}

/** Deterministic branded id — used by seeded content (demo tower, templates). */
export function fixedId<T extends string>(prefix: string, key: string | number): T {
  return `${prefix}_${key}` as T;
}

export const newProjectId = (): ProjectId => newId<ProjectId>('proj');
export const newBuildingId = (): BuildingId => newId<BuildingId>('bldg');
export const newFloorId = (): FloorId => newId<FloorId>('floor');
export const newWallId = (): WallId => newId<WallId>('wall');
export const newSlabId = (): SlabId => newId<SlabId>('slab');
export const newOpeningId = (): OpeningId => newId<OpeningId>('open');
export const newZoneId = (): ZoneId => newId<ZoneId>('zone');
export const newColumnId = (): ColumnId => newId<ColumnId>('col');
export const newCoreId = (): CoreId => newId<CoreId>('core');
export const newFurnitureId = (): FurnitureId => newId<FurnitureId>('furn');
export const newTenantId = (): TenantId => newId<TenantId>('tenant');
export const newUserId = (): UserId => newId<UserId>('user');
