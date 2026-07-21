'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { AgentChatMessage, AgentMeta, AgentNote, Capability, Toast } from '../lib/types';
import { initials } from '../lib/text';

type Tab = 'chat' | 'notes' | 'tools';

/**
 * Direct chat with a single agent + two durable editors:
 *  - Chat: multi-turn conversation (real LLM when a provider is set; the agent
 *    can use its own whitelisted tools). "📌" turns a message into a permanent note.
 *  - Istruzioni: durable operative notes appended to the agent's system prompt.
 *  - Capacità: grant/revoke the agent's MCP tools (mcp_whitelist).
 */
export function AgentChat({
    project,
    agentId,
    onBack,
    pushToast,
}: {
    project: string;
    agentId: string;
    onBack: () => void;
    pushToast: (t: Omit<Toast, 'id'>) => void;
}) {
    const [tab, setTab] = useState<Tab>('chat');
    const [agent, setAgent] = useState<AgentMeta | null>(null);
    const [error, setError] = useState<string | null>(null);

    // chat
    const [chat, setChat] = useState<AgentChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);

    // notes
    const [notes, setNotes] = useState<AgentNote[]>([]);
    const [noteDraft, setNoteDraft] = useState('');

    // capabilities
    const [available, setAvailable] = useState<Capability[]>([]);
    const [current, setCurrent] = useState<string[]>([]);
    const [toolsBusy, setToolsBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        Promise.all([
            api.agents(),
            api.agentChatHistory(project, agentId),
            api.agentNotes(agentId),
            api.agentCapabilities(agentId),
        ])
            .then(([reg, history, ns, caps]) => {
                if (!alive) return;
                setAgent(reg.agents.find((a) => a.id === agentId) ?? null);
                setChat(history);
                setNotes(ns);
                setAvailable(caps.available);
                setCurrent(caps.current);
            })
            .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Caricamento agente fallito'));
        return () => {
            alive = false;
        };
    }, [project, agentId]);

    const send = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = input.trim();
        if (!text || busy) return;
        setBusy(true);
        setInput('');
        // optimistic user bubble
        setChat((prev) => [...prev, { ts: new Date().toISOString(), by: 'you', role: 'user', text }]);
        try {
            const { history } = await api.agentChat(project, agentId, text);
            setChat(history);
        } catch (err) {
            setChat((prev) => [
                ...prev,
                { ts: new Date().toISOString(), by: agentId, role: 'agent', text: `⚠️ ${err instanceof ApiError ? err.message : 'chat fallita'}` },
            ]);
        } finally {
            setBusy(false);
        }
    };

    const persistNote = async (text: string) => {
        const clean = text.trim();
        if (!clean) return;
        try {
            const ns = await api.saveAgentInstruction(agentId, clean, project);
            setNotes(ns);
            setNoteDraft('');
            pushToast({ level: 'success', message: 'Istruzione resa permanente' });
        } catch (err) {
            pushToast({ level: 'error', message: err instanceof ApiError ? err.message : 'Salvataggio istruzione fallito' });
        }
    };

    const toggleTool = (qualified: string) => {
        setCurrent((prev) => (prev.includes(qualified) ? prev.filter((t) => t !== qualified) : [...prev, qualified]));
    };

    const saveTools = async () => {
        setToolsBusy(true);
        try {
            const caps = await api.setAgentCapabilities(agentId, current, project);
            setAvailable(caps.available);
            setCurrent(caps.current);
            pushToast({ level: 'success', message: 'Capacità aggiornate' });
        } catch (err) {
            pushToast({ level: 'error', message: err instanceof ApiError ? err.message : 'Aggiornamento capacità fallito' });
        } finally {
            setToolsBusy(false);
        }
    };

    const byServer = useMemo(() => {
        const groups: Record<string, Capability[]> = {};
        for (const c of available) (groups[c.server] ??= []).push(c);
        return groups;
    }, [available]);

    if (error) {
        return (
            <section className="director-panel">
                <div className="header-actions">
                    <button className="btn btn-secondary panel-back" onClick={onBack}>
                        ← Home
                    </button>
                </div>
                <div className="glass panel-state login-error">{error}</div>
            </section>
        );
    }

    const name = agent?.name ?? agentId;

    return (
        <section className="director-panel pm-console">
            <div className="header-actions">
                <div>
                    <button className="btn btn-secondary panel-back" onClick={onBack}>
                        ← Home
                    </button>
                    <h1 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="panel-icon">{agent?.icon || initials(name)}</span>
                        {name}
                        {agent && <span className="badge">{agent.level}{agent.department ? ` · ${agent.department}` : ''}</span>}
                    </h1>
                    <div className="title-desc">Chat diretta · correzioni permanenti · gestione tool</div>
                </div>
            </div>

            <nav className="panel-tabs">
                <button className={`view-tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
                    Chat
                </button>
                <button className={`view-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
                    Istruzioni ({notes.length})
                </button>
                <button className={`view-tab ${tab === 'tools' ? 'active' : ''}`} onClick={() => setTab('tools')}>
                    Capacità ({current.length})
                </button>
            </nav>

            {tab === 'chat' && (
                <div className="glass panel-block pm-chat-block">
                    <div className="card-header">
                        <h3 className="card-title">Conversazione</h3>
                    </div>
                    <div className="card-body pm-chat-body">
                        <div className="pm-chat-history">
                            {chat.length === 0 ? (
                                <div className="home-empty">
                                    Scrivi all&apos;agente per chiedere, correggere o farti spiegare cosa sta facendo. Con il
                                    provider mock la risposta è simulata: imposta un provider reale dal pannello ⚙️.
                                </div>
                            ) : (
                                chat.map((m, i) => (
                                    <div key={i} className={`pm-chat-msg pm-chat-${m.role === 'agent' ? 'pm' : 'user'}`}>
                                        <span className="pm-chat-author">{m.role === 'agent' ? name : 'Tu'}</span>
                                        <span className="pm-chat-text">{m.text}</span>
                                        {m.role === 'user' && (
                                            <button
                                                type="button"
                                                className="agent-chat-pin"
                                                title="Rendi questa correzione permanente (istruzione durevole)"
                                                onClick={() => persistNote(m.text)}
                                            >
                                                📌
                                            </button>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                        <form className="pm-chat-form" onSubmit={send}>
                            <input
                                className="pm-chat-input"
                                placeholder={`Scrivi a ${name}…`}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                disabled={busy}
                            />
                            <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
                                {busy ? '…' : 'Invia'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {tab === 'notes' && (
                <div className="panel-grid panel-grid-1">
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">Istruzioni permanenti</h3>
                            <span className="badge">scritte in agents/{agentId}.md</span>
                        </div>
                        <div className="card-body">
                            <p className="settings-help" style={{ marginTop: 0 }}>
                                Queste note entrano nel system prompt dell&apos;agente e restano valide anche nelle future
                                esecuzioni dei goal (hot-reload immediato).
                            </p>
                            <form
                                className="pm-notif-form"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    persistNote(noteDraft);
                                }}
                            >
                                <textarea
                                    className="pm-notif-textarea"
                                    rows={3}
                                    placeholder="Es. Usa sempre un tono formale e cita le fonti normative quando pertinente."
                                    value={noteDraft}
                                    onChange={(e) => setNoteDraft(e.target.value)}
                                />
                                <button type="submit" className="btn btn-primary" disabled={!noteDraft.trim()}>
                                    Salva istruzione permanente
                                </button>
                            </form>
                            {notes.length === 0 ? (
                                <div className="home-empty">Nessuna istruzione permanente.</div>
                            ) : (
                                <ul className="agent-note-list">
                                    {notes.map((n, i) => (
                                        <li key={i} className="agent-note">
                                            <span className="agent-note-ts">{n.ts.slice(0, 16).replace('T', ' ')}</span>
                                            <span className="agent-note-text">{n.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'tools' && (
                <div className="panel-grid panel-grid-1">
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">Tool MCP dell&apos;agente</h3>
                            <button className="btn btn-primary" onClick={saveTools} disabled={toolsBusy}>
                                {toolsBusy ? 'Salvataggio…' : 'Salva capacità'}
                            </button>
                        </div>
                        <div className="card-body">
                            <p className="settings-help" style={{ marginTop: 0 }}>
                                Concedi o revoca i tool. La selezione scrive la <code>mcp_whitelist</code> in
                                agents/{agentId}.md; il gateway nega (loggando) ogni tool fuori lista.
                            </p>
                            {Object.entries(byServer).map(([server, tools]) => (
                                <div key={server} className="agent-tool-group">
                                    <div className="agent-tool-server">{server}</div>
                                    <ul className="pm-checklist">
                                        {tools.map((t) => (
                                            <li key={t.qualified} className="pm-check-item">
                                                <label>
                                                    <input
                                                        type="checkbox"
                                                        checked={current.includes(t.qualified)}
                                                        onChange={() => toggleTool(t.qualified)}
                                                    />
                                                    <span className="pm-check-kind">{t.tool}</span>
                                                    <span className="pm-check-label">{t.description}</span>
                                                </label>
                                                <span className="pm-check-source">{t.qualified}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
