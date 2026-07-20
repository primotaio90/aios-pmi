import { requireUser, unauthorized } from '@/lib/apiAuth';

/** Home view: orchestrator + 3 directors only (progressive disclosure rule). */
export async function GET(request: Request, { params }: { params: Promise<{ project: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project } = await params;
  try {
    return Response.json(await sys.engine.overview(project));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
