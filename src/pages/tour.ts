import type { RouteCtx } from '../main';
import { hasOnboarded } from './onboarding';
import { getTour, saveTour, newTourId, type TourRecord } from '../lib/storage';
import { captureFrame, frameLooksLikePlan, extractPlanFromFrame } from '../lib/planExtraction';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}

export async function renderTour(root: HTMLElement, ctx: RouteCtx): Promise<void> {
  const tourId = ctx.param;
  if (!tourId) {
    root.innerHTML = `
      <div class="min-h-screen bg-parchment p-6">
        <div class="pepper-bar mb-4"></div>
        <h2 class="font-serif text-2xl mb-2">No tour ID</h2>
        <p class="text-sm text-midnight/70 mb-6">Open the link your broker texted you.</p>
        <a href="#/" class="btn-primary">Home</a>
      </div>
    `;
    return;
  }

  // Onboarding gate
  if (!hasOnboarded()) {
    location.hash = `/onboarding?return=${encodeURIComponent('#/tour/' + tourId)}`;
    return;
  }

  // Load or stub the tour record
  let tour = await getTour(tourId);
  if (!tour) {
    tour = {
      id: tourId,
      status: 'pending',
      property: { name: 'Untitled tour' },
      createdAt: Date.now(),
      path: [],
      pauses: [],
      transcript: []
    };
    await saveTour(tour);
  }

  if (!tour.plan) {
    renderScanStage(root, tour);
  } else {
    renderActiveTourPlaceholder(root, tour);
  }
}

function renderActiveTourPlaceholder(root: HTMLElement, tour: TourRecord): void {
  // Phase 5+ deliverable. v1 placeholder shows the rectified plan to confirm
  // capture/extract worked.
  root.innerHTML = `
    <div class="min-h-screen bg-parchment">
      <div class="pepper-bar"></div>
      <header class="header-bar"><h1 class="font-serif text-lg">${escapeHtml(tour.property.name || tour.id)}</h1></header>
      <div class="p-4">
        <div class="text-xs uppercase tracking-wide font-bold text-midnight/60 mb-2">Captured plan</div>
        <img src="${escapeHtml(tour.plan!.imageDataUrl)}" alt="Floor plan" class="w-full border border-steel rounded mb-4"/>
        <div class="text-xs text-midnight/70 mb-4">Detected rooms: ${tour.plan!.rooms.map(r => escapeHtml(r.label)).join(', ') || 'none'}.</div>
        <div class="flex gap-2 flex-wrap">
          <button id="rescan" class="btn-ghost">Rescan plan</button>
          <a href="#/" class="btn-ghost">Home</a>
        </div>
        <p class="text-xs text-midnight/55 mt-6">Active tracking, calibration, and the live "you are here" dot land in Phase 5.</p>
      </div>
    </div>
  `;
  document.getElementById('rescan')?.addEventListener('click', async () => {
    tour.plan = undefined;
    await saveTour(tour);
    renderScanStage(document.getElementById('app')!, tour);
  });
}

function renderScanStage(root: HTMLElement, tour: TourRecord): void {
  root.innerHTML = `
    <div class="scan-stage">
      <video id="scan-video" autoplay playsinline muted></video>
      <div class="scan-frame">
        <div id="target" class="target"></div>
      </div>
      <div class="scan-pulse">
        <div id="hint">Point at the floor plan</div>
        <small id="sub-hint">Hold the phone steady, plan flat in view</small>
      </div>
      <button id="cancel" class="scan-cancel">&larr; Home</button>
    </div>
  `;

  const video    = document.getElementById('scan-video') as HTMLVideoElement;
  const target   = document.getElementById('target')     as HTMLElement;
  const hint     = document.getElementById('hint')       as HTMLElement;
  const subHint  = document.getElementById('sub-hint')   as HTMLElement;
  const cancelEl = document.getElementById('cancel')     as HTMLButtonElement;

  let stream: MediaStream | null = null;
  let stopped = false;
  let lastApiCall = 0;
  let pending = false;
  const API_THROTTLE_MS = 3000;
  const FRAME_TICK_MS   = 320;

  async function start(): Promise<void> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      tick();
    } catch (err) {
      hint.textContent = 'Camera unavailable.';
      subHint.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  function shutdown(): void {
    stopped = true;
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
  }

  cancelEl.addEventListener('click', () => {
    shutdown();
    location.hash = '/';
  });

  async function tick(): Promise<void> {
    if (stopped) return;
    setTimeout(tick, FRAME_TICK_MS);
    if (pending) return;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    const grab = captureFrame(video);
    if (!grab) return;

    const looksLikePlan = frameLooksLikePlan(grab.imageData);
    target.classList.toggle('is-locking', looksLikePlan);
    hint.textContent = looksLikePlan ? 'Reading plan...' : 'Point at the floor plan';

    if (!looksLikePlan) return;
    const now = performance.now();
    if (now - lastApiCall < API_THROTTLE_MS) return;
    lastApiCall = now;
    pending = true;

    try {
      const result = await extractPlanFromFrame(grab.base64, grab.canvas);
      pending = false;
      if (!result.ok) {
        if (/no_plan_detected/.test(result.error)) {
          subHint.textContent = "I don't see a floor plan yet. Try a bit further back.";
        } else {
          subHint.textContent = `Extraction failed: ${result.error.slice(0, 80)}`;
        }
        return;
      }
      tour.plan = result.plan;
      await saveTour(tour);
      shutdown();
      renderActiveTourPlaceholder(document.getElementById('app')!, tour);
    } catch (err) {
      pending = false;
      subHint.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  start();

  window.addEventListener('hashchange', shutdown, { once: true });
}
