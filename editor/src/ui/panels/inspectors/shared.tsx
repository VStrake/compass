'use client';

/**
 * Inspector layout helpers + owner-floor resolution.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * The scene can select an entity without knowing its floor (`selection.floorId`
 * may be null), but every document command is floor-scoped. `useOwnerFloorId`
 * resolves the owning floor, preferring the selection's hint and falling back to
 * a scan. It returns a plain string id, so the subscription is stable.
 */

import type { ReactNode } from 'react';

import type { Floor, FloorId } from '@/core/model/types';
import { useEditorStore } from '@/store/useEditorStore';

export type OwnedEntityKind = 'wall' | 'zone' | 'furniture' | 'column' | 'core' | 'slab';

export function useOwnerFloorId(
  kind: OwnedEntityKind,
  id: string,
  hint: FloorId | null,
): FloorId | null {
  return useEditorStore((state) => {
    const owns = (floor: Floor): boolean => {
      switch (kind) {
        case 'wall':
          return floor.walls.some((entity) => entity.id === id);
        case 'zone':
          return floor.zones.some((entity) => entity.id === id);
        case 'furniture':
          return floor.furniture.some((entity) => entity.id === id);
        case 'column':
          return floor.columns.some((entity) => entity.id === id);
        case 'core':
          return floor.cores.some((entity) => entity.id === id);
        case 'slab':
          return floor.slabs.some((entity) => entity.id === id);
        default:
          return false;
      }
    };

    const floors = state.project.building.floors;
    if (hint) {
      const hinted = floors.find((floor) => floor.id === hint);
      if (hinted && owns(hinted)) return hinted.id;
    }
    return floors.find(owns)?.id ?? null;
  });
}

export function InspectorSection({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-editor-border px-2 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{title}</span>
        {right ? <span className="flex items-center gap-1">{right}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function FieldGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  const columns = cols === 1 ? 'grid-cols-1' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return <div className={`grid ${columns} gap-x-2 gap-y-1.5`}>{children}</div>;
}

export function MissingEntity({ what }: { what: string }) {
  return (
    <div className="px-2 py-3 text-xs text-gray-500">
      This {what} no longer exists in the document.
    </div>
  );
}
