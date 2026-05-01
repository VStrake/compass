import type { PlanData } from './storage';

export interface ExtractPlanResult {
  corners: { x: number; y: number }[];
  rectifiedSize: { w: number; h: number };
  rooms: { label: string; type: string; polygon: { x: number; y: number }[] }[];
}

export interface ExtractPlanError {
  error: string;
}

/**
 * Send a captured camera frame (base64 JPEG) to the Edge Function. Returns
 * the parsed Claude Vision result, or an error code.
 */
export async function extractPlan(
  imageBase64: string,
  signal?: AbortSignal
): Promise<ExtractPlanResult | ExtractPlanError> {
  const res = await fetch('/api/extract-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 }),
    signal
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return res.json();
}

export type RecapInput = {
  property: PlanData['rooms'] extends never ? never : Record<string, unknown>;
  tour: Record<string, unknown>;
};

export async function generateRecap(payload: unknown): Promise<unknown> {
  const res = await fetch('/api/generate-recap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
