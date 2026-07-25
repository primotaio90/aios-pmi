/**
 * Delivery desk — what is already deliverable to the client (require the
 * aios_token cookie).
 *   GET  /api/projects/:p/delivery   → { snapshot }  (deterministic, no LLM)
 *   POST /api/projects/:p/delivery   → { title?, include?, notes? }
 *                                    → 201 { delivery: { path, content }, snapshot }
 *
 * The package itself is written by the DeliveryDesk through the MCP gateway
 * (audit + `file.updated`), so this route only validates the input and hands
 * the logged-in consultant's username over as the author.
 */
import { requireUser, unauthorized } from '@/lib/apiAuth';
import type { NextRequest } from 'next/server';

const MAX_TITLE = 120;
const MAX_NOTES = 4000;

function bad(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ project: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project } = await params;

  try {
    await sys.store.readProject(project);
  } catch {
    return bad(`Progetto ${project} inesistente`, 404);
  }

  try {
    return Response.json({ snapshot: await sys.delivery.snapshot(project) });
  } catch (err) {
    return bad(String((err as Error).message || err), 500);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ project: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad('JSON non valido');
  }

  // Every field is optional; wrong shapes are rejected here so the desk never
  // receives junk (an empty `include` means "every ready item").
  let title: string | undefined;
  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title !== 'string') return bad('Campo "title" deve essere una stringa');
    title = body.title.trim();
    if (title.length > MAX_TITLE) return bad(`Campo "title" troppo lungo (max ${MAX_TITLE} caratteri)`);
  }

  let include: string[] = [];
  if (body.include !== undefined && body.include !== null) {
    if (!Array.isArray(body.include)) return bad('Campo "include" deve essere una lista di stringhe');
    const entries: unknown[] = body.include;
    if (entries.some((entry) => typeof entry !== 'string')) {
      return bad('Campo "include" deve contenere solo stringhe');
    }
    include = entries as string[];
  }

  let notes = '';
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== 'string') return bad('Campo "notes" deve essere una stringa');
    if (body.notes.length > MAX_NOTES) return bad(`Campo "notes" troppo lungo (max ${MAX_NOTES} caratteri)`);
    notes = body.notes;
  }

  try {
    const { path, content, snapshot } = await sys.delivery.produce(project, {
      title,
      include,
      notes,
      byUser: user.username,
    });
    return Response.json({ delivery: { path, content }, snapshot }, { status: 201 });
  } catch (err) {
    return bad(String((err as Error).message || err), 400);
  }
}
