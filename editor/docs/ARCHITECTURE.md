# Compass Studio — Architecture

**Proprietary and confidential. © Partners Real Estate. All rights reserved.**
This codebase is a closed-source commercial product. No part of it is licensed for
redistribution. Do not add open-source license files. `package.json` is marked
`"private": true` with `"license": "UNLICENSED"`.

Compass Studio is a browser-based 3D editor for commercial office buildings:
architects, brokers, developers, and property managers design, edit, analyze, and
present multi-story office buildings in real time, with no install, targeting
near-native GPU performance via WebGPU.

---

## 1. Technical stack (pinned)

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Framework | Next.js (App Router) | ^16 | Editor route is fully client-side (`ssr: false` dynamic import) |
| UI | React | ^19 | |
| 3D | three.js | ^0.185 | Import from `three/webgpu`; `WebGPURenderer` auto-falls back to WebGL2 |
| 3D React | @react-three/fiber | ^9 | Async `gl` factory to init WebGPU |
| 3D helpers | @react-three/drei | ^10 | Minimal usage: controls, Html overlays |
| State | zustand | ^5 | Single store, immer-patch undo/redo |
| Immutability | immer | ^10 | `produceWithPatches` powers history |
| Styling | Tailwind CSS | ^3.4 | Matches the wider repo's convention |
| Language | TypeScript strict | ^5 | Branded ID types, no `any` in the model |

The app lives in `editor/` and is self-contained (own `package.json`); it shares the
repository with the Compass wayfinding tool but nothing else.

## 2. High-level architecture

Three cleanly separated layers. Dependencies point downward only.

```
┌────────────────────────────────────────────────────────────┐
│  UI layer (React DOM)                                      │
│  Toolbar · Hierarchy panel · Properties panel · Area panel │
└──────────────▲─────────────────────────────▲───────────────┘
               │ selectors (fine-grained)    │ actions/commands
┌──────────────┴─────────────────────────────┴───────────────┐
│  State layer (zustand)                                     │
│  ProjectDoc (undoable, immer patches)  ·  EditorUI state   │
│  History (patch/inverse-patch stacks, drag batching)       │
└──────────────▲─────────────────────────────▲───────────────┘
               │ per-entity subscriptions    │ tool events
┌──────────────┴─────────────────────────────┴───────────────┐
│  Scene layer (React Three Fiber + WebGPU)                  │
│  EditorCanvas → BuildingGroup → FloorGroup → entity meshes │
│  Tools (wall draw, select) · geometry builders (pure)      │
└────────────────────────────────────────────────────────────┘
```

### ECS-style decomposition

The document is the **entity** store (typed records keyed by branded IDs). Pure
**geometry systems** (`core/geometry/*`) transform entity data into
`BufferGeometry`. **Rendering components** are thin: one React component per
entity subscribes to exactly its entity object and memoizes the geometry build on
that object's identity. Because immer only replaces objects along a mutated path,
object identity doubles as a **dirty flag**: an unchanged wall keeps its object
reference, its selector returns the same value, React skips the component, and the
GPU keeps the cached geometry. That gives selective/dirty-node re-rendering with
zero bookkeeping.

### Selective rendering rules

1. Every scene component (`WallMesh`, `SlabMesh`, …) subscribes with
   `useEditorStore(s => findX(s.project, id))` — never to whole floors/building.
2. Geometry is built inside `useMemo(..., [entityObject])`.
3. `<Canvas frameloop="demand">`; controls and store mutations call `invalidate()`.
4. During drags, transient positions go through UI state or direct object mutation
   + `invalidate()`, and only the final result is committed to the document (one
   undo step, one geometry rebuild path).

## 3. Folder structure

