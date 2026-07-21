import { requireUser, unauthorized } from '@/lib/apiAuth';

type AgentRecord = Record<string, unknown> & { system_prompt?: string };

/**
 * Agent registry view: every agent defined in agents/*.md, plus validation
 * errors. Adding a new .md file appears here without restart (fs.watch).
 * System prompts are not exposed to the client (only their size).
 */
export async function GET(request: Request) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const agents = sys.registry.all().map((a: AgentRecord) => {
    const { system_prompt, ...meta } = a;
    return { ...meta, system_prompt_chars: String(system_prompt || '').length };
  });
  return Response.json({ agents, errors: sys.registry.errors, runner: await sys.getProvider() });
}
