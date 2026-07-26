'use client';

/**
 * Compass Studio editor shell: toolbar / tree / viewport / inspector / status.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Owns the global keyboard map. Shortcuts are read imperatively through
 * `getEditorState()` so the shell itself never subscribes to the document and
 * never re-renders on an edit (ARCHITECTURE §2).
 */

import { useEffect } from 'react';

import { EditorCanvas } from '@/scene/EditorCanvas';
import { getEditorState } from '@/store/useEditorStore';
import { AreaPanel } from './panels/AreaPanel';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

/** Never hijack keys while the user is typing into a field. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function EditorShell() {
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
        </section>

        <aside className="flex w-80 min-h-0 shrink-0 flex-col border-l border-editor-border bg-editor-panel">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PropertiesPanel />
          </div>
          <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-editor-border">
            <AreaPanel />
          </div>
        </aside>
      </div>

      <StatusBar />
    </div>
  );
}

export default EditorShell;
