'use client';

/**
 * The 3D viewport: an R3F canvas driving `WebGPURenderer`.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Fills its parent (the shell gives it a sized flex cell) and owns nothing but
 * the renderer, the camera and the backend badge — the scene graph lives in
 * `SceneRoot`.
 *
 * ## WebGPU (ARCHITECTURE §6)
 * `extend(THREE)` is called at module scope with the `three/webgpu` namespace so
 * the JSX catalogue carries the node-capable classes. The `gl` prop is an async
 * factory: R3F v9 awaits it, which is what lets `renderer.init()` complete
 * before the first frame. `WebGPURenderer` silently falls back to a WebGL2
 * backend when `navigator.gpu` is unavailable, so one code path serves both and
 * the badge reports which one won.
 *
 * `three/webgpu` and `three` are separate bundles but both re-export the same
 * `three.core.js` instance, so geometry built by `core/geometry/*` (which
 * imports plain `three`) is the *same* `BufferGeometry` class the renderer
 * expects. Materials must stay classic (`MeshStandardMaterial` &c.) or
 * node-based — never raw `ShaderMaterial`, which the node builder cannot
 * compile. See `scene/materials.ts`.
 *
 * ## Frame loop
 * `frameloop="demand"` — the GPU idles unless the camera moves or the document
 * changes (ARCHITECTURE §7.2). `SceneRoot` wires document mutations to
 * `invalidate()`; drei's `OrbitControls` wires camera motion.
 */

import { useCallback, useEffect, useState } from 'react';
import { Canvas, extend, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';

import { getEditorState } from '@/store/useEditorStore';

import { SceneRoot } from './SceneRoot';
import { BACKGROUND_COLOR } from './materials';
import { installWebGpuCompat } from './webgpuCompat';

extend(THREE as unknown as Parameters<typeof extend>[0]);

type Backend = 'webgpu' | 'webgl2';

/**
 * The renderer's `backend` is not part of R3F's `WebGLRenderer`-shaped `gl`
 * type, so it is read through a narrow structural cast rather than `any`.
 * `device` is the GPUDevice on the WebGPU backend (absent on WebGL2); its
 * `lost` promise is typed structurally to avoid a @webgpu/types dependency.
 */
interface BackendProbeShape {
  backend?: {
    isWebGPUBackend?: boolean;
    device?: { lost?: Promise<{ reason?: string; message?: string }> } | null;
  } | null;
}

/** Backend badge, bottom-right. Inline-styled so it needs no CSS build step. */
const BADGE_STYLE: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  bottom: 8,
  pointerEvents: 'none',
  userSelect: 'none',
  padding: '3px 7px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(4px)',
  color: '#c8cedb',
  font: '500 10px/1.2 ui-sans-serif, system-ui, sans-serif',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

function BackendProbe({ onResolve }: { onResolve: (backend: Backend) => void }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const probe = gl as unknown as BackendProbeShape;
    const isWebGPU = probe.backend?.isWebGPUBackend === true;
    onResolve(isWebGPU ? 'webgpu' : 'webgl2');
  }, [gl, onResolve]);

  return null;
}

export function EditorCanvas() {
  const [backend, setBackend] = useState<Backend | null>(null);

  /**
   * Bumped when the GPU device is lost outside of normal teardown. A WebGPU
   * device can die at any time (driver reset, GPU process crash, software
   * adapters in constrained environments) and `WebGPURenderer` has no
   * recovery path, leaving a permanently black viewport. Changing the Canvas
   * `key` tears the renderer down and recreates it — on WebGL2, which cannot
   * suffer WebGPU device loss again.
   */
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const forceWebGL = rendererGeneration > 0;

  const onResolveBackend = useCallback((next: Backend) => setBackend(next), []);

  /** Clicking empty space clears the selection — but only while picking. */
  const onPointerMissed = useCallback(() => {
    const store = getEditorState();
    if (store.activeTool !== 'select') return;
    if (store.selection) store.clearSelection();
  }, []);

  return (
    // Inline rather than Tailwind so the viewport fills its flex cell even if a
    // consumer drops this into an unstyled tree.
    <div style={{ position: 'relative', width: '100%', height: '100%', background: BACKGROUND_COLOR }}>
      <Canvas
        key={rendererGeneration}
        frameloop="demand"
        shadows={false}
        dpr={[1, 2]}
        camera={{ position: [70, 55, 70], fov: 45, near: 0.1, far: 2000 }}
        onPointerMissed={onPointerMissed}
        gl={async (props) => {
          installWebGpuCompat();
          const renderer = new THREE.WebGPURenderer({
            ...(props as object),
            antialias: true,
            forceWebGL,
          });
          await renderer.init();

          // `reason: 'destroyed'` is deliberate teardown (unmount/tab close);
          // anything else is an unexpected loss worth recovering from.
          const device = (renderer as unknown as BackendProbeShape).backend?.device;
          device?.lost?.then((info) => {
            if (info?.reason === 'destroyed') return;
            console.warn(
              `Compass Studio: WebGPU device lost (${info?.message ?? 'no message'}) — restarting renderer on WebGL2.`,
            );
            setRendererGeneration((generation) => generation + 1);
          });

          return renderer;
        }}
      >
        <color attach="background" args={[BACKGROUND_COLOR]} />
        <BackendProbe onResolve={onResolveBackend} />
        <SceneRoot />
      </Canvas>

      {backend !== null && (
        <div
          style={BADGE_STYLE}
          title={
            backend === 'webgpu'
              ? 'Rendering through the WebGPU backend'
              : forceWebGL
                ? 'WebGPU device was lost — renderer restarted on WebGL2'
                : 'navigator.gpu unavailable — WebGPURenderer fell back to WebGL2'
          }
        >
          {backend === 'webgpu' ? 'WebGPU' : 'WebGL2 fallback'}
        </div>
      )}
    </div>
  );
}
