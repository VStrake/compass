'use client';

/**
 * Orbit camera. Walk mode lands in roadmap M4.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * ## Damping under `frameloop="demand"`
 * Inertial damping needs frames *after* the pointer is released. drei's
 * `<OrbitControls>` already wires this: it subscribes to the controls' `change`
 * event and calls `invalidate()`, and it runs `controls.update()` from a
 * `useFrame` at priority −1. Each damped update fires `change`, which requests
 * the next frame, so the orbit coasts to a stop and then the loop goes quiet
 * again. Nothing extra is needed here — but note that this only holds because
 * `makeDefault` keeps a single controls instance in R3F state.
 *
 * ## Floor retargeting
 * Switching the active floor rides the orbit pivot up/down to that floor's
 * eye level. The camera position is translated by the same delta as the target,
 * so the viewing angle and distance are preserved — it reads as an elevator
 * rather than as a camera swing. The tween drives itself by calling
 * `invalidate()` each step, since a demand loop would otherwise stop after one
 * frame.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type * as THREE from 'three';

import { useActiveFloorPlane } from '../hooks';

/** Eye level above the slab that the pivot settles at. */
const EYE_FRACTION = 0.5;
/** Fallback pivot height for a floor with no height (shouldn't happen). */
const DEFAULT_PIVOT_Y = 10;
/** Tween rate: fraction of the remaining distance consumed per 1/60 s. */
const TWEEN_RATE = 0.16;
/** Below this the tween snaps and stops requesting frames. */
const TWEEN_EPSILON = 0.01;
/**
 * Hoisted so the reference is stable: R3F re-applies a prop whose value changed,
 * and a fresh array literal each render would stomp the tweened target.
 */
const INITIAL_TARGET: [number, number, number] = [0, DEFAULT_PIVOT_Y, 0];

/**
 * The subset of three-stdlib's `OrbitControls` this file touches. Declared
 * locally so `scene/` never imports `three-stdlib` (a transitive dependency of
 * drei, not a direct dependency of this app).
 */
interface OrbitControlsLike {
  target: THREE.Vector3;
  update(): unknown;
}

function isOrbitLike(value: unknown): value is OrbitControlsLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'target' in value &&
    typeof (value as { update?: unknown }).update === 'function'
  );
}

export function CameraRig() {
  const controls = useThree((state) => state.controls);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const { floorId, elevation, height, exists } = useActiveFloorPlane();

  /** Pivot height we are tweening toward, or null when settled. */
  const desiredYRef = useRef<number | null>(null);
  /** Guards the very first retarget so the initial view is not animated. */
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!exists) return;
    // `makeDefault` publishes the controls in an effect, so the first pass here
    // may see null; the dep on `controls` brings us back once it exists.
    const orbit = isOrbitLike(controls) ? controls : null;
    if (!orbit) return;

    const desired = elevation + height * EYE_FRACTION;

    if (!initializedRef.current) {
      initializedRef.current = true;
      // Jump straight there on first resolve — no tween on load.
      const delta = desired - orbit.target.y;
      orbit.target.y = desired;
      camera.position.y += delta;
      orbit.update();
      invalidate();
      return;
    }

    desiredYRef.current = desired;
    invalidate();
    // `floorId` is in the dep list so re-selecting the same elevation on a
    // different floor still retargets.
  }, [floorId, elevation, height, exists, controls, camera, invalidate]);

  useFrame((_state, delta) => {
    const desired = desiredYRef.current;
    if (desired === null) return;

    const orbit = isOrbitLike(controls) ? controls : null;
    if (!orbit) {
      desiredYRef.current = null;
      return;
    }

    const remaining = desired - orbit.target.y;
    if (Math.abs(remaining) < TWEEN_EPSILON) {
      camera.position.y += remaining;
      orbit.target.y = desired;
      orbit.update();
      desiredYRef.current = null;
      invalidate();
      return;
    }

    // Frame-rate independent exponential approach.
    const step = remaining * (1 - Math.pow(1 - TWEEN_RATE, Math.min(delta, 0.1) * 60));
    orbit.target.y += step;
    camera.position.y += step;
    orbit.update();
    invalidate();
  });

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      target={INITIAL_TARGET}
      minDistance={2}
      maxDistance={900}
      // Allow a shallow look from just below the horizon without ever getting
      // under the ground plane.
      maxPolarAngle={Math.PI / 2 + 0.18}
      // Panning in screen space keeps a plan-like feel when zoomed in.
      screenSpacePanning
    />
  );
}
