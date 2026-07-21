/**
 * Agent capability editor — grant/revoke MCP tools (require the aios_token cookie).
 * Writes the agent's mcp_whitelist frontmatter (agents/<id>.md); registry reloads.
 *   GET  /api/agents/:a/capabilities   → { available: [...], current: [...] }
 *   POST /api/agents/:a/capabilities   → { whitelist: string[] } → { available, current }
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
    return Response.json(sys.agentEditor.capabilities(agent));
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
  if (!Array.isArray(body.whitelist)) return bad('Campo "whitelist" (lista) obbligatorio');

  try {
    const result = await sys.agentEditor.setWhitelist(agent, body.whitelist as string[], {
      by: user.username,
      project: body.project ? String(body.project) : null,
    });
    return Response.json(result);
  } catch (err) {
    return bad(String((err as Error).message || err), 400);
  }
}
