/**
 * LLM settings endpoints (require the aios_token cookie).
 *   GET  /api/settings          → { settings (masked), catalog, providers, servers }
 *   POST /api/settings          → { message } patch: { provider, anthropic, openai,
 *                                    params, agentModelOverrides } → { settings }
 *
 * API keys are never returned in clear (publicSettings masks them). An empty /
 * masked apiKey in a POST leaves the stored key unchanged. Reads/writes a
 * gitignored file; on serverless the write is a no-op that won't persist.
 */
import { requireUser, unauthorized } from '@/lib/apiAuth';
import type { NextRequest } from 'next/server';
import { publicSettings, saveSettings, PROVIDERS } from '@/lib/aios/settings.mjs';
import { MODEL_CATALOG } from '@/lib/aios/models.mjs';

function bad(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

export async function GET(request: NextRequest) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const settings = await publicSettings();
  // Declarative MCP server/tool catalog (used by the capability editor later).
  const servers = sys.gateway?.config?.servers ?? {};
  return Response.json({ settings, catalog: MODEL_CATALOG, providers: PROVIDERS, servers });
}

export async function POST(request: NextRequest) {
  const { user } = await requireUser(request);
  if (!user) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad('JSON non valido');
  }

  try {
    await saveSettings(body);
    const settings = await publicSettings();
    return Response.json({ settings });
  } catch (err) {
    return bad(String((err as Error).message || err), 500);
  }
}
