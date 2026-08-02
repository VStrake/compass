'use client';

/**
 * A small DOM chip anchored to a world position — used for live dimensions.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * drei's `<Html>` is pure DOM (no shader material) as long as `occlude` is left
 * off, so it is safe under `WebGPURenderer`. Pointer events are disabled on the
 * chip: a label must never swallow the click that is about to place a point.
 */

import { Html } from '@react-three/drei';

const CHIP_STYLE: React.CSSProperties = {
  pointerEvents: 'none',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(12,14,18,0.82)',
  color: '#f3f4f6',
  font: '500 11px/1.3 ui-sans-serif, system-ui, sans-serif',
  letterSpacing: '0.02em',
};

export interface ToolLabelProps {
  position: [number, number, number];
  children: React.ReactNode;
}

export function ToolLabel({ position, children }: ToolLabelProps) {
  return (
    <Html position={position} center pointerEvents="none" zIndexRange={[10, 0]}>
      <div style={CHIP_STYLE}>{children}</div>
    </Html>
  );
}
