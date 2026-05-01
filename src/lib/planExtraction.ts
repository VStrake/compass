import { extractPlan, type ExtractPlanResult } from './api';
import type { PlanData } from './storage';

/**
 * Quick in-browser heuristic: does the captured frame look like it might
 * contain a printed floor plan (a large light rectangular region)?
 *
 * Cheap (~3 ms on iPhone 12). Used to gate API calls.
 */
export function frameLooksLikePlan(imageData: ImageData): boolean {
  const { width: w, height: h, data } = imageData;
  let lightCount = 0;
  let totalCount = 0;
  // Sample every ~50 pixels.
  const step = 50;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 175) lightCount++;
      totalCount++;
    }
  }
  return totalCount > 0 && (lightCount / totalCount) > 0.40;
}

/**
 * Capture a single frame from a video element to a base64 JPEG plus an
 * ImageData for the heuristic. Downscales to fit within `maxLong` while
 * preserving aspect ratio.
 */
export function captureFrame(
  video: HTMLVideoElement,
  maxLong = 1280
): { base64: string; canvas: HTMLCanvasElement; imageData: ImageData } | null {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxLong / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const base64 = dataUrl.split(',')[1];
  return { base64, canvas, imageData };
}

// ---- perspective warp (no OpenCV dependency) ----

type Mat3 = number[]; // length 9, row-major

function matMul(a: Mat3, b: Mat3): Mat3 {
  const m = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      m[r * 3 + c] = s;
    }
  }
  return m;
}

function matInv(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) throw new Error('singular matrix');
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv
  ];
}

/**
 * Solve the 3x3 homography that maps the unit square [(0,0),(1,0),(1,1),(0,1)]
 * to the four supplied points. Standard direct linear method.
 */
function unitSquareToQuad(quad: { x: number; y: number }[]): Mat3 {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const sx  = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sy  = p0.y - p1.y + p2.y - p3.y;

  let g = 0, h = 0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // affine
    g = 0; h = 0;
  } else {
    const det = dx1 * dy2 - dy1 * dx2;
    g = (sx * dy2 - sy * dx2) / det;
    h = (dy1 * sx - dx1 * sy) / det;  // note sign symmetry
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;
  return [a, b, c, d, e, f, g, h, 1];
}

/**
 * 3x3 homography that maps the 4 source corners (in source pixel space)
 * onto the 4 destination corners (in dest pixel space).
 */
export function homographyForQuads(
  source: { x: number; y: number }[],
  dest:   { x: number; y: number }[]
): Mat3 {
  const Hs = unitSquareToQuad(source);
  const Hd = unitSquareToQuad(dest);
  return matMul(Hd, matInv(Hs));
}

/**
 * Apply a perspective warp to a source canvas, producing a rectified
 * destination canvas.
 */
export function warpQuadToRect(
  sourceCanvas: HTMLCanvasElement,
  sourceCorners: { x: number; y: number }[],
  destW: number,
  destH: number
): HTMLCanvasElement {
  const dest = document.createElement('canvas');
  dest.width = destW;
  dest.height = destH;
  const dctx = dest.getContext('2d');
  const sctx = sourceCanvas.getContext('2d');
  if (!dctx || !sctx) throw new Error('canvas context unavailable');

  const srcImg = sctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const out = dctx.createImageData(destW, destH);

  const destCorners = [
    { x: 0,        y: 0 },
    { x: destW,    y: 0 },
    { x: destW,    y: destH },
    { x: 0,        y: destH }
  ];
  const Hinv = homographyForQuads(destCorners, sourceCorners); // dest -> source

  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;

  for (let y = 0; y < destH; y++) {
    for (let x = 0; x < destW; x++) {
      const w = Hinv[6] * x + Hinv[7] * y + Hinv[8];
      const sx = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / w;
      const sy = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / w;

      const oi = (y * destW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        // outside source: leave transparent black
        out.data[oi] = 249; out.data[oi + 1] = 244; out.data[oi + 2] = 236; out.data[oi + 3] = 255;
        continue;
      }
      // bilinear sample
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = ((y0 + 1) * sw + x0) * 4;
      const i11 = i01 + 4;
      const sd = srcImg.data;
      for (let c = 0; c < 3; c++) {
        const a = sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx;
        const b = sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx;
        out.data[oi + c] = a * (1 - fy) + b * fy;
      }
      out.data[oi + 3] = 255;
    }
  }
  dctx.putImageData(out, 0, 0);
  return dest;
}

/**
 * High-level: given a captured base64 frame, get a rectified plan from
 * Claude. Returns the PlanData suitable for storage.
 */
export async function extractPlanFromFrame(
  base64: string,
  capturedCanvas: HTMLCanvasElement,
  signal?: AbortSignal
): Promise<{ ok: true; plan: PlanData } | { ok: false; error: string }> {
  const result = await extractPlan(base64, signal);
  if ('error' in result) return { ok: false, error: result.error };
  const er = result as ExtractPlanResult;
  if (!er.corners || er.corners.length !== 4 || !er.rectifiedSize) {
    return { ok: false, error: 'invalid_response' };
  }
  // Scale corners back to capturedCanvas pixel space if Claude returned them
  // in the same scale (we pass the downscaled image, so they should match).
  const rectified = warpQuadToRect(
    capturedCanvas,
    er.corners,
    Math.max(1, Math.round(er.rectifiedSize.w)),
    Math.max(1, Math.round(er.rectifiedSize.h))
  );
  return {
    ok: true,
    plan: {
      imageDataUrl: rectified.toDataURL('image/jpeg', 0.85),
      sourceCorners: er.corners,
      rectifiedSize: er.rectifiedSize,
      rooms: er.rooms ?? []
    }
  };
}
