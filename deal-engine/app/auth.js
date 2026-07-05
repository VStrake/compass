/*
 * Auth gate scaffold.
 *
 * Local use has no login. AUTH_ENABLED is false, so ensureAuth() resolves
 * immediately and the app renders.
 *
 * For a Vercel deployment you have two options:
 *
 * 1. Real protection (recommended): use Vercel Deployment Protection
 *    (Password Protection in the project settings) or an Edge Middleware
 *    that checks a server-held secret. See middleware.js.example in the
 *    project root. That is the only way to actually keep the data private,
 *    because the JSON is served to the client.
 *
 * 2. Convenience gate: flip AUTH_ENABLED to true and set GATE_PASSWORD.
 *    This only hides the UI behind a shared secret in the client bundle.
 *    It is NOT real security (anyone can read the source and fetch the
 *    JSON directly) but it stops a casual over-the-shoulder open. Use it
 *    together with option 1, never instead of it.
 */

const AUTH_ENABLED = false;
const GATE_PASSWORD = ""; // set when AUTH_ENABLED is true, option 2 only
const SESSION_KEY = "deal-engine-auth";

function renderGate(resolve) {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="gate">
      <form id="gate-form">
        <h2>Deal Engine</h2>
        <div class="err" id="gate-err" style="display:none">Wrong password.</div>
        <input
          type="password"
          id="gate-pw"
          placeholder="Password"
          autocomplete="current-password"
          autofocus
        />
        <button type="submit">Unlock</button>
      </form>
    </div>
  `;
  const form = document.getElementById("gate-form");
  const err = document.getElementById("gate-err");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = document.getElementById("gate-pw").value;
    if (val && val === GATE_PASSWORD) {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch (_) {
        /* private mode, fall through */
      }
      resolve();
    } else {
      err.style.display = "block";
    }
  });
}

export function ensureAuth() {
  if (!AUTH_ENABLED) return Promise.resolve();
  let ok = false;
  try {
    ok = sessionStorage.getItem(SESSION_KEY) === "1";
  } catch (_) {
    ok = false;
  }
  if (ok) return Promise.resolve();
  return new Promise((resolve) => renderGate(resolve));
}
