# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

Compass is an indoor wayfinding web app for commercial real estate office tours. A prospect opens a link on an iPhone, points the camera at a printed floor plan, and walks the suite while the plan stays oriented to the direction they are facing. At the end, an AI-generated recap covers the path walked, rooms paused in, photos, and questions asked.

It is an internal Partners Real Estate tool. Primary target is **iOS 17+ Safari on a phone**, not desktop.

## Stack

Vanilla TypeScript. **No framework.** No React, no Vue, no JSX, no component library.

- **Vite 5** for dev server and bundling
- **TypeScript 5.6** in `strict` mode, `noEmit` (type-check only, Vite handles the transform)
- **Tailwind 3** for styling, plus hand-written component classes in `src/styles.css`
- **idb 8** as the IndexedDB wrapper
- **qrcode 1.5** for the share-link QR in admin
- **Vercel Edge Functions** for the two server endpoints in `api/`

Runtime dependencies are deliberately just `idb` and `qrcode`. The perspective warp is hand-rolled specifically to avoid an OpenCV dependency. Do not add dependencies casually; prefer a small local implementation.

## Commands

```bash
npm install
npm run dev          # Vite dev server with the edge-function shim, --host for LAN access
npm run dev:vercel   # vercel dev instead; auto-loads .env.local
npm run build        # tsc --noEmit && vite build
npm run preview      # serve the production build
```

**`npm run build` is the only verification gate in this repo.** There is no test suite, no linter, and no formatter config. Run it before every commit. It currently passes clean, so any error you see is yours.

The dev server listens on **port 5174** (`vite.config.ts`). The README still says 5173 in its local-development section; the config is the source of truth. If you touch either, make them agree.

## Environment

`ANTHROPIC_API_KEY` is required by `api/extract-plan.ts`. Copy `.env.example` to `.env.local` and fill it in.

`vite dev` does not automatically inject `.env.local` into the edge shim's `process.env`, so either export it inline:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

or use `npm run dev:vercel`, which loads `.env.local` itself.

`KV_REST_API_URL` / `KV_REST_API_TOKEN` are placeholders for Phase 9 shared recaps. Nothing reads them yet.

## iOS constraints that shape the code

- `getUserMedia` and the motion APIs require a **secure context**. Plain HTTP over LAN fails on iPhone. Test via a Vercel deploy or an HTTPS tunnel, not `http://YOUR-MAC-IP:5174`.
- `DeviceOrientationEvent.requestPermission()` / `DeviceMotionEvent.requestPermission()` are iOS-only and **must be called from a user gesture**. That is why `src/pages/onboarding.ts` gates every permission request behind a button click. Never move a permission request out of a click handler.
- Tap targets are minimum 44px tall. `.btn-primary` and `.btn-ghost` both enforce `min-height: 44px`.
- The viewport meta in `index.html` locks zoom and uses `viewport-fit=cover`. Camera and plan views are `position: fixed; inset: 0`.

## Layout

```
api/
  extract-plan.ts       Edge Function: Claude Vision floor plan corner + room extraction
  generate-recap.ts     Edge Function: end-of-tour recap (stub, returns placeholder)
src/
  main.ts               Hash router, RouteCtx type, go() helper
  pages/
    landing.ts          Index page
    onboarding.ts       Permission grant flow, hasOnboarded() gate
    tour.ts             Camera scan stage; live tracking is not built yet
    recap.ts            Stub
    admin.ts            Broker tour list, new-tour modal, share QR
  lib/
    brand.ts            Color tokens as a const object
    api.ts              Typed fetch clients for the two Edge Functions
    planExtraction.ts   Frame capture, plan heuristic, homography + warp
    storage.ts          IndexedDB schema and accessors
  styles.css            Tailwind directives + component and camera-view classes
index.html
vite.config.ts          Includes the edge-function dev shim
tailwind.config.ts      Brand colors and fonts
vercel.json             SPA rewrites, /api passthrough
```

## Architecture

### Routing

`src/main.ts` owns a hash router. `parseHash()` splits `#/route/param?query` into a `RouteCtx { route, param, query }`, and `dispatch()` is a `switch` on `ctx.route` that clears `#app` and calls one render function. `hashchange` and `popstate` both re-dispatch.

Routes: `` (landing), `tour/:id`, `recap/:id`, `admin`, `onboarding`. Unknown routes render an inline not-found block.

To add a page: create `src/pages/<name>.ts` exporting `render<Name>(root: HTMLElement, ctx?: RouteCtx)`, import it in `main.ts`, and add a `case` to the switch. Async render functions are called with `void` in the switch since `dispatch()` is synchronous.

### Rendering

Every page renders by assigning a template literal to `root.innerHTML`, then querying the elements it just wrote and attaching listeners with `addEventListener`. There is no virtual DOM, no reactivity, and no state container. Re-rendering means rebuilding the `innerHTML` string.

**Any interpolated dynamic value must be escaped.** `escapeHtml()` is defined locally in both `src/pages/tour.ts` and `src/pages/admin.ts` (duplicated on purpose so far). Property names, prospect names, tour IDs, statuses, and data URLs all go through it. If you add a page that interpolates stored or user-supplied data, escape it the same way.

