'use client';

/**
 * The invisible pointer-catcher for plane-based tools.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * `visible={false}` would remove the mesh from raycasting entirely (three bails
 * out of `Mesh.raycast` for invisible objects), so the plane stays *visible* and
 * is made to draw nothing by a fully transparent material — three's raycaster
 * never consults material opacity. That is the only reliable way to get a
 * full-viewport pick target in R3F.
 *
 * The plane is huge (kilometres) so a shallow, near-horizon camera angle still
 * has something to hit out at the edges of the view.
 */

import type { ThreeEvent } from '@react-three/fiber';

import { PICK_PLANE_MATERIAL } from '../materials';

export interface PointerPlaneProps {
  /** World Y of the plane. */
  elevation: number;
  /** Edge length in meters. */
  size?: number;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  onDoubleClick?: (event: ThreeEvent<MouseEvent>) => void;
}

export function PointerPlane({
  elevation,
  size = 4000,
  onPointerMove,
  onPointerDown,
  onClick,
  onDoubleClick,
}: PointerPlaneProps) {
  return (
    <mesh
      position={[0, elevation, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={PICK_PLANE_MATERIAL}
      frustumCulled={false}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}
