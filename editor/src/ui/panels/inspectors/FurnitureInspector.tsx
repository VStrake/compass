'use client';

/**
 * Furniture inspector: catalog identity, plan position, rotation.
 * Proprietary and confidential. © Partners Real Estate.
 */

import { getCatalogItem } from '@/core/model/catalog';
import type { FloorId, FurnitureId } from '@/core/model/types';
import { formatLength } from '@/lib/units';
import { findFurnitureById } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';
import { NumberField } from '../../NumberField';
import { InfoRow, titleCase } from '../../primitives';
import { FieldGrid, InspectorSection, MissingEntity, useOwnerFloorId } from './shared';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export function FurnitureInspector({
  id,
  floorHint,
}: {
  id: FurnitureId;
  floorHint: FloorId | null;
}) {
  const item = useEditorStore((state) => findFurnitureById(state.project, id));
  const floorId = useOwnerFloorId('furniture', id, floorHint);
  const units = useEditorStore((state) => state.project.settings.units);
  const updateFurniture = useEditorStore((state) => state.updateFurniture);

  if (!item || !floorId) return <MissingEntity what="furniture item" />;

  const catalogItem = getCatalogItem(item.catalogId);

  return (
    <>
      <InspectorSection title="Catalog item">
        <InfoRow label="Item" value={catalogItem?.name ?? item.catalogId} mono={false} />
        <InfoRow
          label="Category"
          value={catalogItem ? titleCase(catalogItem.category) : '—'}
          mono={false}
        />
        <InfoRow
          label="Footprint"
          value={
            catalogItem
              ? `${formatLength(catalogItem.footprint.w, units)} × ${formatLength(
                  catalogItem.footprint.d,
                  units,
                )}`
              : '—'
          }
        />
        <InfoRow
          label="Height"
          value={catalogItem ? formatLength(catalogItem.footprint.h, units) : '—'}
        />
      </InspectorSection>

      <InspectorSection title="Placement">
        <FieldGrid>
          <NumberField
            label="Position X"
            unit="length"
            value={item.position.x}
            onCommit={(next) =>
              updateFurniture(floorId, item.id, { position: { x: next, y: item.position.y } })
            }
          />
          <NumberField
            label="Position Y"
            unit="length"
            value={item.position.y}
            onCommit={(next) =>
              updateFurniture(floorId, item.id, { position: { x: item.position.x, y: next } })
            }
          />
          <NumberField
            label="Rotation"
            unit="degrees"
            step={5}
            decimals={1}
            value={item.rotation * RAD_TO_DEG}
            onCommit={(next) => updateFurniture(floorId, item.id, { rotation: next * DEG_TO_RAD })}
          />
        </FieldGrid>
      </InspectorSection>
    </>
  );
}

export default FurnitureInspector;