### Storage

`src/lib/storage.ts` is the single IndexedDB layer. Database `compass`, version 1, opened lazily through a module-level `dbPromise` singleton.

Three object stores:

| Store | Key | Indexes |
| --- | --- | --- |
| `tours` | `id` | `by-status`, `by-createdAt` |
| `photos` | `id` | `by-tour` |
| `properties` | `slug` | none |

`TourRecord` is the central type: status, property defaults, the extracted `plan`, plus `path`, `pauses`, and `transcript` arrays that Phase 7 will fill.

Two conventions to preserve:

- **Photo IDs are namespaced `<tourId>:<suffix>`.** `listPhotosForTour()` and `deleteTour()` both rely on `id.startsWith(tourId + ':')`. Keep that prefix when writing photos.
- The `photos` `by-tour` index is declared on the `id` keyPath rather than a separate tour field, so it does not actually group by tour and no code uses it. The prefix filtering above is the working mechanism. If you need real per-tour indexing, that requires a schema version bump with an `upgrade` migration, not an in-place edit of the v1 `createObjectStore` call.

Tour IDs come from `newTourId()`: 8 characters from a 31-char alphabet that omits look-alike glyphs (`i`, `l`, `o`, `0`, `1`), drawn from `crypto.getRandomValues`. They end up in URLs a broker texts, so they need to survive being read aloud or retyped.

Nothing syncs to a server. All tour data is local to the device that created it, which is why the admin page and the prospect's phone see different data.

### Edge Functions

Both files in `api/` follow the Vercel Edge contract:

```ts
export const config = { runtime: 'edge' };
export default async function handler(req: Request): Promise<Response> { ... }
```

Web `Request` / `Response` only, no Node APIs. Because the edge runtime does not guarantee a `process` global, `extract-plan.ts` reads the API key through a defensive chain over `globalThis` rather than referencing `process.env` directly. Copy that pattern in new endpoints.

`vite.config.ts` contains `viteEdgeApiPlugin()`, a dev middleware that makes `npm run dev` sufficient for full-stack work: a request to `/api/<name>` is `ssrLoadModule`'d from `api/<name>.ts`, the Node request is reassembled into a Web `Request`, and the handler's `Response` is streamed back. A new file in `api/` is picked up with no config change. Handlers that need Node-specific behavior will diverge between the shim and production, so keep them to Web APIs.

Errors are returned as JSON with a stable string `error` code (`server_misconfigured`, `invalid_json`, `missing_image`, `upstream_unreachable`, `upstream_error`, `parse_failed`, `no_plan_detected`). The client branches on those codes, for example `tour.ts` matches `no_plan_detected` to show a friendlier hint. Add new codes rather than changing existing strings.

### Claude Vision extraction

`api/extract-plan.ts` posts a base64 JPEG plus a prompt to `https://api.anthropic.com/v1/messages` with `anthropic-version: 2023-06-01`. The model id is `claude-sonnet-4-5`, hardcoded in the request body; that literal is the one place to change it.

The prompt asks for a JSON-only reply containing four corners in source pixel space (ordered top-left, top-right, bottom-right, bottom-left), a rectified size, and labeled room polygons categorized as one of `office`, `conference`, `open_office`, `kitchen`, `reception`, `restroom`, `storage`, `mechanical`, `corridor`, `other`. The handler strips ``` fences before `JSON.parse` and returns `parse_failed` with a truncated raw excerpt on failure. The corner ordering is load-bearing for the warp downstream, so preserve it if you edit the prompt.

### Scan loop and geometry

`src/pages/tour.ts` runs the capture loop, and `src/lib/planExtraction.ts` holds the math.

The loop ticks every `FRAME_TICK_MS = 320`. Each tick calls `captureFrame()` (downscales to 1280px on the long edge, returns base64 JPEG at quality 0.85 plus an `ImageData`), then `frameLooksLikePlan()`, a cheap luminance sample every 50 pixels that passes when more than 40% of samples exceed luminance 175. Only frames that pass reach the API, and a `lastApiCall` timestamp plus `API_THROTTLE_MS = 3000` throttles further. A `pending` flag prevents overlapping requests. **Both gates exist to control API cost and latency; do not remove them.**

The perspective warp is hand-written: `unitSquareToQuad()` solves a homography from the unit square to a quad by the direct linear method, `homographyForQuads()` composes source and destination solves via `matMul(Hd, matInv(Hs))`, and `warpQuadToRect()` inverse-maps every destination pixel with bilinear sampling. Out-of-source pixels are filled with parchment `#f9f4ec` rather than transparent so the rectified plan reads as paper. This is a per-pixel JS loop over up to a 2500px-wide output, so it is the single most expensive operation in the app; keep it off any per-frame path.

`extractPlanFromFrame()` is the orchestrator that ties API call to warp and returns a `PlanData` ready for storage. It assumes Claude's corner coordinates are in the same downscaled pixel space that was sent, since `captureFrame()` output is what gets posted.

