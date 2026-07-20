import { requireUser, unauthorized } from '@/lib/apiAuth';

export async function GET(request: Request) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  return Response.json({ projects: await sys.store.listProjects() });
}

/** Creates a new tenant (PMI cliente) with the full directory scaffold. */
export async function POST(request: Request) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'consultant') {
    return Response.json({ error: 'Solo i consulenti possono creare progetti' }, { status: 403 });
  }
  let body: { id?: string; name?: string; client?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body JSON richiesto' }, { status: 400 });
  }
  if (!body.name) return Response.json({ error: 'Campo "name" obbligatorio' }, { status: 400 });
  const id =
    body.id ||
    body.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  try {
    const project = await sys.store.createProject({
      id,
      name: body.name,
      client: body.client || body.name,
      description: body.description || '',
    });
    sys.bus.emitEvent(id, 'notify', { level: 'info', message: `Progetto ${body.name} creato da ${user.name}` });
    return Response.json({ project }, { status: 201 });
  } catch (err) {
    return Response.json({ error: `Creazione fallita: ${(err as Error).message}` }, { status: 409 });
  }
}
