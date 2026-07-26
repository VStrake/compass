'use client';

/**
 * PLACEHOLDER SHELL.
 *
 * Minimal, dependency-free 3-pane editor layout so the app route renders and
 * builds. The UI agent replaces this with the real shell (Toolbar, Hierarchy,
 * Canvas, Inspector, Area panel) wired to `@/store/useEditorStore`.
 */
export default function EditorShell() {
  return (
    <div className="flex h-full w-full flex-col bg-[#0f1115] text-[#e5e7eb]">
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[#262b34] bg-[#15181e] px-3">
        <span className="text-sm font-semibold tracking-tight">Compass Studio</span>
        <span className="text-[11px] uppercase tracking-widest text-[#9aa3b2]">Toolbar</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-[#262b34] bg-[#15181e]">
          <div className="border-b border-[#262b34] px-3 py-2 text-[11px] uppercase tracking-widest text-[#9aa3b2]">
            Hierarchy
          </div>
          <div className="flex-1 p-3 text-[#9aa3b2]">Building tree placeholder</div>
        </aside>

        <section className="relative flex min-w-0 flex-1 items-center justify-center bg-[#0b0d11]">
          <div className="pointer-events-none select-none text-center text-[#9aa3b2]">
            <div className="text-[11px] uppercase tracking-widest">Canvas</div>
            <div className="mt-1 text-xs">3D viewport placeholder</div>
          </div>
        </section>

        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-[#262b34] bg-[#15181e]">
          <div className="border-b border-[#262b34] px-3 py-2 text-[11px] uppercase tracking-widest text-[#9aa3b2]">
            Inspector
          </div>
          <div className="flex-1 p-3 text-[#9aa3b2]">Properties &amp; area placeholder</div>
        </aside>
      </div>
    </div>
  );
}