Cleanup matters here: `shutdown()` stops every `MediaStream` track, and it is wired to both the cancel button and a one-shot `hashchange` listener. A camera left running drains the phone battery and holds the hardware. Any new view that opens a stream must stop it on exit the same way.

## Brand and copy conventions

Partners Real Estate brand rules are not decorative; follow them.

- Palette: Midnight `#001C29`, Denim `#2D75B2`, Gold `#cfaf6c`, Pepper `#ec4325`, Steel `#bcd0df`, Sky `#dbe6ee`, Stone `#f1e7d1`, Parchment `#f9f4ec`.
- **These tokens are declared twice**, in `tailwind.config.ts` (as Tailwind color names) and `src/lib/brand.ts` (as a const object for canvas and inline use). Edit both or they drift.
- Georgia serif for headings, Arial for body. `styles.css` applies Georgia to `h1`–`h4` globally.
- A 4px Pepper bar (`.pepper-bar`) sits at the top of every page, above a Midnight `.header-bar`.
- Gold `.btn-primary` for the main action, outlined `.btn-ghost` for secondary.
- **No em dashes anywhere in user-facing copy.** The codebase currently has zero; use commas, periods, or parentheses instead. This is the convention most easily broken by an assistant writing new copy.
- Copy is plain and direct, addressed to a broker or a prospect standing in a suite, not to a developer.

Reusable classes live in the `@layer components` block of `src/styles.css` (`.btn-primary`, `.btn-ghost`, `.pepper-bar`, `.header-bar`), with the camera and plan views (`.scan-stage`, `.scan-frame`, `.scan-pulse`, `.scan-cancel`, `.plan-stage`, `.permission-card`, `.toast`) as plain CSS below it. Prefer these over rebuilding the same Tailwind utility strings.

Note the base-layer `[hidden] { display: none !important; }` rule: the HTML `hidden` attribute otherwise loses to Tailwind's `flex`/`grid` utilities. The admin modal host depends on it.

## Build state

Phases 1 through 4 are implemented: scaffold, onboarding permission gates, camera capture with the plan heuristic and in-browser warp, and the Claude Vision extraction endpoint.

Phases 5 through 13 are not built. Live tracking, two-tap calibration, the "you are here" dot, passive capture, and real recap generation are all still ahead. Current stubs and placeholders:

- `src/pages/tour.ts` → `renderActiveTourPlaceholder()` shows the rectified plan and detected room labels to confirm the pipeline works end to end. It is not the tour UI.
- `src/pages/recap.ts` renders a "arrives in Phase 8" placeholder.
- `api/generate-recap.ts` returns a hardcoded empty recap so the client can call it without error handling gymnastics.
- `src/lib/api.ts` exports a `RecapInput` type whose conditional is vestigial and unused; `generateRecap()` takes `unknown`. Give it a real shape when Phase 8 lands rather than preserving it.
- `src/pages/admin.ts` opens with a TODO: it has **no authentication** and must not be exposed publicly as-is.
- `manifest.webmanifest` has an empty `icons` array (Phase 12).
- `PathPoint`, `PausePoint`, `PhotoRecord`, `TranscriptSegment`, and `RecapData` are fully typed in `storage.ts` but nothing writes them yet. Those types are the intended contract for Phase 7 and 8; build to them.

The README's TODO list maps each remaining phase. When you complete one, update both the Status section and the TODO list in `README.md`.

## Working conventions

- Two-space indent, single quotes, semicolons. Multi-line imports and object literals are often column-aligned for readability (see `main.ts` imports and `brand.ts`); match the surrounding style.
- Explicit return types on exported functions, including `: void` and `: Promise<void>`.
- Result types are discriminated unions rather than thrown errors on the client path, either `{ ok: true, ... } | { ok: false, error: string }` or `T | { error: string }` narrowed with `'error' in result`. `generateRecap()` throws instead; that is the outlier.
- `strict` is on but `noUnusedLocals` and `noUnusedParameters` are off, which is what lets the stub pages accept unused `ctx`.
- Browser APIs missing from TypeScript's lib (`DeviceOrientationEvent.requestPermission`) are reached through a narrow inline `as unknown as { ... }` cast at the call site rather than a global declaration file. Keep those casts local and minimal.
- Comments explain intent and constraints ("Cheap (~3 ms on iPhone 12). Used to gate API calls.", "skip ambiguous chars"), not mechanics. Phase markers in comments tell you what is deliberately unfinished. Match that density; do not narrate obvious code.

## Git

Work happens on feature branches. The current branch is `claude/claude-md-docs-acbrpu`; `main` is the default. Push with `git push -u origin <branch>`. Do not open a pull request unless asked.

`dist/`, `node_modules/`, `.vercel/`, and all `.env*.local` files are gitignored. Never commit an API key.

## Deploy

Vercel. `vercel.json` rewrites `/api/(.*)` to the Edge Functions and everything else to `/index.html` for the hash-routed SPA. Vercel auto-detects `api/` and builds the static bundle with `vite build`.

```bash
vercel link
vercel env add ANTHROPIC_API_KEY
vercel deploy --prod
```

HTTPS comes free, which is what makes a deploy the practical way to test camera and motion on a real iPhone.
