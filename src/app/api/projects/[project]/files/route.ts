import { requireUser, unauthorized } from '@/lib/apiAuth';

/** Reads a project file (viewer). Paths are safe-joined inside the tenant. */
export async function GET(request: Request, { params }: { params: Promise<{ project: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project } = await params;
  const path = new URL(request.url).searchParams.get('path');
  if (!path) return Response.json({ error: 'Parametro "path" obbligatorio' }, { status: 400 });
  try {
    const content = await sys.store.readFile(project, path);
    return Response.json({ path, content });
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes('fuori dal progetto') || message.includes('non valido') ? 400 : 404;
    return Response.json({ error: message }, { status });
  }
}
