export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `This image contains a printed architectural floor plan, possibly photographed at an angle. Your job:
1. Identify the four corners of the floor plan rectangle in the image (in source pixel coordinates, where (0,0) is top-left). Order them as: top-left, top-right, bottom-right, bottom-left.
2. Determine the natural rectified dimensions of the plan in pixels (preserve aspect ratio; 1500-2500 px on the longest side).
3. Identify each labeled room, returning its label, its polygon (in rectified pixel space, listed clockwise), and a category from: office, conference, open_office, kitchen, reception, restroom, storage, mechanical, corridor, other.

Return ONLY a JSON object with this exact shape, no prose:
{
  "corners": [{"x":n,"y":n},{"x":n,"y":n},{"x":n,"y":n},{"x":n,"y":n}],
  "rectifiedSize": {"w":n,"h":n},
  "rooms": [{"label":"...","polygon":[{"x":n,"y":n}],"type":"..."}]
}

If the image does not contain a recognizable floor plan, return {"error":"no_plan_detected"}.`;

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.ANTHROPIC_API_KEY
    ?? (globalThis as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json({ error: 'server_misconfigured' }, { status: 500 });
  }

  let body: { imageBase64?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const imageBase64 = body.imageBase64;
  if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
    return Response.json({ error: 'missing_image' }, { status: 400 });
  }

  let claudeRes: Response;
  try {
    claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 }
            },
            { type: 'text', text: SYSTEM_PROMPT }
          ]
        }]
      })
    });
  } catch (err) {
    return Response.json({ error: 'upstream_unreachable', detail: String(err).slice(0, 200) }, { status: 502 });
  }

  if (!claudeRes.ok) {
    const text = await claudeRes.text();
    return Response.json({ error: 'upstream_error', status: claudeRes.status, detail: text.slice(0, 400) }, { status: 502 });
  }

  const data = (await claudeRes.json()) as AnthropicResponse;
  const text = data.content?.find(c => c.type === 'text')?.text ?? '';
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Response.json(parsed);
  } catch {
    return Response.json({ error: 'parse_failed', raw: cleaned.slice(0, 600) }, { status: 502 });
  }
}
