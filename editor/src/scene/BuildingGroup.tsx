'use client';

/**
 * The building: one `FloorGroup` per floor, with stack / explode / solo logic.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Subscribes only to the floor **id list** (shallow-compared, so it is stable
 * between edits), the view mode, and the hidden/active floor state. Editing a
 * wall therefore never re-renders this component; adding or removing a floor
 * does.
 *
 * Visibility is a `visible` flag on the floor's group, never an unmount:
 * toggling solo mode on a 40-story tower must not re-tessellate 40 plates when
 * the user toggles it back (ARCHITECTURE §7.6).
 */

import { useShallow } from 'zustand/react/shallow';

import { useEditorStore } from '@/store/useEditorStore';

import { FloorGroup } from './FloorGroup';

export function BuildingGroup() {
  const floorIds = useEditorStore(
    useShallow((state) => state.project.building.floors.map((floor) => floor.id)),
  );
  const floorViewMode = useEditorStore((state) => state.floorViewMode);
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  // `hiddenFloorIds` is only ever replaced when it changes, so a plain
  // reference subscription is already minimal.
  const hiddenFloorIds = useEditorStore((state) => state.hiddenFloorIds);

  return (
    <group name="building">
      {floorIds.map((floorId) => {
        const hidden = hiddenFloorIds.includes(floorId);
        const soloed = floorViewMode === 'solo' && floorId !== activeFloorId;
        return <FloorGroup key={floorId} floorId={floorId} visible={!hidden && !soloed} />;
      })}
    </group>
  );
}
