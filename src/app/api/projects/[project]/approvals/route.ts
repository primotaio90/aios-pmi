/**
 * Approval queue — the `ask` calls waiting for a human decision (require the
 * aios_token cookie).
 *   GET  /api/projects/:p/approvals   → { approvals: [...] }   (pending, newest first)
 *   POST /api/projects/:p/approvals   → { id, approved }       → { approval }
 *
 * Resolving emits `mcp.approval_resolved` and settles the Promise the gateway
 * is awaiting, so the paused tool call either proceeds (approved) or is denied
 * (the engine task then falls back to `blocked`).
 */
import { requireUser, unauthorized } from '@/lib/apiAuth';
import type { NextRequest } from 'next/server';

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
        // `?all=1` returns the recent history (incl. stale/resolved) for the panel;
        // the default stays the live pending queue (backwards compatible).
        const all = request.nextUrl.searchParams.get('all') === '1';
        const approvals = all ? await sys.approvals.list(project) : await sys.approvals.pendingList(project);
        return Response.json({ approvals });
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
    if (typeof body.id !== 'string' || !body.id.trim()) return bad('Campo "id" obbligatorio');
    if (typeof body.approved !== 'boolean') return bad('Campo "approved" (boolean) obbligatorio');

    try {
        const approval = await sys.approvals.resolve(project, body.id.trim(), body.approved, user.username);
        if (!approval) return bad(`Approvazione ${body.id} sconosciuta o già decisa`, 404);
        return Response.json({ approval });
    } catch (err) {
        return bad(String((err as Error).message || err), 400);
    }
}
