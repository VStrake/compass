import './styles.css';
import { renderLanding }    from './pages/landing';
import { renderTour }       from './pages/tour';
import { renderRecap }      from './pages/recap';
import { renderAdmin }      from './pages/admin';
import { renderOnboarding } from './pages/onboarding';

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app root element');

export interface RouteCtx {
  route: string;
  param?: string;
  query: URLSearchParams;
}

function parseHash(): RouteCtx {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const route = segments[0] ?? '';
  const param = segments[1];
  const query = new URLSearchParams(queryPart || '');
  return { route, param, query };
}

function dispatch(): void {
  const ctx = parseHash();
  app!.innerHTML = '';
  switch (ctx.route) {
    case '':           renderLanding(app!); return;
    case 'tour':       void renderTour(app!, ctx); return;
    case 'recap':      renderRecap(app!, ctx); return;
    case 'admin':      void renderAdmin(app!); return;
    case 'onboarding': renderOnboarding(app!, ctx); return;
    default:
      app!.innerHTML = `
        <div class="min-h-screen bg-parchment">
          <div class="pepper-bar"></div>
          <header class="header-bar"><h1 class="font-serif text-xl">Compass</h1></header>
          <div class="p-6">
            <h2 class="font-serif text-2xl mb-3">Page not found</h2>
            <a href="#/" class="btn-primary">Go home</a>
          </div>
        </div>
      `;
  }
}

dispatch();
window.addEventListener('hashchange', dispatch);
window.addEventListener('popstate', dispatch);

export function go(path: string): void {
  if (location.hash === '#' + path) {
    dispatch();
  } else {
    location.hash = '#' + path;
  }
}
