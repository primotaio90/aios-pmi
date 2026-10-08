/**
 * Agent autonomy editor — the third permission axis (require the aios_token cookie).
 *   GET  /api/agents/:a/autonomy   → { available: [...], current: {auto,ask,never}, project }
 *   POST /api/agents/:a/autonomy   → { auto, ask, never, project?, session? }
 *                                    → { available, current, project }
 *
 * Same shape as /capabilities: without `project` it writes the agent's
 * frontmatter (agents/<id>.md, hot-reload); with `project` it writes the
 * durable per-tenant override (state/autonomy.json), which wins over the
 * frontmatter. `session: true` stores the override in memory only (never on
 * disk). Entries are flat `tool[:glob]` strings (frontmatter stays flat, §2).
 */
import { requireUser, unauthorized } from '@/lib/apiAuth';
import type { NextRequest } from 'next/server';

function bad(msg: string, status = 400) {
    return Response.json({ error: msg }, { status });
}

function cleanLists(body: Record<string, unknown>) {
    const out: { auto: string[]; ask: string[]; never: string[] } = { auto: [], ask: [], never: [] };
    for (const key of ['auto', 'ask', 'never'] as const) {
        const value = body[key];
        if (value === undefined || value === null) continue;
        if (!Array.isArray(value) || value.some((e) => typeof e !== 'string')) {
            throw new Error(`Campo "${key}" deve essere una lista di stringhe`);
        }
        out[key] = value as string[];
    }
    return out;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ agent: string }> }) {
    const { sys, user } = await requireUser(request);
    if (!user) return unauthorized();
    const { agent } = await params;
    const project = request.nextUrl.searchParams.get('project');

    try {
        const view = sys.agentEditor.autonomy(agent);
        // The effective per-tenant override, when a project is given, so the UI can
        // show both the agent default and the tenant-specific value.
        let projectOverride: { auto: string[]; ask: string[]; never: string[] } | null = null;
        if (project) {
            const all = await sys.store.readState(project, 'autonomy', {});
            projectOverride = (all?.[agent] as { auto: string[]; ask: string[]; never: string[] }) ?? null;
        }
        return Response.json({ ...view, project: projectOverride });
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

    let lists;
    try {
        lists = cleanLists(body);
    } catch (err) {
        return bad(String((err as Error).message || err));
    }

    const project = typeof body.project === 'string' && body.project.trim() ? body.project.trim() : null;
    const session = body.session === true;

    try {
        // Session override: in-memory only, never persisted. It is the
        // "approve for this session" lever (strada A): it can only LOOSEN the
        // durable policy (ask → auto), never add restrictions and never go
        // below the mode floor — resolvePolicy enforces that, so only the
        // `auto` list is meaningful here; ask/never entries are accepted but
        // have no effect by design.
        if (session) {
            if (!project) return bad('Un override di sessione richiede il campo "project"');
            sys.autonomy.setSessionOverride(project, agent, lists);
            const view = sys.agentEditor.autonomy(agent);
            return Response.json({ ...view, project: lists });
        }

        // Durable per-tenant override (state/autonomy.json), wins over frontmatter.
        if (project) {
            const saved = await sys.autonomy.setProjectOverride(project, agent, lists);
            sys.bus.emitEvent(project, 'agent.autonomy', { agent, by: user.username, scope: 'project' });
            const view = sys.agentEditor.autonomy(agent);
            return Response.json({ ...view, project: saved });
        }

        // Agent default: write the frontmatter (hot-reload).
        const result = await sys.agentEditor.setAutonomy(agent, lists, { by: user.username, project: null });
        return Response.json({ ...result, project: null });
    } catch (err) {
        return bad(String((err as Error).message || err), 400);
    }
}
