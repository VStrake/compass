'use client';

/**
 * Zone inspector: classification, tenancy and measured area.
 * Proprietary and confidential. © Partners Real Estate.
 */

import { useMemo } from 'react';

import { polygonArea } from '@/core/geometry/polygon';
import type { FloorId, TenantId, ZoneId, ZoneKind } from '@/core/model/types';
import { formatArea } from '@/lib/units';
import { findTenant, findZoneById } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';
import { ColorDot, InfoRow, SelectField, StatusChip, TextField, titleCase } from '../../primitives';
import { FieldGrid, InspectorSection, MissingEntity, useOwnerFloorId } from './shared';

const ZONE_KINDS: ZoneKind[] = [
  'tenant-suite',
  'common',
  'core',
  'amenity',
  'circulation',
  'service',
];

const VACANT_OPTION = '';

export function ZoneInspector({ id, floorHint }: { id: ZoneId; floorHint: FloorId | null }) {
  const zone = useEditorStore((state) => findZoneById(state.project, id));
  const floorId = useOwnerFloorId('zone', id, floorHint);
  // Subscribe to the tenants record (stable identity) and derive the list here —
  // a selector that returns a fresh array would re-render on every store change.
  const tenantRecord = useEditorStore((state) => state.project.tenants);
  const tenants = useMemo(() => Object.values(tenantRecord), [tenantRecord]);
  const tenant = useEditorStore((state) =>
    findTenant(state.project, zone?.tenantId ?? null),
  );
  const units = useEditorStore((state) => state.project.settings.units);
  const updateZone = useEditorStore((state) => state.updateZone);
  const assignTenant = useEditorStore((state) => state.assignTenant);
  const selectEntity = useEditorStore((state) => state.selectEntity);

  if (!zone || !floorId) return <MissingEntity what="zone" />;

  const area = polygonArea(zone.outline);

  return (
    <>
      <InspectorSection title="Zone">
        <FieldGrid cols={1}>
          <TextField
            label="Name"
            value={zone.name}
            onCommit={(next) => updateZone(floorId, zone.id, { name: next })}
          />
        </FieldGrid>
        <div className="mt-1.5">
          <FieldGrid>
            <SelectField<ZoneKind>
              label="Classification"
              value={zone.kind}
              options={ZONE_KINDS.map((kind) => ({ value: kind, label: titleCase(kind) }))}
              onChange={(next) => {
                if (next) updateZone(floorId, zone.id, { kind: next as ZoneKind });
              }}
            />
            <SelectField<string>
              label="Tenant"
              value={zone.tenantId ?? VACANT_OPTION}
              options={[
                { value: VACANT_OPTION, label: '— Vacant —' },
                ...tenants.map((entry) => ({ value: entry.id as string, label: entry.name })),
              ]}
              onChange={(next) =>
                assignTenant(floorId, zone.id, next === '' ? null : (next as TenantId))
              }
            />
          </FieldGrid>
        </div>
      </InspectorSection>

      <InspectorSection title="Measurement">
        <InfoRow label="Polygon area" value={formatArea(area, units)} />
        <InfoRow label="Vertices" value={String(zone.outline.length)} />
        <InfoRow
          label="Counts as"
          value={
            zone.kind === 'tenant-suite' || zone.kind === 'amenity'
              ? 'Rentable'
              : zone.kind === 'core'
                ? 'Core'
                : 'Common'
          }
        />
      </InspectorSection>

      <InspectorSection title="Tenancy">
        {tenant ? (
          <button
            type="button"
            onClick={() => selectEntity('tenant', tenant.id)}
            className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-xs text-gray-300 hover:bg-editor-raised"
            title="Edit this tenant"
          >
            <ColorDot color={tenant.color} />
            <span className="min-w-0 flex-1 truncate">{tenant.name}</span>
            <StatusChip status={tenant.status} />
          </button>
        ) : (
          <div className="px-1 text-xs text-gray-600">
            {zone.kind === 'tenant-suite' ? 'Vacant suite.' : 'Not a leasable suite.'}
          </div>
        )}
      </InspectorSection>
    </>
  );
}

export default ZoneInspector;
