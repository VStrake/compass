'use client';

/**
 * The single editor store: undoable document + non-undoable UI state.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Contract (ARCHITECTURE §5):
 *  - `project` is the undoable document. Every mutation goes through the
 *    internal `commit(label, recipe)`, which runs `produceWithPatches` and
 *    pushes one history entry (or accumulates into the open batch).
 *  - UI state (selection, tools, view modes, hidden floors) is never undoable
 *    and never saved — with one exception: deleting or undoing away the
 *    selected entity clears the selection.
 *  - A command that changes nothing produces no history entry.
 *
 * Both APIs are exported: `editorStore` (vanilla, for imperative access from
 * R3F callbacks and tools without subscribing) and `useEditorStore` (React
 * hook, always with a fine-grained selector — never subscribe to `project`).
 */

import { produceWithPatches } from 'immer';
import { createStore, useStore } from 'zustand';

import { computeBuildingAreaReport } from '@/core/analysis/area';
import { getCatalogItem } from '@/core/model/catalog';
import { createDemoProject } from '@/core/model/demo';
import {
  createFloor,
  createFurniture,
  createOpening,
  createSlab,
  createTenant,
  createWall,
  createZone,
  floorName,
  recomputeElevations,
  DEFAULTS,
} from '@/core/model/factories';
import {
  newColumnId,
  newCoreId,
  newFloorId,
  newFurnitureId,
  newOpeningId,
  newSlabId,
  newWallId,
  newZoneId,
} from '@/core/model/ids';
import type {
  BuildingAreaReport,
  Column,
  ColumnId,
  Core,
  CoreId,
  EntityKind,
  Floor,
  FloorId,
  FurnitureId,
  FurnitureInstance,
  Opening,
  OpeningId,
  OpeningKind,
  Polygon,
  ProjectDoc,
  Slab,
  SlabId,
  Tenant,
  TenantId,
  Vec2,
  Wall,
  WallId,
  WallKind,
  Zone,
  ZoneId,
  ZoneKind,
} from '@/core/model/types';
import { createHistory } from './history';
import { findFloor, selectionExists, type Selection } from './selectors';

export type { Selection };

export type ActiveTool = 'select' | 'wall' | 'measure';
export type FloorViewMode = 'stack' | 'explode' | 'solo';
export type ColorMode = 'material' | 'tenant' | 'zoneKind';

export interface EditorStore {
  // —— document (undoable) ——
  project: ProjectDoc;

  // —— UI state (never undoable, never saved) ——
  selection: Selection | null;
  activeTool: ActiveTool;
  activeFloorId: FloorId;
  floorViewMode: FloorViewMode;
  explodeGap: number;
  colorMode: ColorMode;
  drawingWallKind: WallKind;
  hiddenFloorIds: string[];

  // —— history mirrors (reactive; the stacks themselves live outside state) ——
  undoDepth: number;
  redoDepth: number;
  undoLabel: string | null;
  redoLabel: string | null;

  // —— history ——
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  beginBatch(label: string): void;
  endBatch(): void;
  isBatching(): boolean;

  // —— generic document command ——
  updateProject(label: string, fn: (draft: ProjectDoc) => void): void;

  // —— walls & openings ——
  addWall(
    floorId: FloorId,
    kind: WallKind,
    start: Vec2,
    end: Vec2,
    overrides?: Partial<Omit<Wall, 'id' | 'kind' | 'start' | 'end'>>,
  ): WallId | null;
  updateWall(floorId: FloorId, wallId: WallId, patch: Partial<Omit<Wall, 'id' | 'openings'>>): void;
  deleteWall(floorId: FloorId, wallId: WallId): void;
  addOpening(
    floorId: FloorId,
    wallId: WallId,
    kind: OpeningKind,
    offset: number,
    overrides?: Partial<Omit<Opening, 'id' | 'kind' | 'offset'>>,
  ): OpeningId | null;
  updateOpening(
    floorId: FloorId,
    wallId: WallId,
    openingId: OpeningId,
    patch: Partial<Omit<Opening, 'id'>>,
  ): void;
  deleteOpening(floorId: FloorId, wallId: WallId, openingId: OpeningId): void;

