import { requireUser, unauthorized } from '@/lib/apiAuth';

export async function GET(request: Request, { params }: { params: Promise<{ project: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project } = await params;
  const url = new URL(request.url);
  const filter = {
    department: url.searchParams.get('department') || undefined,
    status: url.searchParams.get('status') || undefined,
    goal_id: url.searchParams.get('goal_id') || undefined,
  };
  try {
    await sys.store.readProject(project);
    return Response.json({ tasks: await sys.tasks.list(project, filter) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
}
