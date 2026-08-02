'use client';

/**
 * The imported source plan, pinned flat under the plate (M1.5, ARCHITECTURE §8.4).
 * Proprietary and confidential. © Partners Real Estate.
 *
 * A single unlit, semi-transparent quad carrying the scan as a texture, so the
 * imported geometry can be checked against the drawing it came from. Unlit
 * (`MeshBasicMaterial`) is deliberate: the underlay should read as paper laid on
 * the slab, not as a surface being lit by the scene.
 *
 * ## Placement
 * The plane is authored in its local XY, rotated −90° about X (its local +Y
 * therefore points at world −Z, which is exactly where frame/plan −y lives — see
 * the frame → plan mapping note in `core/import/extraction.ts`), and the whole
 * thing is spun about world +Y by `underlay.rotation` through a parent group, so
 * the rotation convention matches `FurnitureInstance.rotation`.
 *
 * It sits at y = {@link UNDERLAY_Y}: above the slab top (y = 0) and below the
 * zone overlays (y = 0.03 in `ZoneOverlay`), so the commercial colour wash still
 * paints over the scan.
 *
 * ## Non-interactive
 * The quad is invisible to the raycaster (`raycast`), so it can never swallow a
 * click meant for a wall or a zone, and it is not selectable.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { FloorId } from '@/core/model/types';
import { findFloor } from '@/store/selectors';
import { useEditorStore } from '@/store/useEditorStore';

/** Just above the slab top, below `ZoneOverlay`'s 0.03. */
export const UNDERLAY_Y = 0.015;

const NO_RAYCAST = () => null;

export interface UnderlayMeshProps {
  floorId: FloorId;
}

function UnderlayMeshImpl({ floorId }: UnderlayMeshProps) {
  // Narrow subscription: only this floor's underlay object. Immer keeps its
  // identity stable until the underlay itself is edited (ARCHITECTURE §2).
  const underlay = useEditorStore((state) => findFloor(state.project, floorId)?.underlay ?? null);
  const invalidate = useThree((state) => state.invalidate);

  const imageDataUrl = underlay?.imageDataUrl ?? null;
  const opacity = underlay?.opacity ?? 1;

  // `frameloop="demand"` means nothing draws while the texture decodes, so the
  // load callback has to ask for a frame — otherwise the plan only appears on
  // the next unrelated interaction.
  const [decodedUrl, setDecodedUrl] = useState<string | null>(null);

  const texture = useMemo(() => {
    if (!imageDataUrl) return null;
    const loaded = new THREE.TextureLoader().load(imageDataUrl, () => {
      setDecodedUrl(imageDataUrl);
      invalidate();
    });
    loaded.colorSpace = THREE.SRGBColorSpace;
    // Scans are viewed obliquely; anisotropy is not worth the memory here, but
    // clamping avoids a wrapped edge sliver on non-power-of-two images.
    loaded.wrapS = THREE.ClampToEdgeWrapping;
    loaded.wrapT = THREE.ClampToEdgeWrapping;
    return loaded;
  }, [imageDataUrl, invalidate]);
  useEffect(() => () => texture?.dispose(), [texture]);

  const width = (underlay?.imageWidth ?? 0) * (underlay?.metersPerPixel ?? 0);
  const height = (underlay?.imageHeight ?? 0) * (underlay?.metersPerPixel ?? 0);
  const validSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

  const geometry = useMemo(
    () => (validSize ? new THREE.PlaneGeometry(width, height) : null),
    [validSize, width, height],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);

  const material = useMemo(() => {
    if (!texture) return null;
    return new THREE.MeshBasicMaterial({
      name: 'compass/underlay',
      map: texture,
      transparent: true,
      opacity: Math.min(Math.max(opacity, 0), 1),
      // Flat reference art must never occlude the model it is being checked
      // against, so it writes colour only.
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }, [texture, opacity]);
  useEffect(() => () => material?.dispose(), [material]);

  if (!underlay || !underlay.visible) return null;
  if (!geometry || !material || !texture) return null;
  // Hold the quad back until the bitmap has decoded; an undecoded texture would
  // flash as a black rectangle over the plate.
  if (decodedUrl !== imageDataUrl) return null;

  return (
    <group position={[underlay.offset.x, UNDERLAY_Y, underlay.offset.y]} rotation={[0, underlay.rotation, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={geometry}
        material={material}
        raycast={NO_RAYCAST}
      />
    </group>
  );
}

export const UnderlayMesh = memo(UnderlayMeshImpl);
