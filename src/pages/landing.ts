export function renderLanding(root: HTMLElement): void {
  root.innerHTML = `
    <div class="min-h-screen bg-parchment">
      <div class="pepper-bar"></div>
      <header class="header-bar">
        <h1 class="font-serif text-xl tracking-wide">Compass</h1>
      </header>

      <div class="max-w-md mx-auto p-6 sm:p-8">
        <h2 class="font-serif text-3xl mb-3">Tour with Compass.</h2>
        <p class="text-sm text-midnight/80 mb-8 leading-relaxed">
          Open the link your broker texted you. Point your phone at the printed floor plan
          and walk the suite. The plan stays oriented to where you are facing. Your tour
          recap arrives when you finish.
        </p>

        <div class="bg-white border border-steel rounded p-5 mb-6">
          <div class="text-[11px] uppercase tracking-wide font-bold text-midnight/60 mb-2">For brokers</div>
          <a href="#/admin" class="btn-primary w-full">Open admin</a>
        </div>

        <div class="text-[11px] text-midnight/55">
          iOS 17+ in Safari. Camera and motion permissions required.
        </div>
      </div>
    </div>
  `;
}
