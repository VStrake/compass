'use client';

/**
 * Project menu — the toolbar's identity control (M2 Slice A).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * Replaces the bare inline project-name field with a dropdown that owns the
 * whole document lifecycle:
 *
 *   New building…      `createEmptyProject` → `loadProject`
 *   Sample buildings   `SAMPLE_BUILDINGS[n].create()` → `loadProject`
 *   Recent projects    IndexedDB (`listProjects` / `getProject` / `deleteProject`)
 *   Open file…         `parseProject` over a picked `.compass.json`
 *   Save to file       `serializeProject` Blob download
 *   Rename             the store's `renameProject` command
 *
 * ## Why there is usually no "unsaved changes" prompt
 * `EditorShell` autosaves the open document to IndexedDB ~1.5 s after any
 * change, so switching projects normally loses nothing and a modal confirm would
 * be pure friction. The confirm therefore appears in exactly the two cases where
 * work *would* be lost: the open document has never reached IndexedDB (no row
 * with its id yet), or IndexedDB is unavailable in this browser so autosave is
 * off entirely. Both are detected when the menu opens, not guessed.
 *
 * Save state itself is not shown here — `StatusBar` owns that pip.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createEmptyProject } from '@/core/model/factories';
import type { ProjectDoc } from '@/core/model/types';
import {
  deleteProject,
  estimateUsage,
  getProject,
  isPersistenceAvailable,
  listProjects,
  type ProjectSummary,
} from '@/lib/projectStore';
import { formatNumber } from '@/lib/format';
import { getEditorState, useEditorStore, SAMPLE_BUILDINGS } from '@/store/useEditorStore';

import { Button, FieldLabel } from './primitives';
import { PROJECT_FILE_ACCEPT, downloadProject, readProjectFile } from './projectFile';

/** "just now" / "14 min ago" / "3 days ago" — enough to pick the right row. */
function relativeTime(value: string | number): string {
  const then = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(then)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.round(months / 12)} yr ago`;
}

function MenuSection({ children }: { children: string }) {
  return (
    <div className="border-t border-editor-border px-2 pb-0.5 pt-1.5 first:border-t-0">
      <FieldLabel>{children}</FieldLabel>
    </div>
  );
}

/** One clickable menu line. `detail` is the dim right-hand column. */
function MenuRow({
  label,
  sublabel,
  detail,
  onClick,
  disabled,
  title,
  right,
}: {
  label: string;
  sublabel?: string;
  detail?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 px-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className="flex min-w-0 flex-1 items-baseline gap-2 rounded-sm px-1 py-1 text-left outline-none hover:bg-editor-raised focus-visible:bg-editor-raised focus-visible:ring-1 focus-visible:ring-amber-500/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <span className="min-w-0 flex-1 truncate text-xs text-gray-200">
          {label}
          {sublabel ? <span className="ml-1.5 text-[11px] text-gray-500">{sublabel}</span> : null}
        </span>
        {detail ? (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-500">{detail}</span>
        ) : null}
      </button>
      {right}
    </div>
  );
}

export function ProjectMenu() {
  const projectName = useEditorStore((state) => state.project.name);
  const projectId = useEditorStore((state) => state.project.id);
  const buildingName = useEditorStore((state) => state.project.building.name);
  const allowJson = useEditorStore((state) => state.project.meta.export.allowJson);
  const loadProject = useEditorStore((state) => state.loadProject);
  const renameProject = useEditorStore((state) => state.renameProject);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [usageMb, setUsageMb] = useState<number | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectSummary | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  /** A load held back by the "this document was never saved" confirmation. */
  const [pending, setPending] = useState<{ label: string; run: () => void } | null>(null);

  const currentIsPersisted = recent.some((entry) => entry.id === projectId);

  /**
   * Viewport coordinates for the `fixed` panel, measured off the trigger when
   * the menu opens (and on resize while it stays open). Clamped so a long recent
   * list can't push the panel off the right edge or below the fold.
   */
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; maxHeight: number }>({
    top: 40,
    left: 8,
    maxHeight: 600,
  });

  useEffect(() => {
    if (!open) return;
    function place(): void {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const PANEL_WIDTH = 352; // w-[22rem]
      const GAP = 6;
      const MARGIN = 8;
      const top = rect.bottom + GAP;
      setPanelStyle({
        top,
        left: Math.max(MARGIN, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - MARGIN)),
        maxHeight: Math.max(200, window.innerHeight - top - MARGIN),
      });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  const refresh = useCallback(async () => {
    // `estimateUsage()` is only a size hint — a browser can lack the Storage API
    // and still persist perfectly well, so availability comes from IndexedDB.
    setStorageOk(isPersistenceAvailable());
    setRecentLoading(true);
    try {
      const [usage, list] = await Promise.all([estimateUsage(), listProjects()]);
      if (!aliveRef.current) return;
      setUsageMb(usage ? usage.bytes / 1_048_576 : null);
      setRecent(list);
    } catch {
      if (!aliveRef.current) return;
      // A storage failure must never break the menu — it just has no history.
      setRecent([]);
    } finally {
      if (aliveRef.current) setRecentLoading(false);
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setNameDraft(null);
    setRenameDraft(null);
    setDeleteCandidate(null);
    setFileError(null);
    setPending(null);
  }, []);

  // —— open/close plumbing ——
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, close]);

  /**
   * Gate a document swap on the two cases that actually lose work. Autosave
   * covers everything else, so the common path is a plain load.
   */
  function requestLoad(label: string, produce: () => ProjectDoc | Promise<ProjectDoc | null>): void {
    const run = () => {
      setPending(null);
      void (async () => {
        try {
          const doc = await produce();
          if (!aliveRef.current || !doc) return;
          loadProject(doc);
          close();
        } catch (error) {
          if (!aliveRef.current) return;
          setFileError(error instanceof Error ? error.message : 'That project could not be opened.');
        }
      })();
    };
    if (!storageOk || !currentIsPersisted) {
      setPending({ label, run });
      return;
    }
    run();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // Shield EditorShell's V/W/M/Delete map for the whole subtree.
    event.stopPropagation();
    if (event.key !== 'Escape') return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (nameDraft !== null || renameDraft !== null || deleteCandidate !== null || pending) {
      setNameDraft(null);
      setRenameDraft(null);
      setDeleteCandidate(null);
      setPending(null);
      return;
    }
    close();
  }

  function commitNew(): void {
    const name = (nameDraft ?? '').trim();
    if (name === '') return;
    setNameDraft(null);
    requestLoad(`open “${name}”`, () => createEmptyProject(name));
  }

  function commitRename(): void {
    const name = (renameDraft ?? '').trim();
    setRenameDraft(null);
    if (name === '' || name === projectName) return;
    renameProject(name);
  }

  async function handleDelete(entry: ProjectSummary): Promise<void> {
    setDeleteCandidate(null);
    try {
      await deleteProject(entry.id);
    } catch {
      // Nothing actionable — the refresh below shows the true state.
    }
    await refresh();
  }

  // —— render ————————————————————————————————————————————————————
  return (
    <div ref={rootRef} className="relative shrink-0" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        title={`${projectName} — ${buildingName} · open the project menu`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-7 max-w-[18rem] items-center gap-1.5 rounded-sm border px-1.5 text-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-amber-500/60 ${
          open
            ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
            : 'border-editor-border bg-editor-raised text-gray-300 hover:border-gray-600 hover:text-gray-100'
        }`}
      >
        <span className="min-w-0 truncate">{projectName || 'Untitled'}</span>
        <span aria-hidden className="shrink-0 text-[9px] leading-none text-gray-500">
          ▼
        </span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept={PROJECT_FILE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          setFileError(null);
          requestLoad(`open “${file.name}”`, () => readProjectFile(file));
        }}
      />

      {open ? (
        <div
          role="menu"
          aria-label="Project menu"
          /**
           * Positioned `fixed`, not `absolute`: the Toolbar is `overflow-x-auto`
           * so it can scroll on a narrow window, and an `overflow-x` other than
           * visible makes the block a scroll container that clips on BOTH axes —
           * an absolutely-positioned panel gets cut to the toolbar's 48px height.
           * `fixed` escapes the clip (no ancestor sets transform/filter/contain),
           * so the coordinates come from the trigger's own rect instead.
           */
          className="fixed z-40 w-[22rem] overflow-y-auto rounded-md border border-editor-border bg-editor-panel shadow-2xl shadow-black/60"
          style={panelStyle}
        >
          {/* —— create —— */}
          <MenuSection>New</MenuSection>
          {nameDraft === null ? (
            <MenuRow label="New building…" onClick={() => setNameDraft('')} />
          ) : (
            <div className="flex items-center gap-1 px-2 pb-1">
              <input
                autoFocus
                type="text"
                value={nameDraft}
                placeholder="Building name"
                onChange={(event) => setNameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitNew();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setNameDraft(null);
                  }
                }}
                className="h-7 min-w-0 flex-1 rounded-sm border border-editor-border bg-editor-bg px-1.5 text-xs text-editor-text outline-none placeholder:text-gray-600 focus:border-amber-500/70"
              />
              <Button onClick={commitNew} disabled={nameDraft.trim() === ''} active>
                Create
              </Button>
            </div>
          )}

          {/* —— samples —— */}
          <MenuSection>Sample buildings</MenuSection>
          {SAMPLE_BUILDINGS.map((entry) => (
            <MenuRow
              key={entry.id}
              label={entry.name}
              sublabel={entry.subtitle}
              title={`Open ${entry.name}`}
              onClick={() => requestLoad(`open ${entry.name}`, () => entry.create())}
            />
          ))}

          {/* —— recents —— */}
          <div className="flex items-baseline gap-2 border-t border-editor-border px-2 pb-0.5 pt-1.5">
            <FieldLabel>Recent projects</FieldLabel>
            <div className="flex-1" />
            {usageMb !== null ? (
              <span
                className="font-mono text-[10px] tabular-nums text-gray-600"
                title="Local storage used by saved projects (underlay images dominate this)"
              >
                {formatNumber(usageMb, 1)} MB
              </span>
            ) : null}
          </div>
          {!storageOk ? (
            <p className="px-2 pb-1.5 text-[11px] leading-snug text-amber-300/80">
              This browser has no usable IndexedDB, so projects are not saved automatically. Use
              “Save to file” to keep your work.
            </p>
          ) : recentLoading && recent.length === 0 ? (
            <p className="px-2 pb-1.5 text-[11px] text-gray-500">Reading saved projects…</p>
          ) : recent.length === 0 ? (
            <p className="px-2 pb-1.5 text-[11px] text-gray-500">
              Nothing saved yet — the open building is stored a moment after your first edit.
            </p>
          ) : (
            recent.map((entry) => (
              <MenuRow
                key={String(entry.id)}
                label={entry.name}
                sublabel={
                  entry.buildingName && entry.buildingName !== entry.name
                    ? entry.buildingName
                    : undefined
                }
                detail={`${entry.floorCount} fl · ${relativeTime(entry.updatedAt)}`}
                title={`Open ${entry.name}`}
                onClick={() => requestLoad(`open ${entry.name}`, () => getProject(entry.id))}
                right={
                  deleteCandidate?.id === entry.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button danger onClick={() => void handleDelete(entry)}>
                        Delete
                      </Button>
                      <Button onClick={() => setDeleteCandidate(null)}>Keep</Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteCandidate(entry)}
                      title={`Delete ${entry.name} from this browser`}
                      className="shrink-0 rounded-sm px-1.5 text-xs text-gray-600 outline-none hover:bg-red-950/40 hover:text-red-300 focus-visible:ring-1 focus-visible:ring-amber-500/60"
                    >
                      ✕
                    </button>
                  )
                }
              />
            ))
          )}

          {/* —— file —— */}
          <MenuSection>File</MenuSection>
          <MenuRow
            label="Open file…"
            detail=".compass.json"
            onClick={() => fileInputRef.current?.click()}
          />
          <MenuRow
            label="Save to file"
            detail={allowJson ? undefined : 'disabled'}
            disabled={!allowJson}
            title={
              allowJson
                ? 'Download this project as a .compass.json document'
                : 'JSON export is disabled by this project’s export policy'
            }
            onClick={() => {
              downloadProject(getEditorState().project);
              close();
            }}
          />

          {/* —— rename —— */}
          <MenuSection>This project</MenuSection>
          {renameDraft === null ? (
            <MenuRow
              label="Rename…"
              detail={projectName}
              onClick={() => setRenameDraft(projectName)}
            />
          ) : (
            <div className="flex items-center gap-1 px-2 pb-1">
              <input
                autoFocus
                type="text"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitRename();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setRenameDraft(null);
                  }
                }}
                className="h-7 min-w-0 flex-1 rounded-sm border border-editor-border bg-editor-bg px-1.5 text-xs text-editor-text outline-none focus:border-amber-500/70"
              />
              <Button onClick={commitRename} active>
                Rename
              </Button>
            </div>
          )}

          {fileError ? (
            <div className="border-t border-red-900/70 bg-red-950/30 px-2 py-1.5 text-[11px] leading-snug text-red-200">
              {fileError}
            </div>
          ) : null}

          {pending ? (
            <div className="flex items-center gap-2 border-t border-amber-800/70 bg-amber-950/30 px-2 py-1.5">
              <span className="min-w-0 flex-1 text-[11px] leading-snug text-amber-200">
                {storageOk
                  ? `“${projectName}” has never been saved. Discard it and ${pending.label}?`
                  : `Automatic saving is unavailable, so “${projectName}” will be lost. ${
                      pending.label.charAt(0).toUpperCase() + pending.label.slice(1)
                    } anyway?`}
              </span>
              <Button danger onClick={pending.run}>
                Discard
              </Button>
              <Button onClick={() => setPending(null)}>Cancel</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ProjectMenu;
