'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type {
    BusEvent,
    PMChatMessage,
    PMOverview,
    PMSuggestion,
} from '../lib/types';
import { initials } from '../lib/text';

/**
 * Project Manager console (Fase 2). The PM is a server-side agent above the
 * Orchestrator; the consultant drives it. Four zones:
 *  - KPIs + active goal + next-action suggestions
 *  - Interactive checklist (files produced / to-produce / tasks / deliveries)
 *  - Live chat with the PM (rule-based in mock, LLM in AIOS_RUNNER=claude)
 *  - Notification-email log + composer (audit trail; SMTP is an extension point)
 *
 * Auto-refreshes on pm.* / task.* / goal.* events from the shared SSE stream.
 */
export function PMConsole({
    project,
    events,
    onBack,
}: {
    project: string;
    events: BusEvent[];
    onBack: () => void;
}) {
    const [overview, setOverview] = useState<PMOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<PMSuggestion[]>([]);
    const [chat, setChat] = useState<PMChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [chatBusy, setChatBusy] = useState(false);
    const [tab, setTab] = useState<'checklist' | 'chat' | 'notifications'>('checklist');
    const [notif, setNotif] = useState({ to: 'consultants', subject: '', body: '' });
    const seenEventRef = useRef<Set<string>>(new Set());

    const reload = useCallback(async () => {
        try {
            const [ov, sug] = await Promise.all([api.pmOverview(project), api.pmSuggestions(project)]);
            setOverview(ov);
            setSuggestions(sug);
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Caricamento PM fallito');
        }
    }, [project]);

    useEffect(() => {
        reload();
    }, [reload]);

    // Live refresh on pm.* / task.* / goal.* events.
    useEffect(() => {
        if (events.length === 0) return;
        const evt = events[events.length - 1];
        const key = `${evt.ts}-${evt.type}`;
        if (seenEventRef.current.has(key)) return;
        seenEventRef.current.add(key);
        if (seenEventRef.current.size > 300) seenEventRef.current = new Set([...seenEventRef.current].slice(-200));
        if (
            evt.type.startsWith('pm.') ||
            evt.type.startsWith('task.') ||
            evt.type.startsWith('goal.') ||
            evt.type === 'file.updated'
        ) {
            const t = setTimeout(reload, 200);
            return () => clearTimeout(t);
        }
    }, [events, reload]);

    const sendChat = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = chatInput.trim();
        if (!text || chatBusy) return;
        setChatBusy(true);
        setChatInput('');
        try {
            const { reply, history } = await api.pmChat(project, text);
            setChat(history);
            void reply;
        } catch (err) {
            setChat((prev) => [
                ...prev,
                { ts: new Date().toISOString(), by: 'pm', role: 'pm', text: `Errore: ${err instanceof ApiError ? err.message : 'chat fallita'}` },
            ]);
        } finally {
            setChatBusy(false);
        }
    };

    const toggle = async (itemId: string, checked: boolean) => {
        if (!overview) return;
        setOverview({ ...overview, checklist: overview.checklist.map((c) => (c.item_id === itemId ? { ...c, checked } : c)) });
        try {
            await api.pmToggleChecklist(project, itemId, checked);
        } catch {
            setOverview({ ...overview, checklist: overview.checklist.map((c) => (c.item_id === itemId ? { ...c, checked: !checked } : c)) });
        }
    };

    const sendNotif = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!notif.subject.trim() || !notif.body.trim()) return;
        try {
            await api.pmNotify(project, notif);
            setNotif({ to: 'consultants', subject: '', body: '' });
            await reload();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Notifica fallita');
        }
    };

    const pm = overview?.pm;
    const k = overview?.kpis;

    return (
        <section className="director-panel pm-console">
            <div className="header-actions">
                <div>
                    <button className="btn btn-secondary panel-back" onClick={onBack}>
                        ← Home
                    </button>
                    <h1 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="panel-icon">{initials(pm?.name || 'Project Manager')}</span>
                        {pm?.name || 'Project Manager'}
                        <span className="badge">Fase 2</span>
                    </h1>
                    <div className="title-desc">Coordinamento consulenti · checklist · notifiche · dialogo</div>
                </div>
            </div>

            {error && <div className="glass panel-state login-error">{error}</div>}

            {!overview && !error && <div className="glass panel-state">Caricamento console PM…</div>}

            {overview && (
                <>
                    {/* KPI strip */}
                    <div className="pm-kpi-strip">
                        <Kpi label="Goal" value={`${k?.goals_completed ?? 0}/${k?.goals_total ?? 0}`} tone="info" />
                        <Kpi label="Task completati" value={`${k?.tasks_done ?? 0}/${k?.tasks_total ?? 0}`} tone="success" />
                        <Kpi label="In revisione" value={String(k?.tasks_review ?? 0)} tone="warn" />
                        <Kpi label="Bloccati" value={String(k?.tasks_blocked ?? 0)} tone="error" />
                        <Kpi label="Avanzamento" value={k?.progress !== null && k?.progress !== undefined ? `${k.progress}%` : '—'} tone="info" />
                    </div>

                    {/* Active goal + suggestions */}
                    <div className="panel-grid panel-grid-2">
                        <div className="glass panel-block">
                            <div className="card-header">
                                <h3 className="card-title">Obiettivo attivo</h3>
                            </div>
                            <div className="card-body">
                                {overview.active_goal ? (
                                    <>
                                        <div className="home-goal-id">{overview.active_goal.id}</div>
                                        <div className="home-goal-text">{overview.active_goal.text}</div>
                                        <span className={`status-badge status-${overview.active_goal.status}`}>{overview.active_goal.status}</span>
                                    </>
                                ) : (
                                    <div className="home-empty">Nessun obiettivo attivo.</div>
                                )}
                            </div>
                        </div>

                        <div className="glass panel-block">
                            <div className="card-header">
                                <h3 className="card-title">Prossime azioni</h3>
                            </div>
                            <div className="card-body">
                                {suggestions.length === 0 ? (
                                    <div className="home-empty">Nessuna suggerimento.</div>
                                ) : (
                                    <ul className="pm-suggestions">
                                        {suggestions.map((s, i) => (
                                            <li key={i} className={`pm-suggestion pm-sugg-${s.kind}`}>
                                                {s.text}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Tabs */}
                    <nav className="pm-tabs">
                        <button className={`pm-tab ${tab === 'checklist' ? 'on' : ''}`} onClick={() => setTab('checklist')}>
                            Checklist ({overview.checklist.length})
                        </button>
                        <button className={`pm-tab ${tab === 'chat' ? 'on' : ''}`} onClick={() => setTab('chat')}>
                            Dialogo
                        </button>
                        <button className={`pm-tab ${tab === 'notifications' ? 'on' : ''}`} onClick={() => setTab('notifications')}>
                            Notifiche ({overview.notifications.length})
                        </button>
                    </nav>

                    {tab === 'checklist' && (
                        <div className="glass panel-block">
                            <div className="card-header">
                                <h3 className="card-title">Checklist interattiva</h3>
                            </div>
                            <div className="card-body">
                                {overview.checklist.length === 0 ? (
                                    <div className="home-empty">Nessuna voce da mostrare.</div>
                                ) : (
                                    <ul className="pm-checklist">
                                        {overview.checklist.map((c) => (
                                            <li key={c.item_id} className={`pm-check-item kind-${c.kind}`}>
                                                <label>
                                                    <input
                                                        type="checkbox"
                                                        checked={c.checked}
                                                        onChange={(e) => toggle(c.item_id, e.target.checked)}
                                                    />
                                                    <span className="pm-check-kind">{c.kind}</span>
                                                    <span className="pm-check-label">{c.label}</span>
                                                </label>
                                                <span className="pm-check-source">{c.source}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}

                    {tab === 'chat' && (
                        <div className="glass panel-block pm-chat-block">
                            <div className="card-header">
                                <h3 className="card-title">Dialogo con il Project Manager</h3>
                            </div>
                            <div className="card-body pm-chat-body">
                                <div className="pm-chat-history">
                                    {chat.length === 0 ? (
                                        <div className="home-empty">Inizia una conversazione. Prova: stato del progetto oppure prossime azioni.</div>
                                    ) : (
                                        chat.map((m, i) => (
                                            <div key={i} className={`pm-chat-msg pm-chat-${m.role}`}>
                                                <span className="pm-chat-author">{m.role === 'pm' ? 'PM' : 'Consulente'}</span>
                                                <span className="pm-chat-text">{m.text}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <form className="pm-chat-form" onSubmit={sendChat}>
                                    <input
                                        className="pm-chat-input"
                                        placeholder="Scrivi al Project Manager…"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        disabled={chatBusy}
                                    />
                                    <button type="submit" className="btn btn-primary" disabled={chatBusy || !chatInput.trim()}>
                                        {chatBusy ? '…' : 'Invia'}
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {tab === 'notifications' && (
                        <div className="panel-grid panel-grid-2">
                            <div className="glass panel-block">
                                <div className="card-header">
                                    <h3 className="card-title">Notifiche email (audit)</h3>
                                </div>
                                <div className="card-body">
                                    {overview.notifications.length === 0 ? (
                                        <div className="home-empty">Nessuna notifica. Le notifiche automatiche vengono generate quando un task passa in review/bloccato o un goal si completa.</div>
                                    ) : (
                                        <ul className="pm-notif-list">
                                            {overview.notifications.map((n) => (
                                                <li key={n.id} className={`pm-notif level-${n.level}`}>
                                                    <div className="pm-notif-head">
                                                        <span className="pm-notif-subject">{n.subject}</span>
                                                        <span className="pm-notif-ts">{n.ts.slice(11, 16)}</span>
                                                    </div>
                                                    <div className="pm-notif-body">{n.body}</div>
                                                    <div className="pm-notif-meta">a: {n.to} · {n.transport}</div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>

                            <div className="glass panel-block">
                                <div className="card-header">
                                    <h3 className="card-title">Nuova notifica</h3>
                                </div>
                                <div className="card-body">
                                    <form className="pm-notif-form" onSubmit={sendNotif}>
                                        <input
                                            className="topbar-input"
                                            placeholder="Destinatario (es. consultants)"
                                            value={notif.to}
                                            onChange={(e) => setNotif({ ...notif, to: e.target.value })}
                                        />
                                        <input
                                            className="topbar-input"
                                            placeholder="Oggetto"
                                            value={notif.subject}
                                            onChange={(e) => setNotif({ ...notif, subject: e.target.value })}
                                        />
                                        <textarea
                                            className="pm-notif-textarea"
                                            placeholder="Corpo del messaggio"
                                            rows={4}
                                            value={notif.body}
                                            onChange={(e) => setNotif({ ...notif, body: e.target.value })}
                                        />
                                        <button type="submit" className="btn btn-primary" disabled={!notif.subject.trim() || !notif.body.trim()}>
                                            Invia notifica
                                        </button>
                                    </form>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: 'info' | 'success' | 'warn' | 'error' }) {
    return (
        <div className={`pm-kpi kpi-${tone}`}>
            <div className="pm-kpi-value">{value}</div>
            <div className="pm-kpi-label">{label}</div>
        </div>
    );
}