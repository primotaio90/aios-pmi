import { requireUser, unauthorized } from '@/lib/apiAuth';

export async function GET(request: Request, { params }: { params: Promise<{ project: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project } = await params;
  try {
    return Response.json({ goals: await sys.engine.listGoals(project) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}

/** Consultant input → Orchestrator_Core. Returns 202: orchestration runs async. */
export async function POST(request: Request, { params }: { params: Promise<{ project: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project } = await params;
  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body JSON richiesto' }, { status: 400 });
  }
  if (!body.text || body.text.trim().length < 5) {
    return Response.json({ error: 'Campo "text" obbligatorio (min 5 caratteri)' }, { status: 400 });
  }
  try {
    const goal = await sys.engine.submitGoal(project, body.text.trim(), user.username);
    return Response.json({ goal }, { status: 202 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
