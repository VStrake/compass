'use client';

/**
 * Browser-side client for `POST /api/extract-plan` (M1.5 — ARCHITECTURE §8.3).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * The route's contract is `{ imageBase64, mediaType, hints }` in and either
 * `{ plan }` or `{ error, message }` out, where `error` is a stable machine code
 * and `message` is already written for a human. This module keeps that mapping
 * in one place so the dialog only ever deals with an {@link ExtractPlanError}.
 *
 * The reply is re-run through `parseExtractedPlan` on the way in. The route
 * already validated it, but doing it again is cheap, removes the only place a
 * `JSON.parse` result would otherwise have to be cast to `ExtractedPlan`, and
 * means a future non-Next transport gets the same clamping for free.
 */

import { parseExtractedPlan, type ExtractedPlan } from '@/core/import/extraction';
import { base64FromDataUrl, reencodeWithinBudget } from './pdfToImage';

/** Mirrors `MAX_IMAGE_BASE64_BYTES` in the route, less a little header slack. */
const MAX_REQUEST_BASE64_BYTES = 8 * 1024 * 1024 - 4096;

/** Every `error` code the route can return, plus the two client-side ones. */
export type ExtractPlanErrorCode =
  | 'invalid-request'
  | 'image-too-large'
  | 'extraction-refused'
  | 'extraction-truncated'
  | 'extraction-empty'
  | 'extraction-malformed'
  | 'extraction-rate-limited'
  | 'extraction-unavailable'
  | 'extraction-failed'
  | 'network-error';

/** Short headline per code; the route's own `message` carries the detail. */
const ERROR_TITLES: Record<string, string> = {
  'invalid-request': 'The extraction request was rejected',
  'image-too-large': 'The plan image is too large to send',
  'extraction-refused': 'Claude declined to read this image',
  'extraction-truncated': 'The plan was too dense to read in one pass',
  'extraction-empty': 'No plan data came back',
  'extraction-malformed': 'The reading came back malformed',
  'extraction-rate-limited': 'Rate limited — try again in a moment',
  'extraction-unavailable': 'AI extraction is unavailable',
  'extraction-failed': 'Extraction failed',
  'network-error': 'Could not reach the extraction service',
};

export function extractionErrorTitle(code: string): string {
  return ERROR_TITLES[code] ?? ERROR_TITLES['extraction-failed'] ?? 'Extraction failed';
}

/**
 * True when the only sensible way forward is an underlay-only import: the
 * deployment has no working credential (HTTP 503), so re-running will not help.
 */
export function isExtractionUnavailable(error: ExtractPlanError): boolean {
  return error.status === 503 || error.code === 'extraction-unavailable';
}

/** True when re-running the same image has a realistic chance of succeeding. */
export function isRetryable(error: ExtractPlanError): boolean {
  return (
    error.code === 'extraction-rate-limited' ||
    error.code === 'extraction-empty' ||
    error.code === 'extraction-malformed' ||
    error.code === 'extraction-failed' ||
    error.code === 'network-error'
  );
}

export class ExtractPlanError extends Error {
  readonly code: ExtractPlanErrorCode;
  /** HTTP status, or 0 when the request never completed. */
  readonly status: number;

  constructor(code: ExtractPlanErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ExtractPlanError';
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asErrorCode(value: unknown): ExtractPlanErrorCode {
  return typeof value === 'string' && value in ERROR_TITLES
    ? (value as ExtractPlanErrorCode)
    : 'extraction-failed';
}

export interface ExtractPlanHints {
  floorName?: string;
  knownRsf?: number;
}

/**
 * Send one raster to the extraction route.
 *
 * @param imageDataUrl the rasterized plan, `data:image/png;base64,…`.
 * @throws ExtractPlanError for every failure path, transport included.
 */
export async function requestPlanExtraction(
  imageDataUrl: string,
  hints: ExtractPlanHints,
  signal?: AbortSignal,
): Promise<ExtractedPlan> {
  let imageBase64 = base64FromDataUrl(imageDataUrl);
  let mediaType: 'image/png' | 'image/jpeg' = 'image/png';

  // A dense scan can rasterize past the route's upload cap; trade PNG for JPEG
  // rather than hand the user an unfixable 413.
  if (imageBase64.length > MAX_REQUEST_BASE64_BYTES) {
    const smaller = await reencodeWithinBudget(imageDataUrl, MAX_REQUEST_BASE64_BYTES);
    if (!smaller) {
      throw new ExtractPlanError(
        'image-too-large',
        'This plan is too large to send for extraction even after compression. Re-export it at a lower resolution, or import it as an underlay and trace it manually.',
        413,
      );
    }
    imageBase64 = smaller.base64;
    mediaType = smaller.mediaType;
  }

  const requestHints: ExtractPlanHints = {};
  const floorName = hints.floorName?.trim();
  if (floorName) requestHints.floorName = floorName;
  if (typeof hints.knownRsf === 'number' && hints.knownRsf > 0) {
    requestHints.knownRsf = hints.knownRsf;
  }

  let response: Response;
  try {
    response = await fetch('/api/extract-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mediaType, hints: requestHints }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ExtractPlanError(
      'network-error',
      error instanceof Error
        ? `The extraction request did not complete: ${error.message}`
        : 'The extraction request did not complete.',
      0,
    );
  }

  if (!response.ok) {
    let code: ExtractPlanErrorCode = 'extraction-failed';
    let message = `The extraction service returned HTTP ${response.status}.`;
    try {
      const body: unknown = await response.json();
      if (isRecord(body)) {
        code = asErrorCode(body['error']);
        if (typeof body['message'] === 'string' && body['message'] !== '') {
          message = body['message'];
        }
      }
    } catch {
      // Non-JSON error body (a proxy error page, say) — keep the generic message.
    }
    throw new ExtractPlanError(code, message, response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ExtractPlanError(
      'extraction-malformed',
      'The extraction response was not valid JSON. Please try again.',
      response.status,
    );
  }

  try {
    return parseExtractedPlan(isRecord(body) ? body['plan'] : undefined);
  } catch {
    throw new ExtractPlanError(
      'extraction-malformed',
      'The extraction response did not contain a readable plan. Please try again.',
      response.status,
    );
  }
}
