# Compass Studio

**Proprietary and confidential. © Partners Real Estate. All rights reserved.**
Closed-source commercial product — no part of this codebase is licensed for
redistribution or reuse.

A browser-based 3D editor for commercial office buildings: design, edit,
analyze, and present multi-story office towers in real time with WebGPU
rendering (automatic WebGL2 fallback and device-loss recovery). No install.

## What's in this milestone (M0)

- **Real-time 3D editing** — draw walls (5 wall kinds) with grid/endpoint/angle
  snapping, drag wall endpoints, place doors and windows on walls, edit every
  dimension numerically in the inspector.
- **Commercial hierarchy** — Building → Floors → Slabs / Walls / Openings /
  Columns / Cores / Zones / Furniture, with Tenants (vacancy status, color,
  industry) as first-class records.
- **Floor tools** — add, duplicate (deep-cloned plates), delete, per-floor
  visibility, stack / explode / solo view modes.
- **Area analytics** — live gross / rentable / common / core areas, efficiency
  ratios, and per-tenant square footage, per floor and building-wide.
- **Tenant zoning** — color-code the model by tenant or zone classification.
- **Demo asset** — "Meridian Tower", a deterministic 12-story Class A plate
  with core, tenant suites, and furnished open-plan floors.
- **Undo/redo** — patch-based history for every document edit; drags and wall
  chains coalesce into single steps.
- **Export** — versioned proprietary JSON (the save format), gated by the
  project's export policy. Ownership/collaborator roles and watermark settings
  are modeled now; auth and cloud persistence land in M5.

See `docs/ARCHITECTURE.md` for the architecture, full data model, performance
strategy, and roadmap (M1–M6).

## Development

```bash
cd editor
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

The editor is fully client-side; there are no environment variables and no
backend dependencies in this milestone.

## Stack

Next.js 16 (App Router) · React 19 · React Three Fiber 9 · three.js 0.185
(`WebGPURenderer`) · Zustand 5 + Immer · Tailwind CSS 3 · TypeScript strict.

## Keyboard shortcuts

| Key | Action |
|---|---|
| V / W / M | Select / Wall / Measure tool |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo / redo |
| Delete / Backspace | Delete selection |
| Enter / Escape | Finish / cancel wall chain |
