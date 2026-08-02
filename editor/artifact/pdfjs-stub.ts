/**
 * pdfjs-dist stand-in for the single-file demo bundle. The sandboxed artifact
 * host cannot start pdf.js's module worker (CSP), and bundling the 1.6 MB
 * library into the demo would be dead weight — so PDF ingest fails fast with a
 * clear message there. Image import (PNG/JPEG/WebP) is unaffected.
 */
export const GlobalWorkerOptions = { workerSrc: '' };

export function getDocument(): never {
  throw new Error(
    'PDF import is not available in the demo build — export the plan page as a PNG or JPEG image, or run the full app (npm run dev) for PDF support.',
  );
}
