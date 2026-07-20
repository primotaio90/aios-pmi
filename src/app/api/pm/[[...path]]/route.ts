/**
 * Fase 2 — Project Manager endpoints.
 * The PM is a server-side agent above the Orchestrator; the consultant logged in
 * drives it. Routes (all require the aios_token cookie):
 *   GET  /api/pm?project=<id>           → overview (KPIs + checklist + notifications)
 *   GET  /api/pm/suggestions?project=<> → next-action suggestions
 *   POST /api/pm/chat                   → { project, message } → { reply, history }
 *   POST /api/pm/notify                 → { project, to, subject, body }
 *   POST /api/pm/checklist              → { project, itemId, checked }
 * Unknown paths fall back to the reserved 501 (Fase 2 marker).
 */
import { requireUser, unauthorized } from '@/lib/apiAuth';
import type { NextRequest } from 'next/server';

function bad(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

export async function GET(request: NextRequest, { params }: { params: { path?: string[] } }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const segments = params.path || [];
  const project = url.searchParams.get('project') || segments[0] || '';
  if (!project) return bad('Parametro "project" obbligatorio');

  try {
    if (segments[0] === 'suggestions') {
      const suggestions = await sys.pm.suggestNext(project);
      return Response.json({ suggestions });
    }
    const overview = await sys.pm.overview(project);
    return Response.json({ overview });
  } catch (err) {
    return bad(String((err as Error).message || err), 404);
  }
}

export async function POST(request: NextRequest) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad('JSON non valido');
  }
  const project = String(body.project || '');
  if (!project) return bad('Campo "project" obbligatorio');
  const action = String(body.action || body.path || '');

  try {
    if (action === 'chat' || body.message !== undefined) {
      const message = String(body.message || '');
      const { reply, history } = await sys.pm.chat(project, message, user.username);
      return Response.json({ reply, history });
    }
    if (action === 'notify' || body.subject !== undefined) {
      const notif = await sys.pm.notifyConsultant(project, {
        to: String(body.to || 'consultants'),
        subject: String(body.subject || ''),
        body: String(body.body || ''),
        task_id: body.task_id ? String(body.task_id) : undefined,
        goal_id: body.goal_id ? String(body.goal_id) : undefined,
        level: (body.level as string) || 'info',
      });
      return Response.json({ notification: notif });
    }
    if (action === 'checklist' || body.itemId !== undefined) {
      const res = await sys.pm.toggleChecklist(project, String(body.itemId), Boolean(body.checked));
      return Response.json(res);
    }
    return bad('Azione PM non riconosciuta');
  } catch (err) {
    return bad(String((err as Error).message || err), 404);
  }
}

export async function PUT() {
  return reserved();
}
export async function PATCH() {
  return reserved();
}
export async function DELETE() {
  return reserved();
}

function reserved() {
  return Response.json(
    { error: 'Riservato al Project Manager (Fase 2)', docs: 'docs/FASE2_PM.md' },
    { status: 501 }
  );
}