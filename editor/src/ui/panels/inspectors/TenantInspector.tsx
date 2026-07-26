'use client';

/**
 * Tenant inspector.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * `upsertTenant({ id, name, … })` updates in place when the id already exists
 * (verified in the store source), so every field below is a partial upsert that
 * always carries the current name — `name` is required by the signature.
 */

import { useMemo } from 'react';

import type { FloorId, TenantId, TenantStatus, ZoneId } from '@/core/model/types';
import { formatPercent } from '@/lib/format';
import { formatArea } from '@/lib/units';
import { useEditorStore } from '@/store/useEditorStore';
import { FieldLabel, InfoRow, SelectField, StatusChip, TextField, titleCase } from '../../primitives';
import { FieldGrid, InspectorSection, MissingEntity } from './shared';

const STATUSES: TenantStatus[] = ['leased', 'proposed', 'expiring', 'vacant'];

export function TenantInspector({ id }: { id: TenantId }) {
  const tenant = useEditorStore((state) => state.project.tenants[id]);
  const units = useEditorStore((state) => state.project.settings.units);
  const report = useEditorStore((state) => state.areaReport());
  const floors = useEditorStore((state) => state.project.building.floors);
  const upsertTenant = useEditorStore((state) => state.upsertTenant);
  const selectEntity = useEditorStore((state) => state.selectEntity);
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor);

  const leased = useMemo(() => {
    const out: { floorId: FloorId; floorName: string; zoneId: ZoneId; zoneName: string }[] = [];
    for (const floor of floors) {
      for (const zone of floor.zones) {
        if (zone.tenantId === id) {
          out.push({
            floorId: floor.id,
            floorName: floor.name,
            zoneId: zone.id,
            zoneName: zone.name,
          });
        }
      }
    }
    return out;
  }, [floors, id]);

  if (!tenant) return <MissingEntity what="tenant" />;

  const tenantArea = report.totals.byTenant.find((entry) => entry.tenantId === id)?.area ?? 0;
  const share = report.totals.rentableArea > 0 ? tenantArea / report.totals.rentableArea : 0;

  return (
    <>
      <InspectorSection
        title="Tenant"
        right={<StatusChip status={tenant.status} />}
      >
        <FieldGrid cols={1}>
          <TextField
            label="Name"
            value={tenant.name}
            onCommit={(next) => upsertTenant({ id, name: next })}
          />
        </FieldGrid>

        <div className="mt-1.5">
          <FieldGrid>
            <SelectField<TenantStatus>
              label="Status"
              value={tenant.status}
              options={STATUSES.map((status) => ({ value: status, label: titleCase(status) }))}
              onChange={(next) => {
                if (next) {
                  upsertTenant({ id, name: tenant.name, status: next as TenantStatus });
                }
              }}
            />
            <label className="flex flex-col gap-0.5">
              <FieldLabel>Color</FieldLabel>
              <input
                type="color"
                value={tenant.color}
                onChange={(event) =>
                  upsertTenant({ id, name: tenant.name, color: event.currentTarget.value })
                }
                title="Tenant color used by the Tenant color mode"
                className="h-7 w-full cursor-pointer rounded-sm border border-editor-border bg-editor-bg px-1"
              />
            </label>
          </FieldGrid>
        </div>

        <div className="mt-1.5">
          <FieldGrid cols={1}>
            <TextField
              label="Industry"
              value={tenant.industry ?? ''}
              placeholder="e.g. Professional Services"
              onCommit={(next) => upsertTenant({ id, name: tenant.name, industry: next })}
            />
          </FieldGrid>
        </div>

        {tenant.leaseExpiry ? (
          <div className="mt-1.5">
            <InfoRow label="Lease expiry" value={tenant.leaseExpiry} />
          </div>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Portfolio">
        <InfoRow label="Leased area" value={formatArea(tenantArea, units)} />
        <InfoRow label="Share of rentable" value={formatPercent(share)} />
        <InfoRow label="Suites" value={String(leased.length)} />
        {leased.length > 0 ? (
          <div className="mt-1 flex flex-col gap-0.5">
            {leased.map((suite) => (
              <button
                key={suite.zoneId}
                type="button"
                onClick={() => {
                  setActiveFloor(suite.floorId);
                  selectEntity('zone', suite.zoneId, suite.floorId);
                }}
                className="flex items-center gap-2 rounded-sm px-1 py-0.5 text-left text-xs text-gray-400 hover:bg-editor-raised hover:text-gray-200"
                title={`${suite.floorName} — ${suite.zoneName}`}
              >
                <span className="min-w-0 flex-1 truncate">{suite.zoneName}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-600">
                  {suite.floorName}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </InspectorSection>
    </>
  );
}

export default TenantInspector;
