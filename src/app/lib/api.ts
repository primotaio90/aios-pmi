// Client-side API helpers + SSE hook for the AIOS dashboard.
import { useEffect, useRef, useState } from 'react';
import type {
    BusEvent,
    DirectorDrilldown,
    FileContent,
    Goal,
    LogsResponse,
    OverviewResponse,
    PMChatResponse,
    PMChecklistToggle,
    PMOverview,
    PMSuggestion,
    ProjectMeta,
    RegistryResponse,
    SessionUser,
    Task,
} from './types';

export class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.name = 'ApiError';
    }
}

async function asJson(res: Response) {
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json().catch(() => ({})) : {};
    if (!res.ok) {
        const message =
            (body && typeof body === 'object' && 'error' in body && String((body as { error: unknown }).error)) ||
            `${res.status} ${res.statusText}`;
        throw new ApiError(res.status, message);
    }
    return body;
}

export const api = {
    async me(): Promise<SessionUser | null> {
        const res = await fetch('/api/me', { cache: 'no-store' });
        if (res.status === 401) return null;
        const body = await asJson(res);
        return (body as { user: SessionUser }).user ?? null;
    },

    async login(username: string, password: string): Promise<SessionUser> {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const body = await asJson(res);
        return (body as { user: SessionUser }).user;
    },

    async logout(): Promise<void> {
        await fetch('/api/login', { method: 'DELETE' });
    },

    async agents(): Promise<RegistryResponse> {
        const res = await fetch('/api/agents', { cache: 'no-store' });
        return asJson(res) as Promise<RegistryResponse>;
    },

    async projects(): Promise<ProjectMeta[]> {
        const res = await fetch('/api/projects', { cache: 'no-store' });
        const body = await asJson(res);
        return (body as { projects: ProjectMeta[] }).projects ?? [];
    },

    async createProject(input: { name: string; client?: string; description?: string }): Promise<ProjectMeta> {
        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        });
        const body = await asJson(res);
        return (body as { project: ProjectMeta }).project;
    },

    async overview(project: string): Promise<OverviewResponse> {
        const res = await fetch(`/api/projects/${encodeURIComponent(project)}/overview`, { cache: 'no-store' });
        return asJson(res) as Promise<OverviewResponse>;
    },

    async goals(project: string): Promise<Goal[]> {
        const res = await fetch(`/api/projects/${encodeURIComponent(project)}/goals`, { cache: 'no-store' });
        const body = await asJson(res);
        return (body as { goals: Goal[] }).goals ?? [];
    },

    async submitGoal(project: string, text: string): Promise<Goal> {
        const res = await fetch(`/api/projects/${encodeURIComponent(project)}/goals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        const body = await asJson(res);
        return (body as { goal: Goal }).goal;
    },

    async tasks(project: string, filters: { department?: string; status?: string } = {}): Promise<Task[]> {
        const qs = new URLSearchParams();
        if (filters.department) qs.set('department', filters.department);
        if (filters.status) qs.set('status', filters.status);
        const res = await fetch(
            `/api/projects/${encodeURIComponent(project)}/tasks${qs.toString() ? `?${qs}` : ''}`,
            { cache: 'no-store' }
        );
        const body = await asJson(res);
        return (body as { tasks: Task[] }).tasks ?? [];
    },

    async director(project: string, director: string): Promise<DirectorDrilldown> {
        const res = await fetch(
            `/api/projects/${encodeURIComponent(project)}/directors/${encodeURIComponent(director)}`,
            { cache: 'no-store' }
        );
        return asJson(res) as Promise<DirectorDrilldown>;
    },

    async file(project: string, path: string): Promise<FileContent> {
        const qs = new URLSearchParams({ path });
        const res = await fetch(
            `/api/projects/${encodeURIComponent(project)}/files?${qs}`,
            { cache: 'no-store' }
        );
        return asJson(res) as Promise<FileContent>;
    },

    async logs(
        project: string,
        opts: { type?: 'events' | 'mcp' | 'lifecycle'; agent?: string; limit?: number } = {}
    ): Promise<LogsResponse> {
        const qs = new URLSearchParams();
        if (opts.type) qs.set('type', opts.type);
        if (opts.agent) qs.set('agent', opts.agent);
        if (opts.limit) qs.set('limit', String(opts.limit));
        const res = await fetch(
            `/api/projects/${encodeURIComponent(project)}/logs${qs.toString() ? `?${qs}` : ''}`,
            { cache: 'no-store' }
        );
        return asJson(res) as Promise<LogsResponse>;
    },

    // --- Project Manager (Fase 2) ---------------------------------------------

    async pmOverview(project: string): Promise<PMOverview> {
        const res = await fetch(`/api/pm?project=${encodeURIComponent(project)}`, { cache: 'no-store' });
        const body = await asJson(res);
        return (body as { overview: PMOverview }).overview;
    },

    async pmSuggestions(project: string): Promise<PMSuggestion[]> {
        const res = await fetch(`/api/pm/suggestions?project=${encodeURIComponent(project)}`, {
            cache: 'no-store',
        });
        const body = await asJson(res);
        return (body as { suggestions: PMSuggestion[] }).suggestions ?? [];
    },

    async pmChat(project: string, message: string): Promise<PMChatResponse> {
        const res = await fetch('/api/pm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project, action: 'chat', message }),
        });
        return asJson(res) as Promise<PMChatResponse>;
    },

    async pmNotify(
        project: string,
        input: { to: string; subject: string; body: string; level?: string }
    ): Promise<unknown> {
        const res = await fetch('/api/pm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project, action: 'notify', ...input }),
        });
        return asJson(res);
    },

    async pmToggleChecklist(project: string, itemId: string, checked: boolean): Promise<PMChecklistToggle> {
        const res = await fetch('/api/pm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project, action: 'checklist', itemId, checked }),
        });
        return asJson(res) as Promise<PMChecklistToggle>;
    },
};

/**
 * SSE subscription to the event bus for one tenant. Reconnects on error and
 * surfaces both events and connection status. The dashboard uses a single
 * stream for badges, live logs, notifications and refresh triggers.
 */
export function useEventStream(project: string | null): {
    events: BusEvent[];
    connected: boolean;
} {
    const [events, setEvents] = useState<BusEvent[]>([]);
    const [connected, setConnected] = useState(false);
    const bufferRef = useRef<BusEvent[]>([]);

    useEffect(() => {
        if (!project) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setConnected(false);
            return;
        }
        let es: EventSource | null = null;
        let closed = false;
        const flush = () => {
            if (closed) return;
            const buf = bufferRef.current;
            if (buf.length === 0) return;
            bufferRef.current = [];
            setEvents((prev) => {
                const next = [...prev, ...buf];
                return next.length > 200 ? next.slice(next.length - 200) : next;
            });
        };
        const open = () => {
            es = new EventSource(`/api/events?project=${encodeURIComponent(project!)}`);
            es.onopen = () => setConnected(true);
            es.onerror = () => {
                setConnected(false);
                es?.close();
                if (!closed) setTimeout(open, 1500);
            };
            es.onmessage = (e) => {
                try {
                    const evt = JSON.parse(e.data) as BusEvent;
                    bufferRef.current.push(evt);
                    flush();
                } catch {
                    /* ignore malformed line */
                }
            };
        };
        open();
        const t = setInterval(flush, 600);
        return () => {
            closed = true;
            clearInterval(t);
            es?.close();
            setConnected(false);
        };
    }, [project]);

    return { events, connected };
}