'use client';

/**
 * Two-click distance measurement on the active floor's plane.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Mounted only while `activeTool === 'measure'`. Entirely local UI state —
 * measurements are an inspection aid, never part of the document, so nothing
 * here touches the store or the undo history.
 *
 * Click 1 sets the origin, click 2 locks the measurement, click 3 starts a new
 * one. Escape clears.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';

import type { Vec2 } from '@/core/model/types';
import { formatLength } from '@/lib/units';

import { MEASURE_LINE_MATERIAL, MEASURE_POINT_MATERIAL, PREVIEW_POINT_GEOMETRY } from '../materials';
import { SceneLine } from '../SceneLine';
import { isPickClick } from '../pick';
import { useActiveFloorPlane, useUnits } from '../hooks';
import { PointerPlane } from './PointerPlane';
import { ToolLabel } from './ToolLabel';
import { useGroundPoint } from './useGroundPoint';

const PREVIEW_LIFT = 0.02;
const LABEL_LIFT = 0.6;

export function MeasureTool() {
  const { elevation, exists } = useActiveFloorPlane();
  const units = useUnits();
  const ground = useGroundPoint();

  const [from, setFrom] = useState<Vec2 | null>(null);
  const [to, setTo] = useState<Vec2 | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);

  // Mirrors for the keydown listener, which must not be re-bound per click.
  const fromRef = useRef<Vec2 | null>(null);
  const toRef = useRef<Vec2 | null>(null);

  const clear = useCallback(() => {
    fromRef.current = null;
    toRef.current = null;
    setFrom(null);
    setTo(null);
  }, []);

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const point = ground.fromEvent(event);
      if (point) setHover(point);
    },
    [ground],
  );

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      // Ignore the click a camera orbit leaves behind (see `scene/pick`).
      if (!isPickClick(event)) return;
      const point = ground.fromEvent(event);
      if (!point) return;
      event.stopPropagation();
      setHover(point);

      if (!fromRef.current || toRef.current) {
        // Nothing started, or the previous measurement is complete → restart.
        fromRef.current = point;
        toRef.current = null;
        setFrom(point);
        setTo(null);
        return;
      }
      toRef.current = point;
      setTo(point);
    },
    [ground],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      clear();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clear]);

  if (!exists) return null;

  const previewY = elevation + PREVIEW_LIFT;
  const target = to ?? hover;
  const segment: [number, number, number][] | null =
    from && target
      ? [
          [from.x, previewY, from.y],
          [target.x, previewY, target.y],
        ]
      : null;
  const distance = from && target ? Math.hypot(target.x - from.x, target.y - from.y) : 0;

  return (
    <group name="measureTool">
      <PointerPlane elevation={elevation} onPointerMove={onPointerMove} onClick={onClick} />

      {segment && <SceneLine points={segment} material={MEASURE_LINE_MATERIAL} />}

      {from && (
        <mesh
          position={[from.x, previewY, from.y]}
          geometry={PREVIEW_POINT_GEOMETRY}
          material={MEASURE_POINT_MATERIAL}
          renderOrder={25}
        />
      )}

      {target && (
        <mesh
          position={[target.x, previewY, target.y]}
          geometry={PREVIEW_POINT_GEOMETRY}
          material={MEASURE_POINT_MATERIAL}
          renderOrder={25}
        />
      )}

      {from && target && distance > 0 && (
        <ToolLabel
          position={[
            (from.x + target.x) / 2,
            elevation + LABEL_LIFT,
            (from.y + target.y) / 2,
          ]}
        >
          {formatLength(distance, units)}
        </ToolLabel>
      )}
    </group>
  );
}
