'use client';

/**
 * Client-side rasterization of an imported plan file (M1.5 — ARCHITECTURE §8.1).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * Everything here runs in the browser: the source file never leaves the client
 * except as the base64 raster the extraction route asks for, and the raster is
 * also what gets pinned to the floor as a `FloorUnderlay`.
 *
 * ## Why rasterize at all
 * `core/import/extraction.ts` normalizes every coordinate onto the image's long
 * edge (`EXTRACTION_FRAME`), and `FloorUnderlay` stores a bitmap plus a
 * meters-per-*pixel* calibration. Both therefore need one concrete pixel raster,
 * and a PDF has to become one before either can happen. Page 1 only: a plan set
 * is one floor per page and the dialog imports one floor at a time.
 *
 * ## pdf.js worker
 * pdf.js does its parsing in a web worker. `GlobalWorkerOptions.workerSrc` is
 * resolved through `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
 * import.meta.url)` so the bundler emits the worker as a hashed asset of this
 * app — no CDN, no `public/` copy to keep in sync with the installed version,
 * and nothing to configure per deployment. The library is loaded through a
 * dynamic `import()` so neither pdf.js nor its worker is in the initial editor
 * bundle: the cost is paid the first time someone imports a PDF.
 */

/** A rasterized plan image, ready for calibration / extraction / underlay use. */
export interface RasterizedImage {
  /** `data:image/png;base64,…` — directly usable as `FloorUnderlay.imageDataUrl`. */
  dataUrl: string;
  /** Raster width in pixels (the calibration's pixel space). */
  width: number;
  /** Raster height in pixels. */
  height: number;
}

export interface RasterizedPdfPage extends RasterizedImage {
  /** Pages in the source document; only page 1 is rasterized. */
  pageCount: number;
}

/** Long-edge cap for the raster. Big enough to read a scale bar, small enough to POST. */
export const DEFAULT_MAX_DIM = 2400;

/** `accept` attribute for the file input / drop zone. */
export const PLAN_FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isRasterImageFile(file: File): boolean {
  return (
    (IMAGE_MIME_TYPES as readonly string[]).includes(file.type) ||
    /\.(png|jpe?g|webp)$/i.test(file.name)
  );
}

export function isSupportedPlanFile(file: File): boolean {
  return isPdfFile(file) || isRasterImageFile(file);
}

/** `"Level 12 test fit.pdf"` → `"Level 12 test fit"`. */
export function planNameFromFile(file: File): string {
  const withoutExtension = file.name.replace(/\.[^.]+$/, '');
  return withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || file.name;
}

// —— canvas helpers ————————————————————————————————————————————
/**
 * Scale factor that brings the long edge **down** to `maxDim`. Never upscales:
 * a small source image is imported at its own resolution rather than being
 * blown up into a blurry, needlessly heavy PNG.
 */
function downscaleFactor(width: number, height: number, maxDim: number): number {
  const longEdge = Math.max(width, height);
  if (!(longEdge > 0) || !(maxDim > 0)) return 1;
  return longEdge > maxDim ? maxDim / longEdge : 1;
}

function createCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not provide a 2D canvas for plan import.');
  return { canvas, ctx };
}

/** Decode an image URL (object URL or data URL) into a drawable element. */
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'sync';
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('The image could not be decoded. It may be corrupt or an unsupported format.'));
    image.src = url;
  });
}

/**
 * Draw `source` onto a white canvas at `scale` and encode it.
 * White matters: PDFs and PNGs are frequently transparent, and a transparent
 * plan is invisible against both the dark editor chrome and the 3D viewport.
 */
function encodeToCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  scale: number,
  mimeType: 'image/png' | 'image/jpeg',
  quality?: number,
): RasterizedImage {
  const { canvas, ctx } = createCanvas(sourceWidth * scale, sourceHeight * scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const dataUrl =
    quality === undefined ? canvas.toDataURL(mimeType) : canvas.toDataURL(mimeType, quality);
  return { dataUrl, width: canvas.width, height: canvas.height };
}

// —— pdf.js ————————————————————————————————————————————————————
type PdfJsModule = typeof import('pdfjs-dist');

let pdfJsPromise: Promise<PdfJsModule> | null = null;

/** Load pdf.js once and point it at the bundled worker. */
function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    if (pdfjs.GlobalWorkerOptions.workerSrc === '') {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
    }
    return pdfjs;
  });
  return pdfJsPromise;
}

