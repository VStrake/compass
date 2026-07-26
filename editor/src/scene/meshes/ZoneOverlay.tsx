'use client';

/**
 * One commercial zone, drawn as a flat colour wash over the slab.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Zones are the commercial reading of a plate (tenant suites, common,
 * circulation, core…), so their colour is driven by `colorMode` rather than by
 * anything in the document. There are only a handful per floor, which is why a
 * per-zone material **clone** is acceptable here where it would not be for
 * walls: it buys per-tenant colour for a negligible number of extra pipelines.
 * The clone is disposed whenever its inputs change.
 */

import { memo, useCallback, useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';

import { buildZoneGeometry } from '@/core/geometry/zone';
import type { FloorId, ZoneId } from '@/core/model/types';
import { findZone } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';

import {
  SELECTION_OVERLAY_MATERIAL,
  createZoneMaterial,
  zoneColorFor,
  zoneOpacityFor,
} from '../materials';
import { useIsSelected } from '../hooks';
import { pickEntity } from '../pick';

/** Lift above the slab top so the overlay never z-fights the concrete. */
const OVERLAY_Y = 0.03;

export interface ZoneOverlayProps {
  floorId: FloorId;
  zoneId: ZoneId;
}

function ZoneOverlayImpl({ floorId, zoneId }: ZoneOverlayProps) {
  const zone = useEditorStore((state) => findZone(state.project, floorId, zoneId));
  const selected = useIsSelected('zone', zoneId);

  // The overlay colour collapses zone kind + tenant + colour mode down to a
  // single hex string, so a tenant recolour repaints without rebuilding
  // geometry and an unrelated document edit changes nothing.
  const color = useEditorStore((state) => {
    const current = findZone(state.project, floorId, zoneId);
    return current ? zoneColorFor(current, state.project.tenants, state.colorMode) : '#000000';
  });
  const opacity = useEditorStore((state) => zoneOpacityFor(state.colorMode));

  const geometry = useMemo(
    () => (zone ? buildZoneGeometry(zone.outline) : null),
    [zone],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const material = useMemo(() => createZoneMaterial(color, opacity), [color, opacity]);
  useEffect(() => () => material.dispose(), [material]);

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => pickEntity(event, 'zone', zoneId, floorId),
    [floorId, zoneId],
  );

  if (!zone || !geometry) return null;

  return (
    <mesh
      position={[0, OVERLAY_Y, 0]}
      geometry={geometry}
      material={selected ? SELECTION_OVERLAY_MATERIAL : material}
      renderOrder={1}
      onClick={onClick}
    />
  );
}

export const ZoneOverlay = memo(ZoneOverlayImpl);
