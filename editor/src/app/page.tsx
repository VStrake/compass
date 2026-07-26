'use client';

import dynamic from 'next/dynamic';

/**
 * The editor is a fully client-side application: WebGPU/WebGL renderer
 * construction, pointer tooling and the zustand document store have no
 * meaningful server rendering. Loading it with `ssr: false` keeps the App
 * Router route boundary trivial and avoids hydration work entirely.
 */
const EditorShell = dynamic(() => import('@/ui/EditorShell'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0f1115] text-[#9aa3b2]">
      Loading Compass Studio…
    </div>
  ),
});

export default function Page() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-[#0f1115]">
      <EditorShell />
    </main>
  );
}