  // —— floors ——
  addFloor(afterFloorId?: FloorId): FloorId | null;
  duplicateFloor(floorId: FloorId): FloorId | null;
  deleteFloor(floorId: FloorId): void;
  updateFloor(floorId: FloorId, patch: Partial<Pick<Floor, 'name' | 'height'>>): void;

  // —— zones & tenants ——
  addZone(
    floorId: FloorId,
    name: string,
    kind: ZoneKind,
    outline: Polygon,
    tenantId?: TenantId | null,
  ): ZoneId | null;
  updateZone(floorId: FloorId, zoneId: ZoneId, patch: Partial<Omit<Zone, 'id'>>): void;
  deleteZone(floorId: FloorId, zoneId: ZoneId): void;
  assignTenant(floorId: FloorId, zoneId: ZoneId, tenantId: TenantId | null): void;
  upsertTenant(tenant: Partial<Tenant> & { name: string }): TenantId;
  deleteTenant(tenantId: TenantId): void;

  // —— furniture ——
  addFurniture(
    floorId: FloorId,
    catalogId: string,
    position: Vec2,
    rotation?: number,
  ): FurnitureId | null;
  updateFurniture(
    floorId: FloorId,
    furnitureId: FurnitureId,
    patch: Partial<Omit<FurnitureInstance, 'id' | 'catalogId'>>,
  ): void;
  deleteFurniture(floorId: FloorId, furnitureId: FurnitureId): void;

  // —— structure extras ——
  addColumn(floorId: FloorId, position: Vec2, width?: number, depth?: number): ColumnId | null;
  deleteColumn(floorId: FloorId, columnId: ColumnId): void;
  addCore(floorId: FloorId, kind: Core['kind'], outline: Polygon, label?: string): CoreId | null;
  deleteCore(floorId: FloorId, coreId: CoreId): void;
  addSlab(floorId: FloorId, outline: Polygon, holes?: Polygon[], thickness?: number): SlabId | null;

  // —— selection-wide ——
  deleteSelection(): void;

  // —— project-level document settings ——
  renameProject(name: string): void;
  renameBuilding(name: string): void;
  setUnits(units: ProjectDoc['settings']['units']): void;
  setGrid(patch: Partial<ProjectDoc['settings']['grid']>): void;

  // —— document lifecycle ——
  loadProject(doc: ProjectDoc): void;
  resetToDemo(): void;

  // —— UI actions ——
  select(selection: Selection | null): void;
  selectEntity(kind: EntityKind, id: string, floorId?: FloorId | null): void;
  clearSelection(): void;
  setActiveTool(tool: ActiveTool): void;
  setActiveFloor(floorId: FloorId): void;
  setFloorViewMode(mode: FloorViewMode): void;
  setExplodeGap(gap: number): void;
  setColorMode(mode: ColorMode): void;
  setDrawingWallKind(kind: WallKind): void;
  toggleFloorHidden(floorId: string): void;
  isFloorHidden(floorId: string): boolean;
  showAllFloors(): void;

  // —— analytics (memoized on document identity) ——
  areaReport(): BuildingAreaReport;
}

/** History lives outside reactive state so pushing never re-renders the scene. */
const history = createHistory();

// —— area report memo: keyed on document identity ————————————————
let areaCacheKey: ProjectDoc | null = null;
let areaCacheValue: BuildingAreaReport | null = null;

// —— helpers ——————————————————————————————————————————————————————
function clonePolygon(polygon: Polygon): Polygon {
  return polygon.map((point) => ({ x: point.x, y: point.y }));
}

/**
 * Deep-clone a floor, minting brand-new ids for the floor and every entity it
 * owns (slabs, walls, openings, columns, cores, zones, furniture). Used by
 * `duplicateFloor`; exported for tests and future plate templates.
 */
