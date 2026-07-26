'use client';

/**
 * One wall, plus its endpoint edit handles when selected.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Geometry comes from `buildWallGeometry` in *local wall space* (+X along the
 * wall, +Y up, thickness centred on Z) and is placed by `wallTransform`, so a
 * wall that only moves never re-tessellates — the geometry is memoized on the
 * `Wall` object's identity (ARCHITECTURE §2).
 *
 * ## Endpoint dragging
 * The handles live in the *floor's* space (not the wall's rotated space) so they
 * can be positioned straight from `wall.start` / `wall.end`. A drag uses
 * window-level `pointermove` / `pointerup` listeners plus DOM pointer capture
 * rather than R3F's per-object events: once the pointer leaves the handle's
 * silhouette (which it does immediately) R3F would stop delivering moves to it.
 *
 * The whole drag is wrapped in `beginBatch('Move wall endpoint')` /
 * `endBatch()` so it collapses to one undo entry, and `updateWall` is only
 * called when the *snapped* point actually changes — with grid snapping on,
 * that is a handful of commits instead of one per frame.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';

import { buildWallGeometry, wallTransform } from '@/core/geometry/wall';
import type { FloorId, Vec2, WallId } from '@/core/model/types';
import { findWall } from '@/store/selectors';
import { getEditorState, useEditorStore } from '@/store/useEditorStore';

import { HANDLE_GEOMETRY, HANDLE_MATERIAL, SELECTION_MATERIAL, getWallMaterial } from '../materials';
import { useActiveTool, useIsSelected } from '../hooks';
import { pickEntity } from '../pick';
import { createGroundPoint } from '../tools/useGroundPoint';

/** Handles sit just above the slab; the sphere's girth keeps them pickable. */
const HANDLE_Y = 0.14;

type WallEnd = 'start' | 'end';

export interface WallMeshProps {
  floorId: FloorId;
  wallId: WallId;
  /** Fallback height for walls with `height: null`. */
  floorHeight: number;
  /** World Y of the owning floor's plane — the drag projection target. */
  floorElevation: number;
}

function WallMeshImpl({ floorId, wallId, floorHeight, floorElevation }: WallMeshProps) {
  const wall = useEditorStore((state) => findWall(state.project, floorId, wallId));
  const selected = useIsSelected('wall', wallId);
  const activeTool = useActiveTool();
  // `useStore()` hands over R3F's store *without subscribing to a slice*: a
  // 40-story tower has thousands of walls, and none of them should re-render (or
  // even run a selector) because the camera or the working plane moved. The
  // projector is built on pointer-down instead.
  const r3f = useStore();

  const geometry = useMemo(
    () => (wall ? buildWallGeometry(wall, floorHeight) : null),
    [wall, floorHeight],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);

  /** Teardown for an in-flight drag; also used by the unmount guard. */
  const stopDragRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      stopDragRef.current?.();
    },
    [],
  );

  const beginDrag = useCallback(
    (which: WallEnd, event: ThreeEvent<PointerEvent>) => {
      const store = getEditorState();
      if (store.activeTool !== 'select') return;
      event.stopPropagation();

      // A drag in progress must not be restarted by a second pointer.
      if (stopDragRef.current) return;

      const pointerId = event.pointerId;
      const captureTarget = event.nativeEvent.target as Element | null;
      captureTarget?.setPointerCapture?.(pointerId);

      const view = r3f.getState();
      const ground = createGroundPoint({
        elevation: floorElevation,
        floorId,
        camera: view.camera,
        domElement: view.gl.domElement,
        grid: store.project.settings.grid,
      });

      store.beginBatch('Move wall endpoint');
      let last: Vec2 | null = null;

      const onMove = (native: PointerEvent) => {
        if (native.pointerId !== pointerId) return;
        const point = ground.fromClient(native.clientX, native.clientY);
        if (!point) return;
        if (last && last.x === point.x && last.y === point.y) return;
        last = point;
        getEditorState().updateWall(
          floorId,
          wallId,
          which === 'start' ? { start: point } : { end: point },
        );
      };

      const finish = () => {
        stopDragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        captureTarget?.releasePointerCapture?.(pointerId);
        getEditorState().endBatch();
      };

      const onUp = (native: PointerEvent) => {
        if (native.pointerId !== pointerId) return;
        finish();
      };

      stopDragRef.current = finish;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [floorId, wallId, floorElevation, r3f],
  );

  const onPointerDownStart = useCallback(
    (event: ThreeEvent<PointerEvent>) => beginDrag('start', event),
    [beginDrag],
  );
  const onPointerDownEnd = useCallback(
    (event: ThreeEvent<PointerEvent>) => beginDrag('end', event),
    [beginDrag],
  );

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => pickEntity(event, 'wall', wallId, floorId),
    [floorId, wallId],
  );

  if (!wall || !geometry) return null;

  const { position, rotationY } = wallTransform(wall);
  const showHandles = selected && activeTool === 'select';

  return (
    <group>
      <group position={position} rotation={[0, rotationY, 0]}>
        <mesh
          geometry={geometry}
          material={selected ? SELECTION_MATERIAL : getWallMaterial(wall.kind)}
          onClick={onClick}
        />
      </group>

      {showHandles && (
        <>
          <mesh
            position={[wall.start.x, HANDLE_Y, wall.start.y]}
            geometry={HANDLE_GEOMETRY}
            material={HANDLE_MATERIAL}
            renderOrder={30}
            onPointerDown={onPointerDownStart}
          />
          <mesh
            position={[wall.end.x, HANDLE_Y, wall.end.y]}
            geometry={HANDLE_GEOMETRY}
            material={HANDLE_MATERIAL}
            renderOrder={30}
            onPointerDown={onPointerDownEnd}
          />
        </>
      )}
    </group>
  );
}

export const WallMesh = memo(WallMeshImpl);
