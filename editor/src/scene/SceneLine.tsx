'use client';

/**
 * A thin, WebGPU-safe polyline primitive.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * drei's `<Line>` is built on three-stdlib's `LineMaterial`, which is a GLSL
 * `ShaderMaterial`. `WebGPURenderer` resolves every material through its node
 * library and has no mapping for `ShaderMaterial`, so a drei `<Line>` logs
 * "Material \"ShaderMaterial\" is not compatible" and falls back to a blank
 * `NodeMaterial`. `THREE.Line` + `LineBasicMaterial` maps cleanly to
 * `LineBasicNodeMaterial` on both the WebGPU and WebGL2 backends, so tool
 * previews use this instead.
 *
 * The position attribute is updated **in place** (growing capacity only when
 * the point count exceeds it), so dragging a wall preview does not allocate a
 * geometry per pointer move.
 */

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** Line previews are decoration; they must never intercept a pick. */
const NO_RAYCAST = () => null;

export interface SceneLineProps {
  /** World-space points, in order. Fewer than two points renders nothing. */
  points: readonly (readonly [number, number, number])[];
  /** A shared material from `scene/materials`. Never disposed here. */
  material: THREE.Material;
  renderOrder?: number;
}

export function SceneLine({ points, material, renderOrder = 20 }: SceneLineProps) {
  const invalidate = useThree((state) => state.invalidate);

  const line = useMemo(() => {
    const object = new THREE.Line(new THREE.BufferGeometry(), material);
    // The attribute is over-allocated and draw-range clipped, so the computed
    // bounds cannot be trusted for culling.
    object.frustumCulled = false;
    return object;
  }, [material]);

  useEffect(() => {
    const geometry = line.geometry;
    return () => geometry.dispose();
  }, [line]);

  // Intentionally dependency-free: `points` is a fresh array on every render of
  // the owning tool, and writing into the existing buffer is cheaper than
  // diffing it.
  useEffect(() => {
    const geometry = line.geometry;
    const count = points.length;
    const existing = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;

    let attribute = existing;
    if (!attribute || attribute.count < count) {
      attribute = new THREE.BufferAttribute(new Float32Array(Math.max(count, 2) * 3), 3);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', attribute);
    }

    const array = attribute.array as Float32Array;
    for (let index = 0; index < count; index += 1) {
      const point = points[index]!;
      array[index * 3] = point[0];
      array[index * 3 + 1] = point[1];
      array[index * 3 + 2] = point[2];
    }
    attribute.needsUpdate = true;
    geometry.setDrawRange(0, count >= 2 ? count : 0);
    invalidate();
  });

  return <primitive object={line} renderOrder={renderOrder} raycast={NO_RAYCAST} />;
}