export function cloneFloorWithNewIds(source: Floor, index: number): Floor {
  const slabs: Slab[] = source.slabs.map((slab) => ({
    id: newSlabId(),
    outline: clonePolygon(slab.outline),
    holes: slab.holes.map(clonePolygon),
    thickness: slab.thickness,
  }));

  const walls: Wall[] = source.walls.map((wall) => ({
    id: newWallId(),
    kind: wall.kind,
    start: { x: wall.start.x, y: wall.start.y },
    end: { x: wall.end.x, y: wall.end.y },
    thickness: wall.thickness,
    height: wall.height,
    openings: wall.openings.map((opening) => ({
      id: newOpeningId(),
      kind: opening.kind,
      offset: opening.offset,
      width: opening.width,
      height: opening.height,
      sillHeight: opening.sillHeight,
    })),
  }));

  const columns: Column[] = source.columns.map((column) => ({
    id: newColumnId(),
    position: { x: column.position.x, y: column.position.y },
    width: column.width,
    depth: column.depth,
    shape: column.shape,
  }));

  const cores: Core[] = source.cores.map((core) => {
    const clone: Core = {
      id: newCoreId(),
      kind: core.kind,
      outline: clonePolygon(core.outline),
    };
    if (core.label !== undefined) clone.label = core.label;
    return clone;
  });

  const zones: Zone[] = source.zones.map((zone) => ({
    id: newZoneId(),
    name: zone.name,
    kind: zone.kind,
    outline: clonePolygon(zone.outline),
    tenantId: zone.tenantId,
  }));

  const furniture: FurnitureInstance[] = source.furniture.map((item) => ({
    id: newFurnitureId(),
    catalogId: item.catalogId,
    position: { x: item.position.x, y: item.position.y },
    rotation: item.rotation,
  }));

  const clone: Floor = {
    id: newFloorId(),
    name: floorName(index),
    index,
    elevation: source.elevation, // fixed up by recomputeElevations
    height: source.height,
    slabs,
    walls,
    columns,
    cores,
    zones,
    furniture,
  };
  if (source.underlay) {
    clone.underlay = {
      ...source.underlay,
      offset: { x: source.underlay.offset.x, y: source.underlay.offset.y },
    };
  }
  return clone;
}

/**
 * Renumber floors after an insert/delete. Auto-generated names follow the new
 * index; names the user (or a template) customised are left alone.
 */
function reindexFloors(floors: Floor[]): void {
  floors.forEach((floor, index) => {
    if (floor.name === floorName(floor.index)) floor.name = floorName(index);
    floor.index = index;
  });
  recomputeElevations(floors);
}

