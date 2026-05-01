# Compass

Indoor wayfinding for commercial real estate office tours. Scan a printed floor plan with your iPhone camera, walk the suite, the plan stays oriented to where you are facing. End-of-tour: an AI-generated recap with your path, paused rooms, photos, and questions.

## Status

Phases 1 through 4 of the build are in place:

- **Phase 1:** project scaffold (Vite + TypeScript + Tailwind + idb + qrcode), hash router, brand tokens, landing page
- **Phase 2:** onboarding with permission gates (motion, orientation, camera, microphone)
- **Phase 3:** camera capture loop, plan candidate detection heuristic, in-browser perspective warp (no OpenCV dependency)
- **Phase 4:** Vercel Edge Function (`api/extract-plan.ts`) that calls Claude Sonnet for floor plan corner detection and room labeling

Phases 5 through 13 are stubbed and land in subsequent commits. The tour view, after capturing and rectifying the plan, currently shows the rectified image and detected rooms as a confirmation that the pipeline works end-to-end. Live tracking, two-tap calibration, the "you are here" dot, passive capture, and recap generation come next.

## Setup

```bash
cd compass
npm install
cp .env.example .env.local
# edit .env.local and paste your ANTHROPIC_API_KEY
```

## Local development

The Vite dev server includes a small middleware that emulates Vercel Edge Functions: any request to `/api/<name>` is dispatched to `api/<name>.ts` with the same `Request -> Response` contract Vercel uses in production. So a single `npm run dev` is enough for full-stack local work.

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

(Or put the key in `.env.local` and Vite will pick it up if you also `export $(cat .env.local | xargs)` before launching. Or run with `vercel dev` instead, which auto-loads `.env.local`.)

Open `http://localhost:5173` on the Mac and `http://YOUR-MAC-IP:5173` on the iPhone over the same wifi.

> **iOS gotcha:** `getUserMedia` and the motion APIs require a **secure context**. Plain HTTP over LAN will fail. Either deploy to Vercel (HTTPS by default) or tunnel localhost through a service like Cloudflare Tunnel for iPhone testing.

## Project layout

```
compass/
  api/
    extract-plan.ts            Vercel Edge Function: Claude Vision floor plan extraction
    generate-recap.ts          Vercel Edge Function: end-of-tour recap (stub for now)
  src/
    main.ts                    Hash router entry
    pages/
      landing.ts               Index page
      onboarding.ts            Permission grant flow
      tour.ts                  Camera capture + scan stage + (later) live tracking
      recap.ts                 Stub (Phase 8)
      admin.ts                 Broker tour list + new tour modal + share QR
    lib/
      brand.ts                 Color tokens
      api.ts                   Client for the Edge Functions
      planExtraction.ts        Frame capture + perspective warp + extraction orchestration
      storage.ts               IndexedDB wrapper (idb): tours, photos, properties
    styles.css                 Tailwind + custom brand styles
  index.html
  manifest.webmanifest
  vercel.json
  vite.config.ts (with edge-function dev shim)
  tailwind.config.ts
  postcss.config.js
  tsconfig.json
  package.json
  .env.example
```

## Deploy to Vercel

```bash
npm install -g vercel
vercel link
vercel env add ANTHROPIC_API_KEY    # paste the key when prompted
vercel deploy --prod
```

Vercel auto-detects the Edge Functions in `api/` and the static SPA from `vite build`.

## Brand

Partners Real Estate brand tokens are in `src/lib/brand.ts` and `tailwind.config.ts`. 4px Pepper bar at the top of every page; Midnight headers; Gold CTAs (44px min height for iOS tap targets); Georgia serif for headlines, Arial for body. No em dashes anywhere in copy.

## TODO

- Phase 5: tracking + two-tap calibration + plan canvas with dot and cone
- Phase 6: recalibration + confidence indicator
- Phase 7: passive capture (path / pauses / photos / transcript)
- Phase 8: recap generation Edge Function and recap page
- Phase 9: Vercel KV for shared recaps + Web Share API
- Phase 10: admin polish (per-property defaults, exports)
- Phase 11: wall-view perspective transition + window labelling
- Phase 12: PWA polish (service worker, manifest icons)
- Phase 13: README expansion with deployment + iPhone testing flow

## License

Internal Partners Real Estate tool.
