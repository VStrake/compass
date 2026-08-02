'use client';

/**
 * Inspector: routes the current selection to its editor, and always exposes the
 * tenant roster (tenants are building-wide, not per-selection).
 * Proprietary and confidential. © Partners Real Estate.
 */

import { useMemo } from 'react';

import type {
  ColumnId,
  CoreId,
  EntityKind,
  FloorId,
  FurnitureId,
  OpeningId,
  SlabId,
  TenantId,
  WallId,
  ZoneId,
} from '@/core/model/types';
import { useEditorStore } from '@/store/useEditorStore';
import { Button, ColorDot, MiniButton, SectionHeader, StatusChip, shortId, titleCase } from '../primitives';
import { FloorInspector } from './inspectors/FloorInspector';
import { FurnitureInspector } from './inspectors/FurnitureInspector';
import {
  BuildingInspector,
  ColumnInspector,
  CoreInspector,
  OpeningInspector,
  SlabInspector,
} from './inspectors/SimpleInspectors';
import { TenantInspector } from './inspectors/TenantInspector';
import { WallInspector } from './inspectors/WallInspector';
import { ZoneInspector } from './inspectors/ZoneInspector';

/** Kinds `deleteSelection()` can actually remove (verified in the store). */
const DELETABLE: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'wall',
  'zone',
  'furniture',
  'column',
  'core',
  'floor',
  'tenant',
  'opening',
]);

function TenantsSection() {
  const tenantRecord = useEditorStore((state) => state.project.tenants);
  const selection = useEditorStore((state) => state.selection);
  const selectEntity = useEditorStore((state) => state.selectEntity);
  const upsertTenant = useEditorStore((state) => state.upsertTenant);

  const tenants = useMemo(() => Object.values(tenantRecord), [tenantRecord]);

  return (
    <section className="mt-auto border-t border-editor-border">
      <SectionHeader
        right={
          <MiniButton
            title="Create a tenant record"
            onClick={() => {
              const id = upsertTenant({ name: 'New Tenant' });
              selectEntity('tenant', id);
            }}
          >
            + New tenant
          </MiniButton>
        }
      >
        Tenants ({tenants.length})
      </SectionHeader>

      {tenants.length === 0 ? (
        <div className="px-2 pb-2 text-xs text-gray-600">
          No tenants yet. Create one, then assign it to a suite.
        </div>
      ) : (
        <div className="pb-1">
          {tenants.map((tenant) => {
            const active = selection?.kind === 'tenant' && selection.id === tenant.id;
            return (
              <button
                key={tenant.id}
                type="button"
                onClick={() => selectEntity('tenant', tenant.id)}
                title={tenant.industry ? `${tenant.name} — ${tenant.industry}` : tenant.name}
                className={`flex w-full items-center gap-2 px-2 py-0.5 text-left text-xs ${
                  active
                    ? 'bg-amber-500/15 text-amber-200'
                    : 'text-gray-400 hover:bg-editor-raised hover:text-gray-200'
                }`}
              >
                <ColorDot color={tenant.color} />
                <span className="min-w-0 flex-1 truncate">{tenant.name}</span>
                <StatusChip status={tenant.status} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SelectionBody({
  kind,
  id,
  floorId,
}: {
  kind: EntityKind;
  id: string;
  floorId: FloorId | null;
}) {
  switch (kind) {
    case 'wall':
      return <WallInspector id={id as WallId} floorHint={floorId} />;
    case 'floor':
      return <FloorInspector id={id as FloorId} />;
    case 'zone':
      return <ZoneInspector id={id as ZoneId} floorHint={floorId} />;
    case 'furniture':
      return <FurnitureInspector id={id as FurnitureId} floorHint={floorId} />;
    case 'tenant':
      return <TenantInspector id={id as TenantId} />;
    case 'column':
      return <ColumnInspector id={id as ColumnId} floorHint={floorId} />;
    case 'core':
      return <CoreInspector id={id as CoreId} floorHint={floorId} />;
    case 'slab':
      return <SlabInspector id={id as SlabId} floorHint={floorId} />;
    case 'opening':
      return <OpeningInspector id={id as OpeningId} />;
    case 'building':
      return <BuildingInspector />;
    default:
      return null;
  }
}

function DeleteFooter({ kind }: { kind: EntityKind }) {
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const floorCount = useEditorStore((state) => state.project.building.floors.length);
  const lastFloor = kind === 'floor' && floorCount <= 1;

  return (
    <div className="border-b border-editor-border px-2 py-2">
      <Button
        danger
        disabled={lastFloor}
        className="w-full"
        title={
          lastFloor
            ? 'A building must keep at least one floor'
            : `Delete the selected ${kind} (Del)`
        }
        onClick={() => {
          if (kind === 'floor' && !window.confirm('Delete this floor and everything on it?')) {
            return;
          }
          deleteSelection();
        }}
      >
        Delete {kind}
      </Button>
    </div>
  );
}

export function PropertiesPanel() {
  const selection = useEditorStore((state) => state.selection);
  const clearSelection = useEditorStore((state) => state.clearSelection);

  return (
    <div className="flex min-h-full flex-col">
      <SectionHeader
        className="border-b border-editor-border"
        right={
          selection ? (
            <>
              <span className="font-mono text-[10px] text-gray-600">{shortId(selection.id)}</span>
              <MiniButton onClick={clearSelection} title="Clear the selection">
                Clear
              </MiniButton>
            </>
          ) : null
        }
      >
        {selection ? titleCase(selection.kind) : 'No selection'}
      </SectionHeader>

      {selection ? (
        <SelectionBody kind={selection.kind} id={selection.id} floorId={selection.floorId} />
      ) : (
        <div className="px-2 py-3 text-xs text-gray-600">
          Select a floor, wall, zone or furniture item — in the viewport or the tree — to edit its
          properties.
        </div>
      )}

      {selection && DELETABLE.has(selection.kind) ? <DeleteFooter kind={selection.kind} /> : null}

      <TenantsSection />
    </div>
  );
}

export default PropertiesPanel;
