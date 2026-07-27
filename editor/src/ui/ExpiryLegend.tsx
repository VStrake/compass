'use client';

/**
 * Lease-rollover legend for `colorMode: 'expiry'` (M2 Slice B).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * Overlays the bottom-left of the viewport, *outside* `src/scene` — the scene
 * tier owns geometry and materials only, and a DOM chip row costs nothing per
 * frame where an in-scene sprite would.
 *
 * Colours come straight from `EXPIRY_BUCKETS` and the bucketing from
 * `expiryBucketFor`, so the legend can never drift from the 3D overlays.
 * Bucket totals are the building-wide rentable area rolled up from the memoized
 * `areaReport().totals.byTenant` — the same numbers the Area panel quotes.
 */

import { useMemo } from 'react';

import { formatPercent } from '@/lib/format';
import { formatArea } from '@/lib/units';
import { EXPIRY_BUCKETS, expiryBucketFor, type ExpiryBucketKey } from '@/scene/materials';
import { useEditorStore } from '@/store/useEditorStore';

export function ExpiryLegend() {
  const report = useEditorStore((state) => state.areaReport());
  const tenants = useEditorStore((state) => state.project.tenants);
  const units = useEditorStore((state) => state.project.settings.units);

  // Pinned once per mount: the clock must not move under a rendered diagram.
  const now = useMemo(() => Date.now(), []);

  const totals = useMemo(() => {
    const byBucket = new Map<ExpiryBucketKey, number>();
    for (const entry of report.totals.byTenant) {
      const tenant = entry.tenantId ? tenants[entry.tenantId] : undefined;
      const key = expiryBucketFor(tenant, now);
      byBucket.set(key, (byBucket.get(key) ?? 0) + entry.area);
    }
    let sum = 0;
    for (const area of byBucket.values()) sum += area;
    return { byBucket, sum };
  }, [report, tenants, now]);

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-editor-border bg-editor-panel/85 px-2 py-1.5 backdrop-blur-sm">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">Lease rollover</span>
      {EXPIRY_BUCKETS.map((bucket) => {
        const area = totals.byBucket.get(bucket.key) ?? 0;
        const share = totals.sum > 0 ? area / totals.sum : 0;
        return (
          <span key={bucket.key} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/40"
              style={{ backgroundColor: bucket.color }}
            />
            <span className="text-[11px] text-gray-300">{bucket.label}</span>
            {totals.sum > 0 ? (
              <span className="font-mono text-[10px] tabular-nums text-gray-500">
                {formatArea(area, units)} · {formatPercent(share, 0)}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export default ExpiryLegend;
