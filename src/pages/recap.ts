import type { RouteCtx } from '../main';

export function renderRecap(root: HTMLElement, ctx: RouteCtx): void {
  // Phase 8 deliverable. v1 placeholder.
  root.innerHTML = `
    <div class="min-h-screen bg-parchment">
      <div class="pepper-bar"></div>
      <header class="header-bar"><h1 class="font-serif text-xl">Compass &middot; Recap</h1></header>
      <div class="p-6 max-w-md">
        <h2 class="font-serif text-2xl mb-3">Recap ${ctx.param ? '(' + ctx.param + ')' : ''}</h2>
        <p class="text-sm text-midnight/70 mb-6">Recap rendering arrives in Phase 8.</p>
        <a href="#/" class="btn-primary">Home</a>
      </div>
    </div>
  `;
}