```
editor/
  docs/ARCHITECTURE.md          this file (architecture, data model, roadmap)
  package.json                  private, UNLICENSED
  next.config.mjs               transpilePackages: ['three']
  tsconfig.json                 strict
  tailwind.config.ts, postcss.config.js
  src/
    app/
      layout.tsx                root layout, metadata, globals.css
      page.tsx                  loads the editor client-side (ssr: false)
      globals.css
    core/                       framework-free domain logic (pure TS, no React)
      model/
        types.ts                THE data model (section 4)
        ids.ts                  branded ID factory (newId<K>())
        factories.ts            create* helpers, defaults, floor-plate templates
        demo.ts                 seeded demo tower (Class A plate, tenants, furniture)
        catalog.ts              proprietary furniture/fixture catalog definitions
      geometry/
        wall.ts                 wall solid w/ openings (segment splitting, no CSG)
        slab.ts                 slab prism from outline + holes (Shape/extrude)
        zone.ts                 flat zone overlay polygons
        furniture.ts            parametric primitives per catalog item
        polygon.ts              shoelace area, point-in-poly, centroid
      analysis/
        area.ts                 gross/rentable/common per floor + building rollup,
                                efficiency ratios, tenant square-footage report
      export/
        projectJson.ts          proprietary JSON export/import (schemaVersion’d)
    store/
      useEditorStore.ts         zustand store: project + ui + actions
      history.ts                patch-based undo/redo + drag batching
      selectors.ts              findFloor/findWall/... + memo helpers
    scene/
      EditorCanvas.tsx          R3F Canvas with WebGPURenderer init
      SceneRoot.tsx             lights, grid, building, tools, controls
      BuildingGroup.tsx         maps floors → FloorGroup, stack/explode/solo logic
      FloorGroup.tsx            per-floor group at computed elevation
      meshes/
        WallMesh.tsx  SlabMesh.tsx  ZoneOverlay.tsx  FurnitureMesh.tsx
      tools/
        WallDrawTool.tsx        click-to-draw walls with grid/endpoint snapping
        SelectTool.tsx          raycast pick → selection
        useGroundPoint.ts       pointer → active-floor plane intersection
      controls/CameraRig.tsx    orbit now; walk mode later
      materials.ts              shared material instances (office palette)
    ui/
      EditorShell.tsx           3-pane layout: left tree, canvas, right inspector
      Toolbar.tsx               tool buttons, floor mode, color mode, undo/redo
      panels/
        HierarchyPanel.tsx      Building → Floors → Walls/Zones/Furniture tree
        PropertiesPanel.tsx     numeric editing for the selected entity
        AreaPanel.tsx           live area/efficiency metrics
      NumberField.tsx           precise numeric input (commit on Enter/blur)
    lib/units.ts, lib/format.ts
```

`core/` must stay importable in Node (tests, future server-side analytics) — no
React, no three.js in `core/model` or `core/analysis`. `core/geometry` may import
three.js math/geometry only.

## 4. Data model (TypeScript)

Canonical source: `src/core/model/types.ts`. Design rules:

- **Branded IDs** (`WallId`, `FloorId`, …) so cross-references can't be mixed up.
- **Plain JSON-serializable data** — the document is the save format (plus
  `schemaVersion` for migrations). No class instances, no three.js objects.
- **2D plan + heights**: walls/zones/slabs are 2D footprints on a floor; the third
  dimension comes from floor elevation/height. This is how commercial floor plates
  are actually authored and keeps analytics (area math) exact.
- **Commercial-first**: tenants, zone classifications (rentable vs common vs
  core), building class, and ownership/permissions are first-class, not add-ons.

