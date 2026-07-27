'use client';

/**
 * Live area & efficiency analytics (ARCHITECTURE §4 area semantics).
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Everything here derives from the memoized `areaReport()` selector, so the
 * panel recomputes on document change only — never per frame.
 */

import { useMemo } from 'react';

import { formatPercent } from '@/lib/format';
import { formatArea } from '@/lib/units';
import { useEditorStore } from '@/store/useEditorStore';
import { ColorDot, SectionHeader } from '../primitives';

const VACANT_COLOR = '#4b5563';

/**
 * Shown instead of a percentage on floors that came from a rent roll: their
 * suites tile the whole plate, so rentable/gross is 1 by construction rather
 * than measured. Import a floor plan to get a real number.
 */
const NO_EFFICIENCY_HINT =
  'Efficiency needs core or common area to measure against. This floor came from a rent roll, so its suites fill the whole plate — import its floor plan to get a real figure.';

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      <span className="truncate font-mono text-xs tabular-nums text-gray-200">{value}</span>
    </div>
  );
}

export function AreaPanel() {
  const report = useEditorStore((state) => state.areaReport());
  const units = useEditorStore((state) => state.project.settings.units);
  const floors = useEditorStore((state) => state.project.building.floors);
  const tenantRecord = useEditorStore((state) => state.project.tenants);
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor);

  const floorNames = useMemo(() => {
    const map = new Map<string, { name: string; index: number }>();
    for (const floor of floors) map.set(floor.id, { name: floor.name, index: floor.index });
    return map;
  }, [floors]);

  const rows = useMemo(
    () =>
      [...report.floors].sort(
        (a, b) =>
          (floorNames.get(b.floorId)?.index ?? 0) - (floorNames.get(a.floorId)?.index ?? 0),
      ),
    [report, floorNames],
  );

  const totals = report.totals;

  return (
    <div className="flex flex-col">
      <SectionHeader className="border-b border-editor-border">Area analysis</SectionHeader>

      {/* —— building totals —— */}
      <div className="flex items-start gap-2 border-b border-editor-border px-2 py-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-2 gap-y-1">
          <Total label="Gross" value={formatArea(totals.grossArea, units)} />
          <Total label="Rentable" value={formatArea(totals.rentableArea, units)} />
          <Total label="Common" value={formatArea(totals.commonArea, units)} />
          <Total label="Core" value={formatArea(totals.coreArea, units)} />
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">Efficiency</span>
          <span
            className={`font-mono text-xl leading-tight tabular-nums ${
              totals.efficiencyMeasured ? 'text-amber-400' : 'text-gray-600'
            }`}
            title={
              totals.efficiencyMeasured
                ? undefined
                : NO_EFFICIENCY_HINT
            }
          >
            {totals.efficiencyMeasured ? formatPercent(totals.efficiency, 1) : '—'}
          </span>
        </div>
      </div>

      {/* —— per floor —— */}
      <div className="border-b border-editor-border">
        <div className="flex items-center gap-2 px-2 py-1 text-[10px] uppercase tracking-wider text-gray-600">
          <span className="min-w-0 flex-1">Floor</span>
          <span className="w-16 text-right">Gross</span>
          <span className="w-16 text-right">Rentable</span>
          <span className="w-10 text-right">Eff</span>
        </div>
        {rows.map((row) => {
          const meta = floorNames.get(row.floorId);
          const active = row.floorId === activeFloorId;
          return (
            <button
              key={row.floorId}
              type="button"
              onClick={() => setActiveFloor(row.floorId)}
              title={`Make ${meta?.name ?? 'this floor'} active`}
              className={`flex w-full items-center gap-2 border-l-2 px-2 py-0.5 text-left font-mono text-[11px] tabular-nums ${
                active
                  ? 'border-amber-500 bg-amber-500/10 text-amber-200'
                  : 'border-transparent text-gray-400 hover:bg-editor-raised hover:text-gray-200'
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-ui">{meta?.name ?? row.floorId}</span>
              <span className="w-16 text-right">{formatArea(row.grossArea, units)}</span>
              <span className="w-16 text-right">{formatArea(row.rentableArea, units)}</span>
              <span
                className={`w-10 text-right ${row.efficiencyMeasured ? '' : 'text-gray-600'}`}
                title={row.efficiencyMeasured ? undefined : NO_EFFICIENCY_HINT}
              >
                {row.efficiencyMeasured ? formatPercent(row.efficiency, 0) : '—'}
              </span>
            </button>
          );
        })}
      </div>

      {/* —— by tenant —— */}
      <SectionHeader>By tenant</SectionHeader>
      {totals.byTenant.length === 0 ? (
        <div className="px-2 pb-2 text-xs text-gray-600">No tenant suites authored yet.</div>
      ) : (
        <div className="pb-2">
          {totals.byTenant.map((entry) => {
            const tenant = entry.tenantId ? tenantRecord[entry.tenantId] : undefined;
            const share = totals.rentableArea > 0 ? entry.area / totals.rentableArea : 0;
            return (
              <div
                key={entry.tenantId ?? '__vacant__'}
                className="flex items-center gap-2 px-2 py-0.5 text-xs"
              >
                <ColorDot color={tenant?.color ?? VACANT_COLOR} />
                <span
                  className={`min-w-0 flex-1 truncate ${tenant ? 'text-gray-300' : 'text-gray-500 italic'}`}
                >
                  {tenant?.name ?? 'Vacant'}
                </span>
                <span className="w-16 shrink-0 text-right font-mono tabular-nums text-gray-400">
                  {formatArea(entry.area, units)}
                </span>
                <span className="w-10 shrink-0 text-right font-mono tabular-nums text-gray-600">
                  {formatPercent(share, 0)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AreaPanel;