/**
 * Rasterize page 1 of a PDF at `maxDim` on its long edge.
 *
 * Unlike {@link imageFileToDataUrl} this **does** scale up: a PDF page is
 * vector art measured in points (a Letter sheet is 792 pt long), so rendering it
 * at 1:1 would produce a ~100 dpi bitmap in which a printed dimension string is
 * unreadable to both the user and the extraction model.
 *
 * @throws Error with a user-presentable message on an unreadable/encrypted file.
 */
export async function renderPdfFirstPage(
  file: File,
  maxDim = DEFAULT_MAX_DIM,
): Promise<RasterizedPdfPage> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());

  // The plan is untrusted third-party input. pdf.js parses it inside its worker
  // and this build carries no eval-based font/JS execution path, so the default
  // options are already the safe ones; `enableXfa`/`pdfBug` stay off.
  const task = pdfjs.getDocument({ data });

  // Password-protected and malformed files reject here; surface the reason.
  const doc = await task.promise.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`This PDF could not be opened: ${message}`);
  });

  try {
    const pageCount = doc.numPages;
    const page = await doc.getPage(1);
    try {
      const unscaled = page.getViewport({ scale: 1 });
      const longEdge = Math.max(unscaled.width, unscaled.height);
      const scale = longEdge > 0 ? maxDim / longEdge : 1;
      const viewport = page.getViewport({ scale });

      const { canvas, ctx } = createCanvas(viewport.width, viewport.height);
      // pdf.js fills white itself unless the page declares transparency; do it
      // here too so a transparency-declaring page still lands on white paper.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Non-embedded standard fonts fall back to a system face (pdf.js logs a
      // warning); plan labels stay legible, which is all extraction needs.
      await page.render({ canvas, viewport }).promise;

      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        pageCount,
      };
    } finally {
      page.cleanup();
    }
  } finally {
    // `destroy()` lives on the loading task in pdf.js 6.x and tears down the
    // worker as well as the document.
    await task.destroy();
  }
}

/**
 * Decode a PNG/JPEG/WebP plan and re-encode it as PNG, downscaling to `maxDim`
 * when the source is larger. PNG keeps the underlay lossless and gives the
 * extraction route the one media type it is always guaranteed to accept.
 */
export async function imageFileToDataUrl(
  file: File,
  maxDim = DEFAULT_MAX_DIM,
): Promise<RasterizedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!(width > 0) || !(height > 0)) {
      throw new Error('The image reported no pixel dimensions and cannot be imported.');
    }
    return encodeToCanvas(image, width, height, downscaleFactor(width, height, maxDim), 'image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Rasterize whichever supported plan file the user picked. */
export async function rasterizePlanFile(
  file: File,
  maxDim = DEFAULT_MAX_DIM,
): Promise<RasterizedPdfPage> {
  if (isPdfFile(file)) return renderPdfFirstPage(file, maxDim);
  const raster = await imageFileToDataUrl(file, maxDim);
  return { ...raster, pageCount: 1 };
}

// —— request-budget re-encoding ————————————————————————————————
/** Base64 payload of a `data:` URL, i.e. what the extraction route measures. */
export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * Re-encode a raster as JPEG so its base64 fits inside `maxBase64Bytes`.
 *
 * A scanned plan can rasterize to a PNG whose base64 exceeds the route's 8 MB
 * cap, which would come back as a dead-end 413. JPEG at high quality is
 * visually indistinguishable for extraction purposes and is one of the route's
 * supported media types, so the *request* degrades while the *underlay* keeps
 * the original lossless PNG.
 *
 * @returns null when even the last attempt is still over budget.
 */
export async function reencodeWithinBudget(
  dataUrl: string,
  maxBase64Bytes: number,
): Promise<{ base64: string; mediaType: 'image/jpeg' } | null> {
  const image = await loadImageElement(dataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  // Progressively cheaper attempts: quality first, then resolution.
  const attempts: { scale: number; quality: number }[] = [
    { scale: 1, quality: 0.92 },
    { scale: 1, quality: 0.8 },
    { scale: 0.75, quality: 0.8 },
    { scale: 0.5, quality: 0.75 },
  ];

  for (const attempt of attempts) {
    const encoded = encodeToCanvas(
      image,
      width,
      height,
      attempt.scale,
      'image/jpeg',
      attempt.quality,
    );
    const base64 = base64FromDataUrl(encoded.dataUrl);
    if (base64.length <= maxBase64Bytes) return { base64, mediaType: 'image/jpeg' };
  }
  return null;
}
