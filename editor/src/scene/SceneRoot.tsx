'use client';

/**
 * Everything inside the canvas: lights, ground, grid, building, tools, camera.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Lighting is deliberately minimal — one hemisphere fill plus one directional
 * key, no shadows. A 40-story tower is ~6k meshes; shadow maps would cost more
 * than they add to a schematic massing/plan view, and `frameloop="demand"` means
 * the lighting is only ever evaluated when something actually changes.
 *
 * The reference grid tracks the **active floor's** display elevation so the
 * drawing plane is always visible, including in explode and solo modes.
 */

import { useEditorStore } from '@/store/useEditorStore';

import { BuildingGroup } from './BuildingGroup';
import { ReferenceGrid } from './ReferenceGrid';
import { CameraRig } from './controls/CameraRig';
import { GROUND_MATERIAL } from './materials';
import { useActiveFloorElevation, useInvalidateOnDocumentChange } from './hooks';
import { MeasureTool } from './tools/MeasureTool';
import { WallDrawTool } from './tools/WallDrawTool';

/** The ground is scenery: it must never absorb a selection pick. */
const NO_RAYCAST = () => null;

export function SceneRoot() {
  useInvalidateOnDocumentChange();

  const activeTool = useEditorStore((state) => state.activeTool);
  const gridElevation = useActiveFloorElevation();

  return (
    <>
      <hemisphereLight args={['#dfe6f2', '#1b1f27', 0.6]} />
      <directionalLight position={[80, 120, 60]} intensity={1.2} />

      {/*
        A large dark disc so the tower reads as sitting on something rather than
        floating in a void. Just below y = 0 to stay clear of the ground floor's
        slab, and non-pickable via `raycast`.
      */}
      <mesh
        position={[0, -0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={GROUND_MATERIAL}
        raycast={NO_RAYCAST}
      >
        <circleGeometry args={[700, 96]} />
      </mesh>

      <ReferenceGrid elevation={gridElevation} />

      <BuildingGroup />

      {activeTool === 'wall' && <WallDrawTool />}
      {activeTool === 'measure' && <MeasureTool />}

      <CameraRig />
    </>
  );
}
