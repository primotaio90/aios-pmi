/**
 * Durable operative notes for an agent (require the aios_token cookie).
 * A note is appended to the agent's system prompt (agents/<id>.md) and persists
 * across future runs; the registry hot-reloads immediately.
 *   GET  /api/agents/:a/instructions   → { notes: [{ts,text}] }
 *   POST /api/agents/:a/instructions   → { text } → { notes }
 */
import { requireUser, unauthorized } from '@/lib/apiAuth';
import type { NextRequest } from 'next/server';

function bad(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ agent: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { agent } = await params;
  try {
    return Response.json({ notes: sys.agentEditor.notes(agent) });
  } catch (err) {
    return bad(String((err as Error).message || err), 404);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ agent: string }> }) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { agent } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad('JSON non valido');
  }

  try {
    const notes = await sys.agentEditor.appendInstruction(agent, String(body.text || ''), {
      by: user.username,
      project: body.project ? String(body.project) : null,
    });
    return Response.json({ notes });
  } catch (err) {
    return bad(String((err as Error).message || err), 400);
  }
}
