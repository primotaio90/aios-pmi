'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { AgentUsage, BusEvent, DirectorDrilldown, LogEntry, ModelInfo, Subagent } from '../lib/types';
import { FileViewer } from './FileViewer';
import { initials } from '../lib/text';

/** Compact token string, e.g. "1M" / "200K" / "3.4K". */
function fmtTokens(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 && n < 10_000 ? 1 : 0)}K`;
    return String(n);
}

/** Model badge: label + context window, with a warning if the model is unknown. */
function ModelBadge({ model, info }: { model: string; info?: ModelInfo }) {
    if (!info || !info.known) {
        return (
            <span className="model-badge model-badge-unknown" title="Modello non presente nel catalogo: finestra di contesto sconosciuta">
                {model} · contesto ignoto
            </span>
        );
    }
    return (
        <span className="model-badge" title={`Finestra di contesto ${fmtTokens(info.context_window)} · output max ${fmtTokens(info.max_output)}`}>
            {model} · contesto {fmtTokens(info.context_window)}
        </span>
    );
}

/** Two meters: cumulative output vs token_budget, and peak input context vs the model window. */
function UsageMeters({ usage, budget, info }: { usage: AgentUsage | null; budget: number; info?: ModelInfo }) {
    if (!usage) {
        return <div className="usage-empty">Nessun consumo registrato (agente non ancora eseguito).</div>;
    }
    const last = usage.last as { output_tokens?: number; input_tokens?: number; simulated?: boolean };
    const output = usage.total_output || 0;
    const input = usage.max_input || 0;
    const ctx = info?.context_window ?? null;
    const budgetPct = budget ? Math.min(100, Math.round((output / budget) * 100)) : null;
    const ctxPct = ctx ? Math.min(100, Math.round((input / ctx) * 100)) : null;
    const level = (pct: number | null) => (pct === null ? '' : pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok');
    return (
        <div className="usage-meters">
            <div className="usage-row">
                <span className="usage-label">output / budget</span>
                <span className={`usage-track meter-${level(budgetPct)}`}>
                    <span className="usage-fill" style={{ width: `${budgetPct ?? 0}%` }} />
                </span>
                <span className="usage-val">{fmtTokens(output)} / {fmtTokens(budget)}{budgetPct !== null ? ` · ${budgetPct}%` : ''}</span>
            </div>
            <div className="usage-row">
                <span className="usage-label">contesto / finestra</span>
                <span className={`usage-track meter-${level(ctxPct)}`}>
                    <span className="usage-fill" style={{ width: `${ctxPct ?? 0}%` }} />
                </span>
                <span className="usage-val">{fmtTokens(input)} / {fmtTokens(ctx)}{ctxPct !== null ? ` · ${ctxPct}%` : ''}</span>
            </div>
            <div className="usage-foot">
                {usage.runs} esecuzioni · {usage.calls} chiamate LLM{last.simulated ? ' · valori simulati (runner mock)' : ''}
            </div>
        </div>
    );
}

const TASK_STATUS_CLASS: Record<string, string> = {
    pending: 'task-pending',
    assigned: 'task-assigned',
    in_progress: 'task-progress',
    blocked: 'task-blocked',
    review: 'task-review',
    done: 'task-done',
};

export function DirectorPanel({
    project,
    directorId,
    events,
    onBack,
}: {
    project: string;
    directorId: string;
    events: BusEvent[];
    onBack: () => void;
}) {
    const [data, setData] = useState<DirectorDrilldown | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [viewerPath, setViewerPath] = useState<string | null>(null);
    const [tab, setTab] = useState<'files' | 'subagents' | 'tasks' | 'logs'>('files');

    const reload = useCallback(() => {
        setLoading(true);
        api.director(project, directorId)
            .then((dd) => {
                setData(dd);
                setError(null);
            })
            .catch((err) => setError(err instanceof ApiError ? err.message : 'Caricamento fallito'))
            .finally(() => setLoading(false));
    }, [project, directorId]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        reload();
    }, [project, directorId, reload]);

    // Live refresh on relevant bus events for this department/director.
    useEffect(() => {
        const dept = data?.director.department;
        const dirId = data?.director.id;
        const relevant = events.find((e) =>
            ['task.status', 'task.created', 'agent.spawned', 'agent.teardown', 'mcp.call', 'file.updated', 'agent.report'].includes(
                e.type
            ) && (e.agent === dirId || (e.data && typeof e.data === 'object' && dept && (e.data as { department?: string }).department === dept))
        );
        if (relevant) {
            const t = setTimeout(reload, 150);
            return () => clearTimeout(t);
        }
    }, [events, reload, data?.director.department, data?.director.id]);

    const departmentAgents = useMemo(() => {
        const ids = new Set<string>([data?.director.id ?? directorId]);
        for (const s of data?.subagents ?? []) ids.add(s.id);
        return ids;
    }, [data?.director.id, data?.subagents, directorId]);
    const liveLogLines = useMemo(() => eventsToLines(events, departmentAgents), [events, departmentAgents]);

    const d = data?.director;
    if (loading && !data) return <div className="glass panel-state">Caricamento direttore…</div>;
    if (error) return <div className="glass panel-state login-error">{error}</div>;
    if (!data || !d) return null;

    return (
        <section className="director-panel">
            <div className="header-actions">
                <div>
                    <button className="btn btn-secondary panel-back" onClick={onBack}>
                        ← Home
                    </button>
                    <h1 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="panel-icon">{initials(d.name)}</span>
                        {d.name}
                        <span className="badge">{d.department}</span>
                    </h1>
                    <div className="title-desc" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <ModelBadge model={d.model} info={d.model_info} />
                        <span>budget {d.token_budget.toLocaleString()} token · file di competenza: {d.owns_files.length}</span>
                    </div>
                </div>
            </div>

            <nav className="panel-tabs">
                {(['files', 'subagents', 'tasks', 'logs'] as const).map((t) => (
                    <button key={t} className={`view-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                        {t === 'files' && 'File'}
                        {t === 'subagents' && 'Sub-agenti'}
                        {t === 'tasks' && 'Task'}
                        {t === 'logs' && 'Log live'}
                    </button>
                ))}
            </nav>

            {tab === 'files' && (
                <div className="panel-grid">
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">File del dipartimento</h3>
                        </div>
                        <div className="card-body">
                            {data.files.length === 0 ? (
                                <div className="home-empty">Nessun file.</div>
                            ) : (
                                <ul className="file-list">
                                    {data.files.map((f) => (
                                        <li key={f.path}>
                                            <button className="file-row" onClick={() => setViewerPath(f.path)}>
                                                <span className="file-name">{f.name}</span>
                                                <span className="file-path">{f.path}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">Output generati</h3>
                        </div>
                        <div className="card-body">
                            {data.output_files.length === 0 ? (
                                <div className="home-empty">Nessun output ancora.</div>
                            ) : (
                                <ul className="file-list">
                                    {data.output_files.map((f) => (
                                        <li key={f.path}>
                                            <button className="file-row" onClick={() => setViewerPath(f.path)}>
                                                <span className="file-name">{f.name}</span>
                                                <span className="file-path">{f.path}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'subagents' && (
                <div className="panel-grid panel-grid-1">
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">Sub-agenti esperti (on-demand)</h3>
                        </div>
                        <div className="card-body">
                            {data.subagents.length === 0 ? (
                                <div className="home-empty">Nessun sub-agente definito per questo direttore.</div>
                            ) : (
                                <div className="subagent-grid">
                                    {data.subagents.map((s: Subagent) => (
                                        <div key={s.id} className={`subagent-card ${s.active ? 'active' : ''}`}>
                                            <div className="subagent-head">
                                                <span className="subagent-icon">{initials(s.name)}</span>
                                                <div>
                                                    <div className="subagent-name">{s.name}</div>
                                                    <div className="subagent-model">{s.id}</div>
                                                </div>
                                                <span className={`badge ${s.active ? 'badge-live' : ''}`}>
                                                    {s.active ? '● attivo' : 'disponibile'}
                                                </span>
                                            </div>
                                            <div className="subagent-modelrow">
                                                <ModelBadge model={s.model} info={s.model_info} />
                                            </div>
                                            <UsageMeters usage={s.usage} budget={s.token_budget} info={s.model_info} />
                                            <div className="subagent-wl">
                                                {s.mcp_whitelist.map((w) => (
                                                    <span key={w} className="wl-tool">{w}</span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'tasks' && (
                <div className="panel-grid panel-grid-1">
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">Task del dipartimento</h3>
                        </div>
                        <div className="card-body">
                            {data.tasks.length === 0 ? (
                                <div className="home-empty">Nessun task.</div>
                            ) : (
                                <ul className="task-list">
                                    {data.tasks.map((t) => (
                                        <li key={t.id} className={`task-row ${TASK_STATUS_CLASS[t.status] ?? ''}`}>
                                            <div className="task-row-head">
                                                <span className="task-id">{t.id}</span>
                                                <span className="task-status-pill">{t.status}</span>
                                            </div>
                                            <div className="task-row-title">{t.title}</div>
                                            <div className="task-row-meta">
                                                assegnatario: <code>{t.assignee}</code>
                                                {t.outputs && t.outputs.length > 0 && (
                                                    <> · output: {t.outputs.map((o) => (
                                                        <button key={o} className="task-output-link" onClick={() => setViewerPath(o)}>{o}</button>
                                                    ))}</>
                                                )}
                                            </div>
                                            {t.report && <div className="task-report">{t.report}</div>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'logs' && (
                <div className="panel-grid panel-grid-2">
                    <LogBlock title="Chiamate MCP" entries={data.logs.mcp} live={liveLogLines.mcp} />
                    <LogBlock title="Ciclo di vita sub-agenti" entries={data.logs.lifecycle} live={liveLogLines.lifecycle} />
                </div>
            )}

            {viewerPath && (
                <FileViewer project={project} path={viewerPath} onClose={() => setViewerPath(null)} />
            )}
        </section>
    );
}

function LogBlock({
    title,
    entries,
    live,
}: {
    title: string;
    entries: LogEntry[];
    live: LogEntry[];
}) {
    const merged = [...live, ...entries].slice(0, 120);
    return (
        <div className="glass panel-block">
            <div className="card-header">
                <h3 className="card-title">{title}</h3>
                <span className="badge">{merged.length}</span>
            </div>
            <div className="card-body log-body">
                {merged.length === 0 ? (
                    <div className="home-empty">Nessun evento.</div>
                ) : (
                    <ul className="log-list">
                        {merged.map((l, i) => (
                            <li key={i} className={`log-line log-${String(l.outcome || l.event || 'info')}`}>
                                <span className="log-ts">{fmtTs(l.ts)}</span>
                                <span className="log-agent">{String(l.agent ?? '—')}</span>
                                <span className="log-tool">{String(l.tool ?? l.event ?? '')}</span>
                                <span className="log-outcome">{l.outcome ? `[${l.outcome}]` : ''}</span>
                                <span className="log-preview">{preview(l)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function preview(l: LogEntry): string {
    const d = l as Record<string, unknown>;
    if (typeof d.result_preview === 'string') return d.result_preview;
    if (typeof d.reason === 'string') return d.reason;
    if (typeof d.message === 'string') return d.message;
    if (d.payload && typeof d.payload === 'object') return JSON.stringify(d.payload).slice(0, 80);
    return '';
}

function fmtTs(ts: unknown): string {
    if (typeof ts !== 'string') return '';
    return ts.slice(11, 19);
}

function eventsToLines(events: BusEvent[], departmentAgents: Set<string>): { mcp: LogEntry[]; lifecycle: LogEntry[] } {
    const mcp: LogEntry[] = [];
    const lifecycle: LogEntry[] = [];
    for (const e of events) {
        // Progressive disclosure: the live tail shows only this department's agents.
        if (!e.agent || !departmentAgents.has(e.agent)) continue;
        const line = { ts: e.ts, agent: e.agent, ...(e.data as object) } as LogEntry;
        if (e.type === 'mcp.call') mcp.push(line);
        if (e.type === 'agent.spawned' || e.type === 'agent.teardown') {
            (line as LogEntry & { event?: string }).event = e.type === 'agent.spawned' ? 'spawn' : 'teardown';
            lifecycle.push(line);
        }
    }
    return { mcp: mcp.slice(-60).reverse(), lifecycle: lifecycle.slice(-60).reverse() };
}