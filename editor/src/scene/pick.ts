'use client';

/**
 * Shared picking rules for the scene layer.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * ## Why the slop test exists
 * The browser fires `click` after any press-and-release on the same element,
 * including one that dragged 400 px across the viewport to orbit the camera.
 * R3F applies a 2-pixel travel threshold to `onPointerMissed` (so an orbit does
 * not clear the selection) but **not** to `onClick` handlers on objects that
 * were hit — those fire regardless of travel. Without the same threshold here,
 * every camera orbit that happened to start over a wall would reselect it, and
 * every orbit during wall drawing would drop a spurious point.
 *
 * `event.delta` is R3F's own pointer travel in pixels since pointer-down, so the
 * threshold matches its behaviour exactly.
 */

import type { ThreeEvent } from '@react-three/fiber';

import type { EntityKind, FloorId } from '@/core/model/types';
import { getEditorState } from '@/store/useEditorStore';

/** Pointer travel (px) still counted as a click rather than a camera drag. */
export const CLICK_SLOP = 2;

export function isPickClick(event: { delta: number }): boolean {
  return event.delta <= CLICK_SLOP;
}

/**
 * The one selection path every entity mesh uses: only while the select tool is
 * active, only for a real click, and stopping propagation so the entity behind
 * does not also claim the pick.
 *
 * Deliberately does *not* stop propagation when it bails — that is what lets a
 * click land on the drawing plane behind a wall while a drawing tool is active.
 */
export function pickEntity(
  event: ThreeEvent<MouseEvent>,
  kind: EntityKind,
  id: string,
  floorId: FloorId | null = null,
): void {
  const store = getEditorState();
  if (store.activeTool !== 'select') return;
  if (!isPickClick(event)) return;
  event.stopPropagation();
  store.selectEntity(kind, id, floorId);
}
