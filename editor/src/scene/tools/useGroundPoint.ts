'use client';

/**
 * Pointer → active-floor plane intersection, with snapping.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * All authoring happens on the **active floor's working plane**: the horizontal
 * plane at that floor's *display* elevation, so drawing keeps working in explode
 * and solo modes where a floor is not at its authored elevation.
 *
 * Snapping precedence (highest first):
 *  1. **Endpoint snap** — within {@link ENDPOINT_SNAP_RADIUS} of an existing
 *     wall endpoint on the active floor, return that endpoint exactly. Walls
 *     that are meant to meet must meet, so this always beats the grid.
 *  2. **Grid snap** — `settings.grid.snap` rounds to `settings.grid.size`.
 *  3. Raw plane intersection.
 *
 * Angle snapping is *not* here: it needs the previous point of a chain, which
 * only the drawing tool knows (see `WallDrawTool`).
 *
 * Wall endpoints are read imperatively from the store on each call rather than
 * subscribed to — a tool that re-rendered on every wall edit would defeat
 * ARCHITECTURE §2.
 */

import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { FloorId, ProjectSettings, Vec2 } from '@/core/model/types';
import { findFloor } from '@/store/selectors';
import { getEditorState } from '@/store/useEditorStore';

import { useActiveFloorElevation, useGridSettings } from '../hooks';

/** Pointer distance (meters, in plan) within which an endpoint captures. */
export const ENDPOINT_SNAP_RADIUS = 0.35;

/** Scratch objects — the scene layer is single-threaded, so reuse is safe. */
const RAYCASTER = new THREE.Raycaster();
const NDC = new THREE.Vector2();
const HIT = new THREE.Vector3();

export interface GroundPoint {
  /** World Y of the plane every method projects onto. */
  readonly elevation: number;

  /** R3F pointer event → snapped plan point. */
  fromEvent(event: { ray: THREE.Ray }): Vec2 | null;
  /** Viewport pixel coordinates (`clientX`/`clientY`) → snapped plan point. */
  fromClient(clientX: number, clientY: number): Vec2 | null;
  /** Normalized device coordinates + camera → snapped plan point. */
  fromNdc(ndc: THREE.Vector2, camera: THREE.Camera): Vec2 | null;

  /** Unsnapped variants, for callers that apply their own constraint first. */
  rawFromEvent(event: { ray: THREE.Ray }): Vec2 | null;
  rawFromClient(clientX: number, clientY: number): Vec2 | null;

  /** Apply the full snapping precedence to an already-projected plan point. */
  snap(point: Vec2): Vec2;
  /** Grid rounding only. */
  gridSnap(point: Vec2): Vec2;
  /** The captured wall endpoint near `point`, or null. */
  endpointSnap(point: Vec2): Vec2 | null;
}

function intersect(ray: THREE.Ray, elevation: number): Vec2 | null {
  // Plane(normal, constant) satisfies normal·p + constant = 0, so a horizontal
  // plane at y = elevation has constant = −elevation.
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -elevation);
  const hit = ray.intersectPlane(plane, HIT);
  if (!hit) return null;
  // Plan y is world z.
  return { x: hit.x, y: hit.z };
}

export interface GroundPointParams {
  /** World Y of the plane to project onto. */
  elevation: number;
  /**
   * Which floor's wall endpoints participate in endpoint snapping. Defaults to
   * whatever floor is active at call time.
   */
  floorId?: FloorId | undefined;
  camera: THREE.Camera;
  domElement: HTMLCanvasElement;
  grid: ProjectSettings['grid'];
}

/**
 * Build a projector without touching React. Per-entity editors (an endpoint
 * drag on one of six thousand walls) call this **at interaction time** so they
 * do not each carry a store subscription just to know where a plane is —
 * see `WallMesh`.
 */
export function createGroundPoint(params: GroundPointParams): GroundPoint {
  const { elevation, floorId, camera, domElement, grid } = params;

  const gridSnap = (point: Vec2): Vec2 => {
    if (!grid.snap || !(grid.size > 0)) return point;
    return {
      x: Math.round(point.x / grid.size) * grid.size,
      y: Math.round(point.y / grid.size) * grid.size,
    };
  };

  const endpointSnap = (point: Vec2): Vec2 | null => {
    const state = getEditorState();
    const floor = findFloor(state.project, floorId ?? state.activeFloorId);
    if (!floor) return null;

    let best: Vec2 | null = null;
    let bestDistance = ENDPOINT_SNAP_RADIUS;
    for (const wall of floor.walls) {
      for (const endpoint of [wall.start, wall.end]) {
        const distance = Math.hypot(endpoint.x - point.x, endpoint.y - point.y);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { x: endpoint.x, y: endpoint.y };
        }
      }
    }
    return best;
  };

  const snap = (point: Vec2): Vec2 => endpointSnap(point) ?? gridSnap(point);

  const rawFromNdc = (ndc: THREE.Vector2, cam: THREE.Camera): Vec2 | null => {
    RAYCASTER.setFromCamera(ndc, cam);
    return intersect(RAYCASTER.ray, elevation);
  };

  const rawFromClient = (clientX: number, clientY: number): Vec2 | null => {
    const rect = domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    NDC.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    return rawFromNdc(NDC, camera);
  };

  const rawFromEvent = (event: { ray: THREE.Ray }): Vec2 | null =>
    intersect(event.ray, elevation);

  return {
    elevation,
    gridSnap,
    endpointSnap,
    snap,
    rawFromEvent,
    rawFromClient,
    fromEvent: (event) => {
      const raw = rawFromEvent(event);
      return raw ? snap(raw) : null;
    },
    fromClient: (clientX, clientY) => {
      const raw = rawFromClient(clientX, clientY);
      return raw ? snap(raw) : null;
    },
    fromNdc: (ndc, cam) => {
      const raw = rawFromNdc(ndc, cam);
      return raw ? snap(raw) : null;
    },
  };
}

export interface GroundPointOptions {
  /** Plane elevation override; defaults to the active floor's. */
  elevation?: number;
  /** Endpoint-snap floor override; defaults to the active floor. */
  floorId?: FloorId;
}

/**
 * The reactive projector for the *tools*, which are single-instance and do want
 * to re-render when the working plane or the grid settings move.
 */
export function useGroundPoint(options?: GroundPointOptions): GroundPoint {
  const activeElevation = useActiveFloorElevation();
  const grid = useGridSettings();
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);

  const elevation = options?.elevation ?? activeElevation;
  const snapFloorId = options?.floorId;

  return useMemo<GroundPoint>(
    () =>
      createGroundPoint({
        elevation,
        floorId: snapFloorId,
        camera,
        domElement,
        grid,
      }),
    [elevation, snapFloorId, grid, camera, domElement],
  );
}
