import type { RouteCtx } from '../main';

const ONBOARD_KEY = 'compass:onboarded';

export function hasOnboarded(): boolean {
  return localStorage.getItem(ONBOARD_KEY) === '1';
}

function markOnboarded(): void {
  localStorage.setItem(ONBOARD_KEY, '1');
}

interface PermResults {
  orientation: 'granted' | 'denied' | 'unsupported';
  motion:      'granted' | 'denied' | 'unsupported';
  camera:      'granted' | 'denied' | 'unsupported';
  microphone:  'granted' | 'denied' | 'unsupported';
}

async function requestOrientation(): Promise<'granted' | 'denied' | 'unsupported'> {
  const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    try {
      const r = await D.requestPermission();
      return r === 'granted' ? 'granted' : 'denied';
    } catch { return 'denied'; }
  }
  if ('DeviceOrientationEvent' in window) return 'granted';
  return 'unsupported';
}

async function requestMotion(): Promise<'granted' | 'denied' | 'unsupported'> {
  const M = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  if (M && typeof M.requestPermission === 'function') {
    try {
      const r = await M.requestPermission();
      return r === 'granted' ? 'granted' : 'denied';
    } catch { return 'denied'; }
  }
  if ('DeviceMotionEvent' in window) return 'granted';
  return 'unsupported';
}

async function requestCameraAndMic(): Promise<{ camera: 'granted' | 'denied' | 'unsupported'; microphone: 'granted' | 'denied' | 'unsupported' }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { camera: 'unsupported', microphone: 'unsupported' };
  }
  // Try camera + mic together first.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: true
    });
    for (const t of stream.getTracks()) t.stop();
    return { camera: 'granted', microphone: 'granted' };
  } catch {
    // Fall back to camera-only; mic optional.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });
      for (const t of stream.getTracks()) t.stop();
      return { camera: 'granted', microphone: 'denied' };
    } catch {
      return { camera: 'denied', microphone: 'denied' };
    }
  }
}

export function renderOnboarding(root: HTMLElement, ctx: RouteCtx): void {
  const returnTo = ctx.query.get('return') || '#/';

  root.innerHTML = `
    <div class="min-h-screen bg-midnight text-white flex flex-col">
      <div class="pepper-bar"></div>
      <div class="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div class="text-pepper text-[11px] uppercase tracking-[0.3em] mb-3">Compass</div>
        <h2 class="font-serif text-3xl mb-4 max-w-sm">You're about to tour with Compass.</h2>
        <p class="text-white/85 mb-8 max-w-sm leading-relaxed">
          We use your camera to scan the floor plan, and your phone's motion sensors to show you
          where you are as you walk. Everything stays on your phone unless you choose to share.
        </p>
        <button id="continue-btn" class="btn-primary text-base px-8 py-4">Continue</button>
        <div id="status" class="text-white/70 text-xs mt-6 max-w-sm min-h-[1.25rem]"></div>
        <div id="retry-area" class="mt-4"></div>
      </div>
    </div>
  `;

  const btn       = document.getElementById('continue-btn') as HTMLButtonElement;
  const statusEl  = document.getElementById('status')       as HTMLElement;
  const retryArea = document.getElementById('retry-area')   as HTMLElement;

  async function run(): Promise<void> {
    btn.disabled = true;
    retryArea.innerHTML = '';
    const results: Partial<PermResults> = {};

    statusEl.textContent = 'Requesting motion sensors...';
    results.orientation = await requestOrientation();
    results.motion      = await requestMotion();

    statusEl.textContent = 'Requesting camera and microphone...';
    const camMic = await requestCameraAndMic();
    results.camera     = camMic.camera;
    results.microphone = camMic.microphone;

    if (results.camera === 'denied' || results.camera === 'unsupported') {
      statusEl.textContent = '';
      retryArea.innerHTML = `
        <div class="permission-card text-midnight max-w-sm text-left">
          <div class="font-serif text-lg mb-2">Camera is required.</div>
          <p class="text-xs text-midnight/80 mb-3">
            Compass needs the camera to scan the floor plan. Allow access in Safari, then try again.
          </p>
          <button id="retry-btn" class="btn-primary w-full">Try again</button>
        </div>
      `;
      document.getElementById('retry-btn')?.addEventListener('click', run);
      btn.disabled = false;
      return;
    }

    if (results.orientation === 'denied' || results.motion === 'denied') {
      statusEl.textContent = 'Motion access was denied. The plan will not auto-rotate as you turn. You can continue, or enable in iOS Settings > Safari > Motion & Orientation Access and try again.';
      retryArea.innerHTML = `
        <div class="flex flex-col items-center gap-3">
          <button id="retry-btn" class="btn-primary">Try again</button>
          <a href="${returnTo}" id="continue-anyway" class="text-white/70 text-[11px] underline">Continue without motion</a>
        </div>
      `;
      document.getElementById('retry-btn')?.addEventListener('click', run);
      document.getElementById('continue-anyway')?.addEventListener('click', () => {
        markOnboarded();
      });
      btn.disabled = false;
      return;
    }

    if (results.microphone === 'denied') {
      statusEl.textContent = 'Microphone denied. Tour transcription will be skipped. You can change this later in Safari settings.';
    } else {
      statusEl.textContent = 'All set.';
    }

    markOnboarded();
    setTimeout(() => { location.hash = returnTo.replace(/^#/, ''); }, 500);
  }

  btn.addEventListener('click', run);
}
