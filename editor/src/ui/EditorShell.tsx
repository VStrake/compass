'use client';

/**
 * Compass Studio editor shell: toolbar / tree / viewport / inspector / status.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Owns the global keyboard map. Shortcuts are read imperatively through
 * `getEditorState()` so the shell itself never subscribes to the document and
 * never re-renders on an edit (ARCHITECTURE §2).
 *
 * Also owns **autosave** (M2 Slice A): a `subscribeEditor` watch on the
 * *identity* of `project` — the one thing that changes on every commit —
 * debounced ~1.5 s into `saveProject`. The subscription is deliberately not a
 * React hook subscription: the shell must not re-render because the document
 * changed, so the save state is the only thing that lands in React state, and it
 * only lands when the pip's text actually changes.
 */

import { useEffect, useState } from 'react';

import { EditorCanvas } from '@/scene/EditorCanvas';
import { getProject, isPersistenceAvailable, listProjects, saveProject } from '@/lib/projectStore';
import { getEditorState, subscribeEditor, useEditorStore } from '@/store/useEditorStore';
import { ExpiryLegend } from './ExpiryLegend';
import { AreaPanel } from './panels/AreaPanel';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { StackingPanel } from './panels/StackingPanel';
import { StatusBar, type SaveStatus } from './StatusBar';
import { Toolbar } from './Toolbar';

/** How long the document must sit still before it is written. */
const AUTOSAVE_DEBOUNCE_MS = 1500;

/** Which analytics panel the right column is showing. */
type AnalyticsTab = 'area' | 'stacking';

const IDLE_SAVE: SaveStatus = { state: 'idle', savedAt: null, message: null };

/** Never hijack keys while the user is typing into a field. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Debounced autosave of the open document.
 *
 * The project the shell mounted with is treated as already-known, so booting the
 * demo tower (or restoring a document) never writes anything: the first save is
 * always the consequence of a real change or a deliberate `loadProject`.
 *
 * A failed write is reported in the pip and nothing else — an editor that stops
 * working because a browser refused a transaction is worse than an editor with
 * no history.
 */
/**
 * Reopen the building the user last had open. The store boots on the demo so the
 * first paint never waits on IndexedDB; this swaps in the most recently saved
 * document once it arrives. It runs exactly once, and only while the demo is
 * still untouched — if the user has already loaded or edited something in the
 * time the read took, their document wins and the restore is abandoned.
 */
function useRestoreLastProject(): void {
  useEffect(() => {
    let alive = true;
    const booted = getEditorState().project;

    void (async () => {
      if (!isPersistenceAvailable()) return;
      let summaries: Awaited<ReturnType<typeof listProjects>>;
      try {
        summaries = await listProjects();
      } catch {
        return; // A failed read is not worth surfacing — the demo is a fine start.
      }
      const newest = summaries[0]; // listProjects() is newest-first.
      if (!alive || !newest) return;
      if (getEditorState().project !== booted) return;
      if (newest.id === booted.id) return; // Already the document on screen.

      const doc = await getProject(newest.id).catch(() => null);
      if (!alive || !doc) return;
      if (getEditorState().project !== booted) return;
      getEditorState().loadProject(doc);
    })();

    return () => {
      alive = false;
    };
  }, []);
}

function useAutosave(): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>(IDLE_SAVE);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    // Identity of the last document we have either saved or deliberately ignored.
    let seen = getEditorState().project;

    function flush(): void {
      const doc = getEditorState().project;
      void saveProject(doc)
        .then(() => {
          if (!alive) return;
          setStatus({ state: 'saved', savedAt: Date.now(), message: null });
        })
        .catch((error: unknown) => {
          if (!alive) return;
          setStatus({
            state: 'error',
            savedAt: null,
            message: error instanceof Error ? error.message : 'storage unavailable',
          });
        });
    }

    // Report a missing IndexedDB up front rather than only after the first edit
    // silently fails. `saveProject` is a no-op in that case, so without this the
    // pip would claim "Saved".
    if (!isPersistenceAvailable()) {
      setStatus({ state: 'error', savedAt: null, message: 'storage unavailable' });
      return () => {
        alive = false;
      };
    }

    const unsubscribe = subscribeEditor((state) => {
      if (state.project === seen) return;
      seen = state.project;
      setStatus((current) => (current.state === 'saving' ? current : { ...current, state: 'saving' }));
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    });

    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return status;
}

/** Minimal 2-tab header for the right column's analytics slot. */
function AnalyticsTabs({
  tab,
  onChange,
}: {
  tab: AnalyticsTab;
  onChange: (next: AnalyticsTab) => void;
}) {
  const tabs: { value: AnalyticsTab; label: string; title: string }[] = [
    { value: 'area', label: 'Area', title: 'Area & efficiency analytics' },
    { value: 'stacking', label: 'Stacking', title: 'Floor-by-floor tenant stacking diagram' },
  ];
  return (
    <div className="flex shrink-0 items-stretch border-b border-editor-border bg-editor-panel">
      {tabs.map((entry) => {
        const active = entry.value === tab;
        return (
          <button
            key={entry.value}
            type="button"
            title={entry.title}
            onClick={() => onChange(entry.value)}
            className={`border-b-2 px-2.5 py-1 text-[10px] uppercase tracking-wider outline-none transition-colors focus-visible:ring-1 focus-visible:ring-amber-500/60 ${
              active
                ? 'border-amber-500 text-amber-300'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

export function EditorShell() {
  useRestoreLastProject();
  const save = useAutosave();
  const [tab, setTab] = useState<AnalyticsTab>('area');
  const colorMode = useEditorStore((state) => state.colorMode);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.isComposing || isTextEntry(event.target)) return;

      const store = getEditorState();
      const accel = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (accel) {
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          store.redo();
          return;
        }
        return; // leave every other accelerator to the browser
      }

      if (event.altKey) return;

      switch (key) {
        case 'v':
          store.setActiveTool('select');
          break;
        case 'w':
          store.setActiveTool('wall');
          break;
        case 'm':
          store.setActiveTool('measure');
          break;
        case 'delete':
        case 'backspace':
          event.preventDefault();
          store.deleteSelection();
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-editor-bg text-editor-text">
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-editor-border bg-editor-panel">
          <HierarchyPanel />
        </aside>

        <section className="relative min-w-0 flex-1 bg-editor-bg">
          <EditorCanvas />
          {/* Legends live over the canvas, never inside `scene/`. */}
          {colorMode === 'expiry' ? <ExpiryLegend /> : null}
        </section>

        <aside className="flex w-80 min-h-0 shrink-0 flex-col border-l border-editor-border bg-editor-panel">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PropertiesPanel />
          </div>
          <div className="flex max-h-[45%] shrink-0 flex-col border-t border-editor-border">
            <AnalyticsTabs tab={tab} onChange={setTab} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'area' ? <AreaPanel /> : <StackingPanel />}
            </div>
          </div>
        </aside>
      </div>

      <StatusBar save={save} />
    </div>
  );
}

export default EditorShell;
