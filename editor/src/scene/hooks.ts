'use client';

/**
 * Narrow store subscriptions shared by the scene layer.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Every hook here returns primitives (or a shallow-compared record of
 * primitives) so a component that only cares about "where is the active floor"
 * does not re-render when an unrelated wall moves — ARCHITECTURE §2's
 * selective-rendering rule 1.
 */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';

import type { EntityKind, FloorId } from '@/core/model/types';
import { findFloor, floorDisplayElevation, isSelected } from '@/store/selectors';
import { subscribeEditor, useEditorStore } from '@/store/useEditorStore';

/** The active floor's identity and where it currently sits in world space. */
export interface ActiveFloorPlane {
  floorId: FloorId;
  /** World Y of the floor's slab top under the current view mode. */
  elevation: number;
  /** Floor-to-floor height, meters. */
  height: number;
  /** False when `activeFloorId` does not resolve (mid-delete). */
  exists: boolean;
}

/**
 * Where the active floor's working plane is right now. Recomputed when the
 * active floor, its elevation/height, the view mode or the explode gap change —
 * not when its contents change.
 */
export function useActiveFloorPlane(): ActiveFloorPlane {
  return useEditorStore(
    useShallow((state): ActiveFloorPlane => {
      const floor = findFloor(state.project, state.activeFloorId);
      if (!floor) {
        return { floorId: state.activeFloorId, elevation: 0, height: 0, exists: false };
      }
      return {
        floorId: floor.id,
        elevation: floorDisplayElevation(floor, state.floorViewMode, state.explodeGap),
        height: floor.height,
        exists: true,
      };
    }),
  );
}

/** World Y of the active floor's working plane. */
export function useActiveFloorElevation(): number {
  return useEditorStore((state) => {
    const floor = findFloor(state.project, state.activeFloorId);
    return floor ? floorDisplayElevation(floor, state.floorViewMode, state.explodeGap) : 0;
  });
}

/** "Am I the selected entity?" — a boolean, so identity churn cannot leak in. */
export function useIsSelected(kind: EntityKind, id: string): boolean {
  return useEditorStore((state) => isSelected(state.selection, kind, id));
}

/** The active tool, for pick/interaction gating. */
export function useActiveTool() {
  return useEditorStore((state) => state.activeTool);
}

/** The document's grid settings object (stable identity between edits). */
export function useGridSettings() {
  return useEditorStore((state) => state.project.settings.grid);
}

/** Display units, for length labels. */
export function useUnits() {
  return useEditorStore((state) => state.project.settings.units);
}

/**
 * `frameloop="demand"` renders only when something asks it to. React-driven
 * prop changes are invalidated by the reconciler, but a store mutation that
 * lands on a component which bails out early (or on an imperative path such as
 * an endpoint drag) would otherwise leave the canvas stale. One subscription to
 * the document covers every case for the cost of a single function call per
 * commit.
 */
export function useInvalidateOnDocumentChange(): void {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => subscribeEditor(() => invalidate()), [invalidate]);
}
