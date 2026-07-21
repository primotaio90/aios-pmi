/**
 * Direct chat with a single agent (require the aios_token cookie).
 *   GET  /api/projects/:p/agents/:a/chat   → { history }
 *   POST /api/projects/:p/agents/:a/chat   → { message } → { reply, history }
 */
import { requireUser, unauthorized } from '@/lib/apiAuth';
import type { NextRequest } from 'next/server';

function bad(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string; agent: string }> }
) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project, agent } = await params;
  try {
    const history = await sys.chat.history(project, agent);
    return Response.json({ history });
  } catch (err) {
    return bad(String((err as Error).message || err), 404);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ project: string; agent: string }> }
) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project, agent } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad('JSON non valido');
  }

  try {
    const { reply, history } = await sys.chat.send(project, agent, String(body.message || ''), user.username);
    return Response.json({ reply, history });
  } catch (err) {
    return bad(String((err as Error).message || err), 400);
  }
}