```ts
// —— primitives ————————————————————————————————————————————————
type Brand<T, B extends string> = T & { readonly __brand: B };
export type ProjectId  = Brand<string, 'ProjectId'>;
export type BuildingId = Brand<string, 'BuildingId'>;
export type FloorId    = Brand<string, 'FloorId'>;
export type WallId     = Brand<string, 'WallId'>;
export type SlabId     = Brand<string, 'SlabId'>;
export type OpeningId  = Brand<string, 'OpeningId'>;
export type ZoneId     = Brand<string, 'ZoneId'>;
export type ColumnId   = Brand<string, 'ColumnId'>;
export type CoreId     = Brand<string, 'CoreId'>;
export type FurnitureId = Brand<string, 'FurnitureId'>;
export type TenantId   = Brand<string, 'TenantId'>;
export type UserId     = Brand<string, 'UserId'>;

export interface Vec2 { x: number; y: number }        // plan meters
export type Polygon = Vec2[];                          // CCW, implicit closure

// —— document root ——————————————————————————————————————————————
export interface ProjectDoc {
  schemaVersion: 1;
  id: ProjectId;
  name: string;
  createdAt: string; updatedAt: string;               // ISO
  settings: ProjectSettings;
  meta: ProjectMeta;                                   // ownership/sharing/export
  building: Building;
  tenants: Record<TenantId, Tenant>;
}
export interface ProjectSettings {
  units: 'metric' | 'imperial';                        // storage is always meters
  grid: { size: number; snap: boolean; angleSnap: boolean };
}

// —— proprietary product layer (auth/db land later; shape is ready now) ——
export interface ProjectMeta {
  ownerId: UserId | null;
  collaborators: Collaborator[];
  export: ExportPolicy;
}
export interface Collaborator { userId: UserId; role: 'viewer' | 'commenter' | 'editor' | 'admin' }
export interface ExportPolicy {
  watermark: { enabled: boolean; text: string };
  allowGltf: boolean; allowJson: boolean;
}

// —— building hierarchy —————————————————————————————————————————
export interface Building {
  id: BuildingId;
  name: string;
  address?: string;
  buildingClass: 'A' | 'B' | 'C';
  floors: Floor[];                                     // sorted by index
}
export interface Floor {
  id: FloorId;
  name: string;                                        // "Level 12"
  index: number;                                       // 0 = ground
  elevation: number;                                   // meters, slab top
  height: number;                                      // floor-to-floor
  slabs: Slab[];
  walls: Wall[];
  columns: Column[];
  cores: Core[];
  zones: Zone[];
  furniture: FurnitureInstance[];
}

// —— structure ——————————————————————————————————————————————————
export type WallKind = 'exterior' | 'interior' | 'partition' | 'glass' | 'demising';
export interface Wall {
  id: WallId;
  kind: WallKind;
  start: Vec2; end: Vec2;
  thickness: number;
  height: number | null;                               // null → floor height
  openings: Opening[];                                 // sorted by offset
}
export type OpeningKind = 'door' | 'double-door' | 'glass-door' | 'window' | 'ribbon-window' | 'pass-through';
export interface Opening {
  id: OpeningId;
  kind: OpeningKind;
  offset: number;                                      // center along wall, m from start
  width: number; height: number;
  sillHeight: number;                                  // 0 for doors
}
export interface Slab { id: SlabId; outline: Polygon; holes: Polygon[]; thickness: number }
export interface Column { id: ColumnId; position: Vec2; width: number; depth: number; shape: 'rect' | 'round' }
export type CoreKind = 'elevator-bank' | 'stair' | 'restroom' | 'mechanical' | 'electrical' | 'telecom' | 'shaft';
export interface Core { id: CoreId; kind: CoreKind; outline: Polygon; label?: string }

// —— commercial zoning & tenants ————————————————————————————————
export type ZoneKind = 'tenant-suite' | 'common' | 'core' | 'amenity' | 'circulation' | 'service';
export interface Zone {
  id: ZoneId;
  name: string;
  kind: ZoneKind;
  outline: Polygon;
  tenantId: TenantId | null;                           // for tenant-suite
}
export type TenantStatus = 'vacant' | 'leased' | 'proposed' | 'expiring';
export interface Tenant {
  id: TenantId; name: string; color: string;           // hex
  status: TenantStatus; industry?: string;
  leaseExpiry?: string;                                // ISO date
}

// —— furniture ——————————————————————————————————————————————————
export type FurnitureCategory = 'desk' | 'workstation' | 'seating' | 'conference' | 'reception' | 'storage' | 'break-room' | 'server' | 'fixture';
export interface CatalogItem {
  id: string;                                          // stable catalog key
  name: string; category: FurnitureCategory;
  footprint: { w: number; d: number; h: number };      // meters
}
export interface FurnitureInstance {
  id: FurnitureId;
  catalogId: string;
  position: Vec2; rotation: number;                    // radians about +Y
}

// —— analytics (computed, never stored) —————————————————————————
export interface FloorAreaReport {
  floorId: FloorId;
  grossArea: number;                                   // slab outline − holes
  rentableArea: number;                                // tenant-suite + amenity zones
  commonArea: number;                                  // common + circulation
  coreArea: number;                                    // core zones + Core outlines
  efficiency: number;                                  // rentable / gross
  byTenant: { tenantId: TenantId | null; area: number }[];
}
export interface BuildingAreaReport {
  floors: FloorAreaReport[];
  totals: Omit<FloorAreaReport, 'floorId' | 'byTenant'> & { byTenant: FloorAreaReport['byTenant'] };
}
```

