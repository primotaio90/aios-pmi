import { requireUser, unauthorized } from '@/lib/apiAuth';

const LOG_NAMES: Record<string, string> = {
  events: 'events',
  mcp: 'mcp_calls',
  lifecycle: 'lifecycle',
};

export async function GET(request: Request, { params }: { params: Promise<{ project: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project } = await params;
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'events';
  const logName = LOG_NAMES[type];
  if (!logName) {
    return Response.json({ error: `type deve essere uno di: ${Object.keys(LOG_NAMES).join(', ')}` }, { status: 400 });
  }
  try {
    await sys.store.readProject(project);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }
  const rows = await sys.store.readLog(project, logName, {
    limit: Math.min(Number(url.searchParams.get('limit')) || 200, 1000),
    agent: url.searchParams.get('agent') || undefined,
  });
  return Response.json({ type, rows });
}
