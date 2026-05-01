// TODO: add password auth before exposing this page in production.
import QRCode from 'qrcode';
import { listTours, newTourId, saveTour, type TourRecord } from '../lib/storage';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}

export async function renderAdmin(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="min-h-screen bg-parchment">
      <div class="pepper-bar"></div>
      <header class="header-bar flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <a href="#/" class="bg-white text-midnight px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-wide whitespace-nowrap">&larr; Home</a>
          <h1 class="font-serif text-lg sm:text-xl truncate">Compass &middot; Admin</h1>
        </div>
      </header>

      <div class="max-w-3xl mx-auto p-4 sm:p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-serif text-2xl">Tours</h2>
          <button id="new-tour-btn" class="btn-primary">New tour</button>
        </div>
        <div id="tour-list" class="grid gap-3"></div>
      </div>
    </div>

    <div id="modal-host" hidden class="fixed inset-0 z-[70] bg-midnight/70 flex items-center justify-center p-4"></div>
  `;

  const list = document.getElementById('tour-list') as HTMLElement;
  const newBtn = document.getElementById('new-tour-btn') as HTMLButtonElement;
  const modalHost = document.getElementById('modal-host') as HTMLElement;

  async function refresh(): Promise<void> {
    const tours = await listTours();
    if (tours.length === 0) {
      list.innerHTML = `
        <div class="bg-white border border-steel rounded p-5 text-sm text-midnight/70">
          No tours yet. Tap "New tour" to create one.
        </div>
      `;
      return;
    }
    list.innerHTML = tours.map(t => `
      <article class="bg-white border border-steel rounded p-4">
        <div class="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h3 class="font-serif text-lg">${escapeHtml(t.property.name || t.id)}</h3>
          <span class="text-[10px] uppercase tracking-wide font-bold ${
            t.status === 'pending'  ? 'text-midnight/60' :
            t.status === 'active'   ? 'text-pepper'      :
            'text-denim'
          }">${escapeHtml(t.status)}</span>
        </div>
        <div class="text-xs text-midnight/70 mb-1">
          ${t.prospectName ? escapeHtml(t.prospectName) + ' &middot; ' : ''}
          ${new Date(t.createdAt).toLocaleString()}
        </div>
        <div class="text-[10px] font-mono text-midnight/55 break-all mb-3">
          #/tour/${escapeHtml(t.id)}
        </div>
        <div class="flex gap-2 flex-wrap">
          <button class="btn-ghost text-xs" data-action="share" data-id="${escapeHtml(t.id)}">Share link</button>
          <button class="btn-ghost text-xs" data-action="open"  data-id="${escapeHtml(t.id)}">Open</button>
          ${t.status === 'complete' ? `<a class="btn-ghost text-xs" href="#/recap/${encodeURIComponent(t.id)}">View recap</a>` : ''}
        </div>
      </article>
    `).join('');
  }

  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn) return;
    const id = btn.dataset.id!;
    if (btn.dataset.action === 'open') {
      location.hash = `/tour/${id}`;
    } else if (btn.dataset.action === 'share') {
      openShareModal(id);
    }
  });

  newBtn.addEventListener('click', () => openNewTourModal());

  function closeModal(): void {
    modalHost.hidden = true;
    modalHost.innerHTML = '';
  }

  function openNewTourModal(): void {
    modalHost.hidden = false;
    modalHost.innerHTML = `
      <div class="permission-card max-w-md w-full">
        <h3 class="font-serif text-xl mb-1">New tour</h3>
        <p class="text-xs text-midnight/70 mb-4">A short URL will be generated. Text it to the prospect.</p>
        <label class="block mb-3">
          <span class="block text-[10px] font-bold uppercase tracking-wide text-midnight/70 mb-1">Property name</span>
          <input id="t-name" type="text" placeholder="San Felipe Plaza, Suite 1540" class="w-full border border-steel rounded px-3 py-2"/>
        </label>
        <label class="block mb-3">
          <span class="block text-[10px] font-bold uppercase tracking-wide text-midnight/70 mb-1">Prospect (optional)</span>
          <input id="t-prospect" type="text" placeholder="Acme Fintech" class="w-full border border-steel rounded px-3 py-2"/>
        </label>
        <label class="block mb-4">
          <span class="block text-[10px] font-bold uppercase tracking-wide text-midnight/70 mb-1">Address (optional)</span>
          <input id="t-address" type="text" placeholder="5847 San Felipe St, Houston TX" class="w-full border border-steel rounded px-3 py-2"/>
        </label>
        <div class="flex justify-end gap-2 flex-wrap">
          <button id="cancel-new" class="btn-ghost text-xs">Cancel</button>
          <button id="create-new" class="btn-primary">Create</button>
        </div>
      </div>
    `;
    document.getElementById('cancel-new')?.addEventListener('click', closeModal);
    document.getElementById('create-new')?.addEventListener('click', async () => {
      const name = (document.getElementById('t-name') as HTMLInputElement).value.trim();
      if (!name) return;
      const prospectName = (document.getElementById('t-prospect') as HTMLInputElement).value.trim();
      const address      = (document.getElementById('t-address')  as HTMLInputElement).value.trim();
      const id = newTourId();
      const tour: TourRecord = {
        id,
        status: 'pending',
        property: { name, address: address || undefined },
        prospectName: prospectName || undefined,
        createdAt: Date.now(),
        path: [],
        pauses: [],
        transcript: []
      };
      await saveTour(tour);
      closeModal();
      await refresh();
      openShareModal(id);
    });
  }

  async function openShareModal(id: string): Promise<void> {
    const tour = (await listTours()).find(t => t.id === id);
    if (!tour) return;
    const url = `${location.origin}${location.pathname}#/tour/${id}`;
    modalHost.hidden = false;
    modalHost.innerHTML = `
      <div class="permission-card max-w-md w-full">
        <h3 class="font-serif text-xl mb-1">${escapeHtml(tour.property.name)}</h3>
        <p class="text-xs text-midnight/70 mb-3">Send this URL to the prospect.</p>
        <canvas id="share-qr" width="256" height="256" class="block mx-auto mb-3"></canvas>
        <div class="text-[11px] font-mono break-all bg-stone p-2 rounded mb-4">${escapeHtml(url)}</div>
        <div class="flex justify-end gap-2 flex-wrap">
          <button id="copy-url" class="btn-ghost text-xs">Copy URL</button>
          <button id="close-share" class="btn-primary">Done</button>
        </div>
      </div>
    `;
    const canvas = document.getElementById('share-qr') as HTMLCanvasElement;
    QRCode.toCanvas(canvas, url, { width: 256, margin: 1 }).catch(() => {
      canvas.replaceWith(document.createTextNode('QR generation failed'));
    });
    document.getElementById('close-share')?.addEventListener('click', closeModal);
    document.getElementById('copy-url')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); } catch { /* noop */ }
    });
  }

  modalHost.addEventListener('click', (e) => {
    if (e.target === modalHost) closeModal();
  });

  refresh();
}