Area semantics are a deliberately simplified BOMA-style model for v1 (documented
in `core/analysis/area.ts`); the report types are the analytics contract the SaaS
tier will persist.

## 5. Store & undo/redo contract

```ts
interface EditorStore {
  project: ProjectDoc;                                 // undoable document
  // —— UI state (never undoable, never saved) ——
  selection: { kind: EntityKind; id: string; floorId: FloorId | null } | null;
  activeTool: 'select' | 'wall' | 'measure';
  activeFloorId: FloorId;
  floorViewMode: 'stack' | 'explode' | 'solo';
  explodeGap: number;
  colorMode: 'material' | 'tenant' | 'zoneKind';
  drawingWallKind: WallKind;
  // —— history ——
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  beginBatch(label: string): void; endBatch(): void;   // drags → one undo step
  // —— document commands (each = one history entry unless batched) ——
  updateProject(label: string, fn: (draft: ProjectDoc) => void): void; // generic
  addWall / updateWall / deleteWall / addOpening / updateOpening
  addFloor / duplicateFloor / deleteFloor / updateFloor
  addZone / updateZone / assignTenant / upsertTenant
  addFurniture / updateFurniture / deleteFurniture / deleteSelection
  // —— UI actions ——
  select / setActiveTool / setActiveFloor / setFloorViewMode / setColorMode ...
}
```

History implementation (`store/history.ts`): every document command runs through
`produceWithPatches(project, fn)`; `{patches, inversePatches, label}` is pushed to
the undo stack and the redo stack clears. `beginBatch`/`endBatch` accumulate
patches from multiple commands into one entry (pointer drags, multi-delete).
Undo applies `inversePatches` with `applyPatches`; redo re-applies `patches`.
UI state is untouched by history except that a deleted entity clears selection.

## 6. WebGPU canvas (R3F v9 pattern)

```tsx
import * as THREE from 'three/webgpu';
import { Canvas, extend } from '@react-three/fiber';
extend(THREE as unknown as Parameters<typeof extend>[0]);

<Canvas
  frameloop="demand"
  gl={async (props) => {
    const renderer = new THREE.WebGPURenderer({ ...(props as object), antialias: true });
    await renderer.init();                             // WebGPU, or WebGL2 fallback
    return renderer;
  }}
/>
```

`WebGPURenderer` falls back to WebGL2 automatically when `navigator.gpu` is
absent, so one code path serves both; a badge in the viewport reports the active
backend.

Three WebGPU realities discovered during verification, all handled in code:

1. **Device loss recovery** (`EditorCanvas.tsx`) — a GPU device can be lost at
   any time (driver reset, GPU process crash, software adapters) and
   `WebGPURenderer` has no recovery path, leaving a permanently black viewport.
   The canvas subscribes to `device.lost`; on an unexpected loss (reason other
   than `'destroyed'`) it remounts the renderer with `forceWebGL: true`.
2. **`createView` swizzle shim** (`webgpuCompat.ts`) — three r185 passes
   `swizzle: 'rgba'` as a string in every texture view descriptor; current
   Chromium types that member as a dictionary and throws, killing every frame.
   A lazy patch strips/converts the identity swizzle only after the browser
   proves it rejects the string form. Remove when three catches up.
3. **No GLSL under WebGPU** — drei's `<Grid>`/`<Line>` are `ShaderMaterial`-based
   and the node builder silently replaces them with blank materials. The scene
   uses its own `ReferenceGrid` and `SceneLine` (plain `LineBasicMaterial`),
   which compile on both backends.

## 7. Performance strategy for 10–40 story towers

1. **Identity-based dirty rendering** (section 2) — editing one wall re-tessellates
   one wall.
2. **`frameloop="demand"`** — the GPU idles unless the camera moves or the
   document changes. Editors are mostly idle; this is the single biggest win.
