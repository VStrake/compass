export const config = { runtime: 'edge' };

// Phase 8 deliverable. v1 stub returns a placeholder recap so the rest of
// the pipeline can be wired without errors.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  return Response.json({
    narrativeSummary: 'Recap generation arrives in Phase 8.',
    highlights: [],
    questionsAndAnswers: [],
    nextSteps: [],
    specs: {}
  });
}
