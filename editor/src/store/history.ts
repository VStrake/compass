/**
 * Patch-based undo/redo with drag batching.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Every document command runs through immer's `produceWithPatches`, which hands
 * back the forward patches and their inverses. Storing patches instead of full
 * document snapshots keeps memory flat for a 40-story tower and makes an undo
 * step O(size of the edit) rather than O(size of the document).
 *
 * The history object is intentionally *not* part of the reactive store state —
 * pushing an entry must never invalidate scene components. The store mirrors
 * the depths/labels into state for the toolbar (see `useEditorStore`).
 */

import { applyPatches, enablePatches, type Patch } from 'immer';

// Immer's patch machinery is opt-in and must be enabled exactly once per
// process; this module is the single place that does it.
enablePatches();

export const MAX_HISTORY_DEPTH = 200;

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

interface OpenBatch {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  /** Nesting depth so nested begin/end pairs collapse into one entry. */
  depth: number;
}

export interface History {
  /**
   * Record an edit. While a batch is open the patches accumulate into that
   * batch instead of producing their own entry. Pushing clears the redo stack.
   */
  pushEntry(patches: Patch[], inversePatches: Patch[], label: string): void;
  /** Apply the newest entry's inverse patches to `base`. */
  undo<T>(base: T): { next: T; entry: HistoryEntry } | null;
  /** Re-apply the newest undone entry's forward patches to `base`. */
  redo<T>(base: T): { next: T; entry: HistoryEntry } | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Open (or nest into) a batch: subsequent commands form one undo step. */
  beginBatch(label: string): void;
  /** Close the innermost batch; commits one entry when it changed anything. */
  endBatch(): void;
  isBatching(): boolean;
  /** Drop an open batch's accumulated patches without committing an entry. */
  cancelBatch(): void;
  clear(): void;
  undoLabel(): string | null;
  redoLabel(): string | null;
  depth(): { undo: number; redo: number };
}

export function createHistory(): History {
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let batch: OpenBatch | null = null;

  function commitEntry(entry: HistoryEntry): void {
    undoStack.push(entry);
    if (undoStack.length > MAX_HISTORY_DEPTH) undoStack.shift();
    redoStack.length = 0;
  }

  return {
    pushEntry(patches, inversePatches, label) {
      if (patches.length === 0) return;

      if (batch) {
        // Forward patches run in application order; inverses must run in
        // reverse order, hence the prepend.
        batch.patches.push(...patches);
        batch.inversePatches.unshift(...inversePatches);
        return;
      }

      commitEntry({ label, patches, inversePatches });
    },

    undo<T>(base: T) {
      const entry = undoStack.pop();
      if (!entry) return null;
      const next = applyPatches(base as never, entry.inversePatches) as T;
      redoStack.push(entry);
      if (redoStack.length > MAX_HISTORY_DEPTH) redoStack.shift();
      return { next, entry };
    },

    redo<T>(base: T) {
      const entry = redoStack.pop();
      if (!entry) return null;
      const next = applyPatches(base as never, entry.patches) as T;
      undoStack.push(entry);
      if (undoStack.length > MAX_HISTORY_DEPTH) undoStack.shift();
      return { next, entry };
    },

    canUndo() {
      return undoStack.length > 0;
    },

    canRedo() {
      return redoStack.length > 0;
    },

    beginBatch(label) {
      if (batch) {
        batch.depth += 1;
        return;
      }
      batch = { label, patches: [], inversePatches: [], depth: 1 };
    },

    endBatch() {
      if (!batch) return;
      batch.depth -= 1;
      if (batch.depth > 0) return;

      const finished = batch;
      batch = null;
      if (finished.patches.length === 0) return; // nothing changed: no entry
      commitEntry({
        label: finished.label,
        patches: finished.patches,
        inversePatches: finished.inversePatches,
      });
    },

    isBatching() {
      return batch !== null;
    },

    cancelBatch() {
      batch = null;
    },

    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      batch = null;
    },

    undoLabel() {
      return undoStack.length > 0 ? undoStack[undoStack.length - 1]!.label : null;
    },

    redoLabel() {
      return redoStack.length > 0 ? redoStack[redoStack.length - 1]!.label : null;
    },

    depth() {
      return { undo: undoStack.length, redo: redoStack.length };
    },
  };
}