3. **Shared materials** (`scene/materials.ts`) — a handful of material instances
   for the whole tower keeps the renderer's pipeline/bind-group churn near zero;
   WebGPU batches identical pipelines extremely well.
4. **Geometry cost model** — walls are merged boxes (openings by segment
   splitting, not CSG), slabs are extruded shapes. A 40-floor plate with ~150
   walls/floor is ~6k meshes; fine for WebGPU. The upgrade path when furniture
   counts explode is `InstancedMesh` per catalog item per floor (the catalog
   design — instances reference `catalogId` — was chosen to make this a drop-in).
5. **Typical-floor reuse** (roadmap M6): office towers repeat plates;
   `duplicateFloor` today, shared-plate references later so one edit updates 30
   floors and geometry is built once.
6. **Solo/explode as culling** — solo mode sets `group.visible = false` for other
   floors (no unmount, geometry stays cached).
7. **Never block the frame on analytics** — area reports compute in a memoized
   selector on document change, not per frame; later a worker if plates get huge.

## 8. Roadmap

- **M0 (this branch)** — scaffold, data model, store + undo/redo, WebGPU canvas,
  demo tower, wall draw/edit, hierarchy panel, properties panel, area panel,
  stack/explode/solo, tenant color mode.
- **M1.5 Plan import (this branch)** — turn existing floor plans (PDF/image
  scans, e.g. marketing plans and as-builts) into editable floors:
  1. **Ingest** — drag-and-drop PNG/JPG/WebP or PDF (first page rendered
     client-side via pdf.js) in an import dialog.
  2. **Calibrate** — two-point scale calibration (click two points on the
     image, type the real distance); the AI's scale estimate (from scale bars
     or printed dimensions) pre-fills when available.
  3. **Extract** — `POST /api/extract-plan` (Next.js route handler) sends the
     image to Claude (`claude-opus-5`) with a strict JSON schema
     (`output_config.format`): walls (with kind), zones (with kind + printed
     RSF labels), cores, openings, columns, footprint, scale estimate. All
     coordinates normalized to a 0–1000 image frame. The route requires
     `ANTHROPIC_API_KEY` at deploy time and returns a clear 503 without it;
     refusals (`stop_reason: "refusal"`) map to 422 with an explanation.
  4. **Apply** — extraction maps through the calibration transform into real
     `Wall`/`Zone`/`Core`/`Opening`/`Column`/`Slab` entities on a new or the
     active floor, in ONE undo entry, with the source image kept as a
     semi-transparent floor **underlay** (`Floor.underlay`, additive schema
     field) for visual QA; printed RSF labels cross-check computed zone areas.
  Underlay-only import stays available when extraction is unavailable.
- **M1 Openings & cores** — door/window placement tool on walls, core planner
  (elevator bank / stair / restroom blocks), column grids.
- **M2 Zones & tenancy** — zone drawing tool, tenant manager UI, vacancy/leased
  color-coding presets, per-tenant stacking diagram.
- **M3 Furniture & layout generators** — full proprietary catalog, drag-drop
  placement, open-plan/private-office/hybrid/hot-desk generators parameterized by
  zone polygon; Class A/B plate templates.
- **M4 Presentation** — realistic material library, first-person walkthrough
  (pointer-lock CameraRig mode), measurement tool, glTF export with watermark
  stamping, share-ready viewer route.
- **M5 Cloud** — auth (owner/collaborator roles already modeled), project
  persistence API, autosave with schema migrations, permission-gated sharing
  links, export controls enforcement.
- **M6 Scale** — typical-floor references, furniture instancing,
  worker-side analytics, square-footage/efficiency report exports (the
  analytics-ready `AreaReport` contract feeds the SaaS reporting tier).

## 9. Commercial/proprietary guardrails

- No open-source license anywhere in `editor/`; `"license": "UNLICENSED"`.
- All geometry, generators, and analytics implementations are original code.
- Save format is the proprietary JSON document (versioned); glTF is an *export*,
  never the source of truth, and passes through `ExportPolicy` (watermark, allow
  flags) so paid-tier controls have an enforcement point from day one.
- `core/` is transport-agnostic pure TS so the same domain logic can run in the
  future licensed server (analytics, thumbnails, migrations) without a rewrite.
