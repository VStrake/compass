'use client';

/**
 * 2D stacking diagram — the leasing view of the tower (M2 Slice B).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * One row per floor, top floor first, each a full-width bar segmented by the
 * floor's `byTenant` areas from the memoized `areaReport()`. Segment colour
 * follows the *current* `colorMode`, using the same `zoneColorFor` inputs the
 * scene uses (`tenant.color`, or `EXPIRY_BUCKETS` via `expiryBucketFor`), so the
 * panel and the 3D view can never disagree about who is where or what rolls
 * when.
 *
 * Plain divs and percentage widths — no chart library, nothing measured, so a
 * 46-storey stack costs one flex row per floor.
 *
 * Bars are drawn against each floor's **rentable** area, so an amenity-heavy
 * plate legitimately shows an unfilled tail: the empty track is rentable area
 * that is not a tenant suite, not a rounding artifact.
 */

import { useMemo } from 'react';

import { formatPercent } from '@/lib/format';
import { formatArea } from '@/lib/units';
import type { Tenant, TenantId } from '@/core/model/types';
import { EXPIRY_BUCKETS, expiryBucketFor } from '@/scene/materials';
import { useEditorStore, type ColorMode } from '@/store/useEditorStore';
import { SectionHeader } from '../primitives';

/** Matches `materials.ts`' vacant/unassigned suite colour. */
const VACANT_COLOR = EXPIRY_BUCKETS[0].color;

const EXPIRY_COLOR: Record<string, string> = Object.fromEntries(
  EXPIRY_BUCKETS.map((bucket) => [bucket.key, bucket.color]),
);

/** The colour a stacking segment takes under the active colour mode. */
function segmentColor(tenant: Tenant | undefined, colorMode: ColorMode, now: number): string {
  if (colorMode === 'expiry') return EXPIRY_COLOR[expiryBucketFor(tenant, now)] ?? VACANT_COLOR;
  return tenant?.color ?? VACANT_COLOR;
}

/** `2029-06-30` → `Jun 2029`; anything unparseable falls back to the raw value. */
function expiryLabel(tenant: Tenant | undefined): string {
  if (!tenant) return 'Vacant';
  if (!tenant.leaseExpiry) return 'no expiry on file';
  const parsed = Date.parse(tenant.leaseExpiry);
  if (Number.isNaN(parsed)) return tenant.leaseExpiry;
  return new Date(parsed).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      <span className="truncate font-mono text-xs tabular-nums text-gray-200">{value}</span>
    </div>
  );
}

export function StackingPanel() {
  const report = useEditorStore((state) => state.areaReport());
  const floors = useEditorStore((state) => state.project.building.floors);
  const tenants = useEditorStore((state) => state.project.tenants);
  const units = useEditorStore((state) => state.project.settings.units);
  const colorMode = useEditorStore((state) => state.colorMode);
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor);
  const selectEntity = useEditorStore((state) => state.selectEntity);

  // Pinned once per mount so the diagram does not restratify mid-session.
  const now = useMemo(() => Date.now(), []);

  const rows = useMemo(() => {
    const meta = new Map(floors.map((floor) => [floor.id, floor]));
    return [...report.floors]
      .sort((a, b) => (meta.get(b.floorId)?.index ?? 0) - (meta.get(a.floorId)?.index ?? 0))
      .map((floor) => {
        const suiteArea = floor.byTenant.reduce((sum, entry) => sum + entry.area, 0);
        return {
          floorId: floor.floorId,
          name: meta.get(floor.floorId)?.name ?? String(floor.floorId),
          // Rentable is the honest denominator; never let it be smaller than
          // the suites it contains (overlapping zones are summed as authored).
          denominator: Math.max(floor.rentableArea, suiteArea),
          suiteArea,
          byTenant: floor.byTenant,
        };
      });
  }, [report, floors]);

  const totals = report.totals;
  const vacantArea =
    totals.byTenant.find((entry) => entry.tenantId === null)?.area ?? 0;
  const leasedArea = Math.max(0, totals.rentableArea - vacantArea);
  const occupancy = totals.rentableArea > 0 ? leasedArea / totals.rentableArea : 0;

  return (
    <div className="flex flex-col">
      <SectionHeader
        className="border-b border-editor-border"
        right={
          <span className="text-[10px] uppercase tracking-wider text-gray-600">
            {colorMode === 'expiry' ? 'by expiry' : 'by tenant'}
          </span>
        }
      >
        Stacking diagram
      </SectionHeader>

      {rows.length === 0 ? (
        <div className="px-2 py-2 text-xs text-gray-600">This building has no floors.</div>
      ) : (
        <div className="border-b border-editor-border py-0.5">
          {rows.map((row) => {
            const active = row.floorId === activeFloorId;
            return (
              <div
                key={row.floorId}
                className={`flex items-center gap-1.5 border-l-2 px-1.5 py-[2px] ${
                  active ? 'border-amber-500 bg-amber-500/10' : 'border-transparent'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveFloor(row.floorId)}
                  title={`Make ${row.name} active`}
                  className={`w-[5.5rem] shrink-0 truncate rounded-sm px-1 text-left text-[10px] outline-none focus-visible:ring-1 focus-visible:ring-amber-500/60 ${
                    active
                      ? 'text-amber-200'
                      : 'text-gray-400 hover:bg-editor-raised hover:text-gray-200'
                  }`}
                >
                  {row.name}
                </button>

                <div className="flex h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm border border-editor-border bg-editor-bg">
                  {row.byTenant.map((entry) => {
                    const tenant = entry.tenantId ? tenants[entry.tenantId] : undefined;
                    const share = row.denominator > 0 ? entry.area / row.denominator : 0;
                    if (share <= 0) return null;
                    const name = tenant?.name ?? 'Vacant';
                    return (
                      <button
                        key={entry.tenantId ?? '__vacant__'}
                        type="button"
                        disabled={!entry.tenantId}
                        title={`${name} · ${formatArea(entry.area, units)} · ${expiryLabel(tenant)}`}
                        onClick={() => {
                          if (entry.tenantId) {
                            selectEntity('tenant', entry.tenantId as TenantId, row.floorId);
                          }
                        }}
                        style={{
                          width: `${Math.min(100, share * 100)}%`,
                          backgroundColor: segmentColor(tenant, colorMode, now),
                        }}
                        className="h-full min-w-[2px] border-r border-black/30 outline-none transition-[filter] last:border-r-0 hover:brightness-125 focus-visible:brightness-125 disabled:cursor-default"
                      />
                    );
                  })}
                </div>

                <span className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums text-gray-500">
                  {formatArea(row.suiteArea, units)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* —— building totals: the panel stands alone as a leasing summary —— */}
      <div className="flex items-start gap-2 px-2 py-2">
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-x-2 gap-y-1">
          <Total label="Gross" value={formatArea(totals.grossArea, units)} />
          <Total label="Rentable" value={formatArea(totals.rentableArea, units)} />
          <Total label="Vacant" value={formatArea(vacantArea, units)} />
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">Occupancy</span>
          <span className="font-mono text-lg leading-tight tabular-nums text-amber-400">
            {formatPercent(occupancy, 1)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default StackingPanel;
