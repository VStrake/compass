/**
 * POST /api/extract-plan — AI reading of a floor-plan image (M1.5, ARCHITECTURE §8.3).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * The client sends a base64 raster of one floor plan; this route asks
 * `claude-opus-5` for a strict-schema structured reading of it
 * (`output_config.format`) and returns the validated `ExtractedPlan`. All
 * coordinate/geometry semantics live in `core/import/extraction.ts`; this file
 * is only transport, auth and error mapping.
 *
 * Node runtime: the Anthropic SDK is a Node client and the request bodies here
 * (multi-MB base64) are larger than the edge runtime is a good fit for.
 *
 * Route modules may only export HTTP verb handlers and route config, so the
 * prompt lives in `core/import/extractionPrompt.ts` (server-only by convention)
 * and nothing else is exported from here.
 */

import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

import { EXTRACTION_JSON_SCHEMA, parseExtractedPlan } from '@/core/import/extraction';
import {
  EXTRACTION_PROMPT,
  formatExtractionHints,
  type ExtractionHints,
} from '@/core/import/extractionPrompt';

export const runtime = 'nodejs';

/** Model used for extraction. Vision + structured outputs + strong plan reading. */
const EXTRACTION_MODEL = 'claude-opus-5';
/** Headroom for a full plate (walls + zones + cores + openings + columns). */
const EXTRACTION_MAX_TOKENS = 16000;
/** Reject oversized payloads before touching the API: 8 MB of base64 text. */
const MAX_IMAGE_BASE64_BYTES = 8 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

interface ExtractPlanRequest {
  imageBase64: string;
  mediaType: SupportedMediaType;
  hints?: ExtractionHints;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function badRequest(message: string) {
  return NextResponse.json({ error: 'invalid-request', message }, { status: 400 });
}

/** Validate the POST body. Returns either a typed request or a ready response. */
function readBody(body: unknown): ExtractPlanRequest | NextResponse {
  if (!isRecord(body)) return badRequest('Request body must be a JSON object.');

  const imageBase64 = body['imageBase64'];
  if (typeof imageBase64 !== 'string' || imageBase64 === '') {
    return badRequest('"imageBase64" must be a non-empty base64 string (no data-URL prefix).');
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_BYTES) {
    return NextResponse.json(
      {
        error: 'image-too-large',
        message:
          'The image exceeds the 8 MB upload limit. Re-export the plan at a lower resolution or as JPEG and try again.',
      },
      { status: 413 },
    );
  }

  const mediaType = body['mediaType'];
  if (
    typeof mediaType !== 'string' ||
    !(SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mediaType)
  ) {
    return badRequest(`"mediaType" must be one of ${SUPPORTED_MEDIA_TYPES.join(', ')}.`);
  }

  const rawHints = body['hints'];
  const hints: ExtractionHints = {};
  if (isRecord(rawHints)) {
    if (typeof rawHints['floorName'] === 'string') hints.floorName = rawHints['floorName'];
    if (typeof rawHints['knownRsf'] === 'number') hints.knownRsf = rawHints['knownRsf'];
  }

  return { imageBase64, mediaType: mediaType as SupportedMediaType, hints };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body is not valid JSON.');
  }

  const parsed = readBody(body);
  if (parsed instanceof NextResponse) return parsed;
  const { imageBase64, mediaType, hints } = parsed;

  // Deployments without a credential must fail loudly and cheaply — underlay-
  // only import stays available in the dialog when extraction is unavailable.
  // Either credential form works: ANTHROPIC_API_KEY (sk-ant-api...) or
  // ANTHROPIC_AUTH_TOKEN (OAuth bearer, which requires the oauth beta header).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey && !authToken) {
    return NextResponse.json(
      {
        error: 'extraction-unavailable',
        message:
          'AI plan extraction is not configured on this deployment (set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN). You can still import the plan as a floor underlay and trace it manually.',
      },
      { status: 503 },
    );
  }

  const client = apiKey
    ? new Anthropic({ apiKey })
    : new Anthropic({
        apiKey: null,
        authToken,
        defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
      });
  const hintBlock = formatExtractionHints(hints);

  try {
    const response = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: EXTRACTION_MAX_TOKENS,
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_JSON_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: EXTRACTION_PROMPT },
            ...(hintBlock ? [{ type: 'text' as const, text: hintBlock }] : []),
          ],
        },
      ],
    });

    // Check the stop reason BEFORE reading content: a refusal carries no usable
    // content at all, and a truncated reply carries invalid JSON.
    if (response.stop_reason === 'refusal') {
      return NextResponse.json(
        {
          error: 'extraction-refused',
          message:
            response.stop_details?.explanation ??
            'The extraction request was declined by Claude’s safety systems. You can still import this plan as a floor underlay.',
        },
        { status: 422 },
      );
    }

    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json(
        {
          error: 'extraction-truncated',
          message:
            'The plan was too dense to read in one pass — the response was cut off. Try cropping the image to a single floor plan, or import it as an underlay and trace it manually.',
        },
        { status: 422 },
      );
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      return NextResponse.json(
        {
          error: 'extraction-empty',
          message: 'Claude returned no plan data for this image.',
        },
        { status: 502 },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(textBlock.text);
    } catch {
      return NextResponse.json(
        {
          error: 'extraction-malformed',
          message: 'The extraction result was not valid JSON. Please try again.',
        },
        { status: 502 },
      );
    }

    const plan = parseExtractedPlan(json);
    return NextResponse.json({ plan });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: 'extraction-rate-limited', message: error.message },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        {
          error: 'extraction-unavailable',
          message:
            'AI plan extraction is misconfigured on this deployment (the API credential was rejected). You can still import the plan as a floor underlay.',
        },
        { status: 503 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        {
          error: 'extraction-failed',
          message: `The extraction service returned an error: ${error.message}`,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: 'extraction-failed',
        message: error instanceof Error ? error.message : 'Plan extraction failed unexpectedly.',
      },
      { status: 500 },
    );
  }
}
