'use client';

/**
 * Click-to-draw wall chains on the active floor.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Mounted only while `activeTool === 'wall'`.
 *
 * ## Interaction
 * - move           — updates the snapped hover point
 * - click          — first click starts the chain; every later click commits the
 *                    segment from the previous point and continues from the new
 *                    one
 * - Enter / dblclick — ends the chain
 * - Escape         — ends the chain if one is open, otherwise returns to the
 *                    select tool
 *
 * ## Snapping precedence
 * endpoint snap (existing wall endpoints, `useGroundPoint`) → 45° angle snap
 * relative to the previous point when `settings.grid.angleSnap` → grid rounding.
 * Endpoint snap wins because walls that are meant to meet must meet exactly.
 *
 * ## Undo granularity
 * One chain = one undo entry. `beginBatch('Draw walls')` opens on the first
 * committed segment and `endBatch()` closes on end / cancel / **unmount** — the
 * unmount guard matters, because a dangling batch would silently swallow every
 * later edit into the same history entry.
 *
 * Ending a chain does not remove the walls already committed to it (standard CAD
 * behaviour); it just stops drawing and closes the batch so the whole run
 * collapses to a single undo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';

import type { Vec2 } from '@/core/model/types';
import { formatLength } from '@/lib/units';
import { getEditorState } from '@/store/useEditorStore';

import { PREVIEW_LINE_MATERIAL, PREVIEW_POINT_GEOMETRY, PREVIEW_POINT_MATERIAL } from '../materials';
import { SceneLine } from '../SceneLine';
import { isPickClick } from '../pick';
import { useActiveFloorPlane, useGridSettings, useUnits } from '../hooks';
import { PointerPlane } from './PointerPlane';
import { ToolLabel } from './ToolLabel';
import { useGroundPoint } from './useGroundPoint';

/**
 * Clicks this close to the previous chain point are dropped. This is what makes
 * double-click-to-finish work: the first click of the pair commits a segment and
 * advances the chain, the second lands on the identical snapped point and is
 * ignored, then `dblclick` ends the chain.
 */
const SAME_POINT_EPS = 1e-6;

/**
 * Minimum committed segment length (meters). With every snap turned off, the two
 * clicks of a double-click can land a sub-pixel apart and clear
 * {@link SAME_POINT_EPS}; nobody means to author a sub-millimetre wall, so the
 * degenerate segment is dropped rather than committed.
 */
const MIN_SEGMENT = 1e-3;

/** Preview geometry floats just above the working plane. */
const PREVIEW_LIFT = 0.02;
/** Height of the dimension chip above the working plane. */
const LABEL_LIFT = 0.6;

const ANGLE_STEP = Math.PI / 4;

/** Constrain `to` to a 45° ray from `from`, optionally rounding its length. */
function angleSnap(from: Vec2, to: Vec2, gridSize: number | null): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-9) return { x: from.x, y: from.y };

  const angle = Math.round(Math.atan2(dy, dx) / ANGLE_STEP) * ANGLE_STEP;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Project onto the snapped direction so the pointer's distance is respected.
  let length = dx * cos + dy * sin;
  if (gridSize !== null && gridSize > 0) length = Math.round(length / gridSize) * gridSize;

  return { x: from.x + cos * length, y: from.y + sin * length };
}

export function WallDrawTool() {
  const { elevation, exists } = useActiveFloorPlane();
  const grid = useGridSettings();
  const units = useUnits();
  const ground = useGroundPoint();

  const [chain, setChain] = useState<Vec2 | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);

  /** Mirror of `chain` for event handlers and the unmount guard. */
  const chainRef = useRef<Vec2 | null>(null);
  const batchingRef = useRef(false);

  const setChainPoint = useCallback((point: Vec2 | null) => {
    chainRef.current = point;
    setChain(point);
  }, []);

  const endChain = useCallback(() => {
    if (batchingRef.current) {
      batchingRef.current = false;
      getEditorState().endBatch();
    }
    chainRef.current = null;
    setChain(null);
  }, []);

  /** Full snapping precedence for a raw plane point. */
  const resolve = useCallback(
    (raw: Vec2): Vec2 => {
      const endpoint = ground.endpointSnap(raw);
      if (endpoint) return endpoint;

      const previous = chainRef.current;
      if (previous && grid.angleSnap) {
        return angleSnap(previous, raw, grid.snap ? grid.size : null);
      }
      return ground.gridSnap(raw);
    },
    [ground, grid],
  );

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const raw = ground.rawFromEvent(event);
      if (!raw) return;
      setHover(resolve(raw));
    },
    [ground, resolve],
  );

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      // A camera orbit that started on the plane still ends in a browser
      // `click`; without this the drag would drop a point (see `scene/pick`).
      if (!isPickClick(event)) return;
      const raw = ground.rawFromEvent(event);
      if (!raw) return;
      event.stopPropagation();

      const point = resolve(raw);
      setHover(point);

      const previous = chainRef.current;
      if (!previous) {
        setChainPoint(point);
        return;
      }

      // Drops the second click of a double-click (and any degenerate segment).
      const span = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (span <= SAME_POINT_EPS || span < MIN_SEGMENT) return;

      const store = getEditorState();
      if (!batchingRef.current) {
        batchingRef.current = true;
        store.beginBatch('Draw walls');
      }
      store.addWall(store.activeFloorId, store.drawingWallKind, previous, point);
      setChainPoint(point);
    },
    [ground, resolve, setChainPoint],
  );

  const onDoubleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      endChain();
    },
    [endChain],
  );

  // Keyboard: Escape cancels / exits, Enter ends the chain.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (chainRef.current) endChain();
        else getEditorState().setActiveTool('select');
        return;
      }
      if (event.key === 'Enter' && chainRef.current) {
        event.preventDefault();
        endChain();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [endChain]);

  // A batch left open would absorb every subsequent edit into one undo entry.
  useEffect(
    () => () => {
      if (batchingRef.current) {
        batchingRef.current = false;
        getEditorState().endBatch();
      }
    },
    [],
  );

  if (!exists) return null;

  const previewY = elevation + PREVIEW_LIFT;
  const segment: [number, number, number][] | null =
    chain && hover
      ? [
          [chain.x, previewY, chain.y],
          [hover.x, previewY, hover.y],
        ]
      : null;
  const length = chain && hover ? Math.hypot(hover.x - chain.x, hover.y - chain.y) : 0;

  return (
    <group name="wallDrawTool">
      <PointerPlane
        elevation={elevation}
        onPointerMove={onPointerMove}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      />

      {segment && <SceneLine points={segment} material={PREVIEW_LINE_MATERIAL} />}

      {chain && (
        <mesh
          position={[chain.x, previewY, chain.y]}
          geometry={PREVIEW_POINT_GEOMETRY}
          material={PREVIEW_POINT_MATERIAL}
          renderOrder={25}
        />
      )}

      {hover && (
        <mesh
          position={[hover.x, previewY, hover.y]}
          geometry={PREVIEW_POINT_GEOMETRY}
          material={PREVIEW_POINT_MATERIAL}
          renderOrder={25}
        />
      )}

      {chain && hover && length > 0 && (
        <ToolLabel
          position={[
            (chain.x + hover.x) / 2,
            elevation + LABEL_LIFT,
            (chain.y + hover.y) / 2,
          ]}
        >
          {formatLength(length, units)}
        </ToolLabel>
      )}
    </group>
  );
}