// —— store ————————————————————————————————————————————————————————
export const editorStore = createStore<EditorStore>()((set, get) => {
  const initialProject = createDemoProject();
  const firstFloor = initialProject.building.floors[0];
  if (!firstFloor) throw new Error('createDemoProject returned a building with no floors');

  function historySnapshot() {
    const depth = history.depth();
    return {
      undoDepth: depth.undo,
      redoDepth: depth.redo,
      undoLabel: history.undoLabel(),
      redoLabel: history.redoLabel(),
    };
  }

  /**
   * The one and only document mutation path: produce patches, push history,
   * publish the new document. No-ops never touch history.
   */
  function commit(label: string, recipe: (draft: ProjectDoc) => void): boolean {
    const [next, patches, inversePatches] = produceWithPatches(get().project, recipe);
    if (patches.length === 0) return false;
    history.pushEntry(patches, inversePatches, label);
    set({ project: next as ProjectDoc, ...historySnapshot() });
    return true;
  }

  /** Clear the selection when it no longer resolves to a live entity. */
  function pruneSelection(): void {
    const { project, selection } = get();
    if (selection && !selectionExists(project, selection)) set({ selection: null });
  }

  /** Keep `activeFloorId` pointing at a floor that still exists. */
  function pruneActiveFloor(): void {
    const { project, activeFloorId } = get();
    if (findFloor(project, activeFloorId)) return;
    const fallback = project.building.floors[0];
    if (fallback) set({ activeFloorId: fallback.id });
  }

  /** Mutate one floor in place inside a commit. */
  function commitOnFloor(
    label: string,
    floorId: FloorId,
    recipe: (floor: Floor, draft: ProjectDoc) => void,
  ): boolean {
    return commit(label, (draft) => {
      const floor = draft.building.floors.find((candidate) => candidate.id === floorId);
      if (!floor) return;
      recipe(floor, draft);
    });
  }

  return {
    project: initialProject,

    selection: null,
    activeTool: 'select',
    activeFloorId: firstFloor.id,
    floorViewMode: 'stack',
    explodeGap: 6,
    colorMode: 'material',
    drawingWallKind: 'interior',
    hiddenFloorIds: [],

    undoDepth: 0,
    redoDepth: 0,
    undoLabel: null,
    redoLabel: null,

    // —— history ————————————————————————————————————————————————
    undo() {
      const result = history.undo(get().project);
      if (!result) return;
      set({ project: result.next, ...historySnapshot() });
      pruneSelection();
      pruneActiveFloor();
    },

    redo() {
      const result = history.redo(get().project);
      if (!result) return;
      set({ project: result.next, ...historySnapshot() });
      pruneSelection();
      pruneActiveFloor();
    },

    canUndo() {
      return history.canUndo();
    },

    canRedo() {
      return history.canRedo();
    },

    beginBatch(label) {
      history.beginBatch(label);
    },

    endBatch() {
      history.endBatch();
      set(historySnapshot());
    },

    isBatching() {
      return history.isBatching();
    },

    // —— generic ————————————————————————————————————————————————
    updateProject(label, fn) {
      commit(label, fn);
    },

    // —— walls ——————————————————————————————————————————————————
    addWall(floorId, kind, start, end, overrides) {
      const wall = createWall(kind, start, end, overrides);
      const ok = commitOnFloor('Add wall', floorId, (floor) => {
        floor.walls.push(wall);
      });
      return ok ? wall.id : null;
    },

    updateWall(floorId, wallId, patch) {
      commitOnFloor('Edit wall', floorId, (floor) => {
        const wall = floor.walls.find((candidate) => candidate.id === wallId);
        if (!wall) return;
        if (patch.kind !== undefined) wall.kind = patch.kind;
        if (patch.start !== undefined) wall.start = { x: patch.start.x, y: patch.start.y };
        if (patch.end !== undefined) wall.end = { x: patch.end.x, y: patch.end.y };
        if (patch.thickness !== undefined) wall.thickness = patch.thickness;
        if (patch.height !== undefined) wall.height = patch.height;
      });
    },

    deleteWall(floorId, wallId) {
      const changed = commitOnFloor('Delete wall', floorId, (floor) => {
        const index = floor.walls.findIndex((candidate) => candidate.id === wallId);
        if (index >= 0) floor.walls.splice(index, 1);
      });
      if (changed) pruneSelection();
    },

    addOpening(floorId, wallId, kind, offset, overrides) {
      const opening = createOpening(kind, offset, overrides);
      const ok = commitOnFloor('Add opening', floorId, (floor) => {
        const wall = floor.walls.find((candidate) => candidate.id === wallId);
        if (!wall) return;
        wall.openings.push(opening);
        wall.openings.sort((a, b) => a.offset - b.offset);
      });
      return ok ? opening.id : null;
    },

    updateOpening(floorId, wallId, openingId, patch) {
      commitOnFloor('Edit opening', floorId, (floor) => {
        const wall = floor.walls.find((candidate) => candidate.id === wallId);
        if (!wall) return;
        const opening = wall.openings.find((candidate) => candidate.id === openingId);
        if (!opening) return;
        if (patch.kind !== undefined) opening.kind = patch.kind;
        if (patch.offset !== undefined) opening.offset = patch.offset;
        if (patch.width !== undefined) opening.width = patch.width;
        if (patch.height !== undefined) opening.height = patch.height;
        if (patch.sillHeight !== undefined) opening.sillHeight = patch.sillHeight;
        wall.openings.sort((a, b) => a.offset - b.offset);
      });
    },

    deleteOpening(floorId, wallId, openingId) {
      const changed = commitOnFloor('Delete opening', floorId, (floor) => {
        const wall = floor.walls.find((candidate) => candidate.id === wallId);
        if (!wall) return;
        const index = wall.openings.findIndex((candidate) => candidate.id === openingId);
        if (index >= 0) wall.openings.splice(index, 1);
      });
      if (changed) pruneSelection();
    },

    // —— floors —————————————————————————————————————————————————
    addFloor(afterFloorId) {
      const { project } = get();
      const floors = project.building.floors;
      const reference = afterFloorId
        ? floors.find((floor) => floor.id === afterFloorId)
        : floors[floors.length - 1];
      const insertIndex = reference ? reference.index + 1 : floors.length;

      const floor = createFloor(insertIndex, 0, DEFAULTS.floorHeight);
      // Give the new level the plate of its reference floor so it is usable
      // immediately; fall back to a default rectangle for an empty building.
      const templateSlab = reference?.slabs[0];
      floor.slabs = [
        templateSlab
          ? createSlab(
              clonePolygon(templateSlab.outline),
              templateSlab.holes.map(clonePolygon),
              templateSlab.thickness,
            )
          : createSlab(
              [
                { x: -15, y: -10 },
                { x: 15, y: -10 },
                { x: 15, y: 10 },
                { x: -15, y: 10 },
              ],
              [],
              DEFAULTS.slabThickness,
            ),
      ];

      const ok = commit('Add floor', (draft) => {
        draft.building.floors.splice(insertIndex, 0, floor);
        reindexFloors(draft.building.floors);
      });
      return ok ? floor.id : null;
    },

    duplicateFloor(floorId) {
      const source = findFloor(get().project, floorId);
      if (!source) return null;
      const clone = cloneFloorWithNewIds(source, source.index + 1);
      const ok = commit('Duplicate floor', (draft) => {
        const index = draft.building.floors.findIndex((floor) => floor.id === floorId);
        if (index < 0) return;
        draft.building.floors.splice(index + 1, 0, clone);
        reindexFloors(draft.building.floors);
      });
      return ok ? clone.id : null;
    },

    deleteFloor(floorId) {
      // Never leave the building without a floor.
      if (get().project.building.floors.length <= 1) return;
      const changed = commit('Delete floor', (draft) => {
        const index = draft.building.floors.findIndex((floor) => floor.id === floorId);
        if (index < 0) return;
        draft.building.floors.splice(index, 1);
        reindexFloors(draft.building.floors);
      });
      if (!changed) return;
      set((state) => ({ hiddenFloorIds: state.hiddenFloorIds.filter((id) => id !== floorId) }));
      pruneSelection();
      pruneActiveFloor();
    },

    updateFloor(floorId, patch) {
      commit('Edit floor', (draft) => {
        const floor = draft.building.floors.find((candidate) => candidate.id === floorId);
        if (!floor) return;
        if (patch.name !== undefined) floor.name = patch.name;
        if (patch.height !== undefined && patch.height !== floor.height) {
          floor.height = patch.height;
          // Everything above shifts up/down by the delta.
          recomputeElevations(draft.building.floors);
        }
      });
    },

    // —— zones & tenants ————————————————————————————————————————
    addZone(floorId, name, kind, outline, tenantId = null) {
      const zone = createZone(name, kind, clonePolygon(outline), tenantId);
      const ok = commitOnFloor('Add zone', floorId, (floor) => {
        floor.zones.push(zone);
      });
      return ok ? zone.id : null;
    },

    updateZone(floorId, zoneId, patch) {
      commitOnFloor('Edit zone', floorId, (floor) => {
        const zone = floor.zones.find((candidate) => candidate.id === zoneId);
        if (!zone) return;
        if (patch.name !== undefined) zone.name = patch.name;
        if (patch.kind !== undefined) zone.kind = patch.kind;
        if (patch.outline !== undefined) zone.outline = clonePolygon(patch.outline);
        if (patch.tenantId !== undefined) zone.tenantId = patch.tenantId;
      });
    },

    deleteZone(floorId, zoneId) {
      const changed = commitOnFloor('Delete zone', floorId, (floor) => {
        const index = floor.zones.findIndex((candidate) => candidate.id === zoneId);
        if (index >= 0) floor.zones.splice(index, 1);
      });
      if (changed) pruneSelection();
    },

    assignTenant(floorId, zoneId, tenantId) {
      commitOnFloor('Assign tenant', floorId, (floor) => {
        const zone = floor.zones.find((candidate) => candidate.id === zoneId);
        if (!zone) return;
        zone.tenantId = tenantId;
      });
    },

    upsertTenant(tenant) {
      const existingId = tenant.id;
      if (existingId && get().project.tenants[existingId]) {
        commit('Edit tenant', (draft) => {
          const current = draft.tenants[existingId];
          if (!current) return;
          if (tenant.name !== undefined) current.name = tenant.name;
          if (tenant.color !== undefined) current.color = tenant.color;
          if (tenant.status !== undefined) current.status = tenant.status;
          if (tenant.industry !== undefined) current.industry = tenant.industry;
          if (tenant.leaseExpiry !== undefined) current.leaseExpiry = tenant.leaseExpiry;
        });
        return existingId;
      }

      const created = createTenant(
        tenant.name,
        tenant.color ?? '#4f9cf9',
        tenant.status ?? 'proposed',
        {
          ...(tenant.industry !== undefined ? { industry: tenant.industry } : {}),
          ...(tenant.leaseExpiry !== undefined ? { leaseExpiry: tenant.leaseExpiry } : {}),
        },
      );
      if (existingId) created.id = existingId;
      commit('Add tenant', (draft) => {
        draft.tenants[created.id] = created;
      });
      return created.id;
    },

    deleteTenant(tenantId) {
      const changed = commit('Delete tenant', (draft) => {
        if (!draft.tenants[tenantId]) return;
        delete draft.tenants[tenantId];
        // Suites keep their geometry but become vacant.
        for (const floor of draft.building.floors) {
          for (const zone of floor.zones) {
            if (zone.tenantId === tenantId) zone.tenantId = null;
          }
        }
      });
      if (changed) pruneSelection();
    },

    // —— furniture ——————————————————————————————————————————————
    addFurniture(floorId, catalogId, position, rotation = 0) {
      if (!getCatalogItem(catalogId)) return null;
      const instance = createFurniture(catalogId, position, rotation);
      const ok = commitOnFloor('Add furniture', floorId, (floor) => {
        floor.furniture.push(instance);
      });
      return ok ? instance.id : null;
    },

    updateFurniture(floorId, furnitureId, patch) {
      commitOnFloor('Move furniture', floorId, (floor) => {
        const item = floor.furniture.find((candidate) => candidate.id === furnitureId);
        if (!item) return;
        if (patch.position !== undefined) {
          item.position = { x: patch.position.x, y: patch.position.y };
        }
        if (patch.rotation !== undefined) item.rotation = patch.rotation;
      });
    },

    deleteFurniture(floorId, furnitureId) {
      const changed = commitOnFloor('Delete furniture', floorId, (floor) => {
        const index = floor.furniture.findIndex((candidate) => candidate.id === furnitureId);
        if (index >= 0) floor.furniture.splice(index, 1);
      });
      if (changed) pruneSelection();
    },

    // —— structure extras ————————————————————————————————————————
    addColumn(floorId, position, width = 0.6, depth = 0.6) {
      const column: Column = {
        id: newColumnId(),
        position: { x: position.x, y: position.y },
        width,
        depth,
        shape: 'rect',
      };
      const ok = commitOnFloor('Add column', floorId, (floor) => {
        floor.columns.push(column);
      });
      return ok ? column.id : null;
    },

    deleteColumn(floorId, columnId) {
      const changed = commitOnFloor('Delete column', floorId, (floor) => {
        const index = floor.columns.findIndex((candidate) => candidate.id === columnId);
        if (index >= 0) floor.columns.splice(index, 1);
      });
      if (changed) pruneSelection();
    },

    addCore(floorId, kind, outline, label) {
      const core: Core = { id: newCoreId(), kind, outline: clonePolygon(outline) };
      if (label !== undefined) core.label = label;
      const ok = commitOnFloor('Add core', floorId, (floor) => {
        floor.cores.push(core);
      });
      return ok ? core.id : null;
    },

    deleteCore(floorId, coreId) {
      const changed = commitOnFloor('Delete core', floorId, (floor) => {
        const index = floor.cores.findIndex((candidate) => candidate.id === coreId);
        if (index >= 0) floor.cores.splice(index, 1);
      });
      if (changed) pruneSelection();
    },

    addSlab(floorId, outline, holes = [], thickness = DEFAULTS.slabThickness) {
      const slab = createSlab(clonePolygon(outline), holes.map(clonePolygon), thickness);
      const ok = commitOnFloor('Add slab', floorId, (floor) => {
        floor.slabs.push(slab);
      });
      return ok ? slab.id : null;
    },

    // —— selection-wide ——————————————————————————————————————————
    deleteSelection() {
      const { selection } = get();
      if (!selection) return;
      const floorId = selection.floorId;

      switch (selection.kind) {
        case 'wall':
          if (floorId) get().deleteWall(floorId, selection.id as WallId);
          break;
        case 'zone':
          if (floorId) get().deleteZone(floorId, selection.id as ZoneId);
          break;
        case 'furniture':
          if (floorId) get().deleteFurniture(floorId, selection.id as FurnitureId);
          break;
        case 'column':
          if (floorId) get().deleteColumn(floorId, selection.id as ColumnId);
          break;
        case 'core':
          if (floorId) get().deleteCore(floorId, selection.id as CoreId);
          break;
        case 'floor':
          get().deleteFloor(selection.id as FloorId);
          break;
        case 'tenant':
          get().deleteTenant(selection.id as TenantId);
          break;
        case 'opening': {
          // Openings only carry their own id in the selection; find the owner.
          const { project } = get();
          for (const floor of project.building.floors) {
            for (const wall of floor.walls) {
              if (wall.openings.some((opening) => opening.id === selection.id)) {
                get().deleteOpening(floor.id, wall.id, selection.id as OpeningId);
                return;
              }
            }
          }
          break;
        }
        default:
          // building / slab are not deletable from the selection.
          break;
      }
      pruneSelection();
    },

    // —— project-level document settings ——————————————————————————
    renameProject(name) {
      commit('Rename project', (draft) => {
        draft.name = name;
      });
    },

    renameBuilding(name) {
      commit('Rename building', (draft) => {
        draft.building.name = name;
      });
    },

    setUnits(units) {
      commit('Change units', (draft) => {
        draft.settings.units = units;
      });
    },

    setGrid(patch) {
      commit('Change grid', (draft) => {
        if (patch.size !== undefined) draft.settings.grid.size = patch.size;
        if (patch.snap !== undefined) draft.settings.grid.snap = patch.snap;
        if (patch.angleSnap !== undefined) draft.settings.grid.angleSnap = patch.angleSnap;
      });
    },

    // —— document lifecycle ————————————————————————————————————————
    loadProject(doc) {
      // Loading a different document invalidates history entirely.
      history.clear();
      const first = doc.building.floors[0];
      set({
        project: doc,
        selection: null,
        hiddenFloorIds: [],
        ...(first ? { activeFloorId: first.id } : {}),
        ...historySnapshot(),
      });
    },

    resetToDemo() {
      get().loadProject(createDemoProject());
    },

    // —— UI actions ————————————————————————————————————————————————
    select(selection) {
      set({ selection });
    },

    selectEntity(kind, id, floorId = null) {
      set({ selection: { kind, id, floorId } });
    },

    clearSelection() {
      set({ selection: null });
    },

    setActiveTool(tool) {
      set({ activeTool: tool });
    },

    setActiveFloor(floorId) {
      set({ activeFloorId: floorId });
    },

    setFloorViewMode(mode) {
      set({ floorViewMode: mode });
    },

    setExplodeGap(gap) {
      set({ explodeGap: Math.max(0, gap) });
    },

    setColorMode(mode) {
      set({ colorMode: mode });
    },

    setDrawingWallKind(kind) {
      set({ drawingWallKind: kind });
    },

    toggleFloorHidden(floorId) {
      set((state) => ({
        hiddenFloorIds: state.hiddenFloorIds.includes(floorId)
          ? state.hiddenFloorIds.filter((id) => id !== floorId)
          : [...state.hiddenFloorIds, floorId],
      }));
    },

    isFloorHidden(floorId) {
      return get().hiddenFloorIds.includes(floorId);
    },

    showAllFloors() {
      if (get().hiddenFloorIds.length === 0) return;
      set({ hiddenFloorIds: [] });
    },

    // —— analytics ————————————————————————————————————————————————
    areaReport() {
      const { project } = get();
      if (areaCacheKey === project && areaCacheValue) return areaCacheValue;
      areaCacheValue = computeBuildingAreaReport(project);
      areaCacheKey = project;
      return areaCacheValue;
    },
  };
});

/**
 * React binding. ALWAYS pass a fine-grained selector — subscribing to the whole
 * document re-renders the entire scene on every edit (ARCHITECTURE §2).
 *
 * @example const wall = useEditorStore(s => findWall(s.project, floorId, wallId));
 */
export function useEditorStore(): EditorStore;
export function useEditorStore<T>(selector: (state: EditorStore) => T): T;
export function useEditorStore<T>(selector?: (state: EditorStore) => T) {
  return useStore(editorStore, selector as (state: EditorStore) => T);
}

/** Imperative helpers for tools/callbacks that must not subscribe. */
export const getEditorState = (): EditorStore => editorStore.getState();
export const subscribeEditor = editorStore.subscribe;
