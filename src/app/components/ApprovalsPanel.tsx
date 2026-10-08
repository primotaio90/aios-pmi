'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Approval, ModeId, OperatingMode, Toast } from '../lib/types';

/**
 * Coda delle approvazioni — la fonte di verità persistente (Fase A).
 *
 * A differenza del toast (effimero), questo pannello legge sempre
 * `GET /api/projects/:p/approvals`, quindi una richiesta `ask` resta
 * raggiungibile anche dopo un F5 o una raffica di toast. Per ogni richiesta
 * mostra agente, tool, modalità e payload leggibile — con il path in evidenza
 * per `filesystem.fs_write`, che è l'informazione su cui l'umano decide.
 *
 * Da qui Approva/Nega chiamano la stessa `api.resolveApproval` dei toast.
 * "Approva per questa sessione" (strada A) registra anche l'override di
 * sessione, così le prossime chiamate identiche partono da sole — sempre nel
 * rispetto del floor della modalità, che resta invalicabile.
 *
 * Disvelamento progressivo (§7): zero pendenti + zero storico = zero ingombro.
 */

const STATUS_LABEL: Record<Approval['status'], string> = {
    pending: 'In attesa',
    approved: 'Approvata',
    denied: 'Negata',
    timeout: 'Scaduta',
    stale: 'Interrotta (riavvio)',
};

/** Estrae il dato che conta dal payload: il path per i tool file, altrimenti un riassunto. */
function payloadSummary(tool: string, payload: Record<string, unknown>): { path: string | null; rest: string } {
    const path = typeof payload?.path === 'string' ? payload.path : null;
    const entries = Object.entries(payload || {}).filter(([k]) => k !== 'path' && k !== 'content');
    const rest = entries
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' · ');
    return { path, rest: rest || (tool === 'filesystem.fs_write' ? '' : '—') };
}

export function ApprovalsPanel({
    project,
    onBack,
    pushToast,
    modes = [],
}: {
    project: string;
    onBack: () => void;
    pushToast: (t: Omit<Toast, 'id'>) => void;
    modes?: OperatingMode[];
}) {
    const [pending, setPending] = useState<Approval[]>([]);
    const [history, setHistory] = useState<Approval[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const modeLabel = useCallback(
        (id: string | null) => {
            if (!id) return null;
            const m = modes.find((x) => String(x.id) === id);
            return m ? `${m.icon} ${m.label}` : id;
        },
        [modes]
    );

    const reload = useCallback(async () => {
        try {
            const [p, all] = await Promise.all([api.approvals(project), api.approvalsAll(project)]);
            setPending(p);
            // Storico = tutto tranne i live pending (già mostrati sopra).
            const liveIds = new Set(p.map((x) => x.id));
            setHistory(all.filter((x) => !liveIds.has(x.id)).slice(0, 12));
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Caricamento approvazioni fallito');
        } finally {
            setLoading(false);
        }
    }, [project]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        reload();
    }, [reload]);

    const decide = async (approval: Approval, approved: boolean, forSession = false) => {
        if (busyId) return;
        setBusyId(approval.id);
        try {
            // Session override (strada A): la prossima identica chiamata parte da sola.
            // Mai oltre il floor della modalità: lo impone il motore, qui è solo UI.
            if (approved && forSession) {
                await api.setAgentAutonomy(
                    approval.agent,
                    { auto: [approval.tool], ask: [], never: [] },
                    { project, session: true }
                );
            }
            await api.resolveApproval(project, approval.id, approved);
            pushToast({
                level: approved ? 'success' : 'warn',
                message: approved
                    ? forSession
                        ? `Approvato ${approval.tool} per questa sessione`
                        : 'Azione approvata'
                    : 'Azione negata',
            });
            await reload();
        } catch (err) {
            pushToast({ level: 'error', message: err instanceof ApiError ? err.message : 'Risoluzione fallita' });
        } finally {
            setBusyId(null);
        }
    };

    if (loading) {
        return (
            <section className="director-panel">
                <div className="header-actions">
                    <button className="btn btn-secondary panel-back" onClick={onBack}>
                        ← Indietro
                    </button>
                </div>
                <div className="glass panel-state">Caricamento approvazioni…</div>
            </section>
        );
    }
    if (error) {
        return (
            <section className="director-panel">
                <div className="header-actions">
                    <button className="btn btn-secondary panel-back" onClick={onBack}>
                        ← Indietro
                    </button>
                </div>
                <div className="glass panel-state login-error">{error}</div>
            </section>
        );
    }

    return (
        <section className="director-panel pm-console">
            <div className="header-actions">
                <div>
                    <button className="btn btn-secondary panel-back" onClick={onBack}>
                        ← Indietro
                    </button>
                    <h1 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="panel-icon">🔔</span>
                        Approvazioni
                        {pending.length > 0 && <span className="badge">{pending.length} in attesa</span>}
                    </h1>
                    <div className="title-desc">
                        Un agente in policy «con conferma» attende il tuo via prima di agire. Approva una volta, nega,
                        oppure approva per l’intera sessione.
                    </div>
                </div>
            </div>

            <div className="panel-grid panel-grid-1">
                <div className="glass panel-block">
                    <div className="card-header">
                        <h3 className="card-title">In attesa di decisione</h3>
                        <span className="badge">{pending.length}</span>
                    </div>
                    <div className="card-body">
                        {pending.length === 0 ? (
                            <div className="home-empty">Nessuna richiesta in attesa. Quando un agente chiederà conferma, comparirà qui — anche se ricarichi la pagina.</div>
                        ) : (
                            <ul className="pm-checklist">
                                {pending.map((a) => {
                                    const { path, rest } = payloadSummary(a.tool, a.payload);
                                    return (
                                        <li key={a.id} className="pm-check-item approval-item">
                                            <div className="approval-main">
                                                <div className="approval-head">
                                                    <span className="pm-check-kind">{a.agent}</span>
                                                    <span className="approval-tool">{a.tool}</span>
                                                    {a.mode && <span className="mode-badge">{modeLabel(a.mode)}</span>}
                                                    <span className="approval-ts">{a.ts.slice(11, 19)}</span>
                                                </div>
                                                {path && <div className="approval-path">{path}</div>}
                                                {rest && rest !== '—' && <div className="approval-rest">{rest}</div>}
                                            </div>
                                            <div className="approval-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-primary approval-approve"
                                                    disabled={busyId === a.id}
                                                    onClick={() => decide(a, true)}
                                                >
                                                    Approva
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary approval-session"
                                                    title="Approva e lascia che questo tool parta da solo per il resto della sessione (mai oltre il floor della modalità)"
                                                    disabled={busyId === a.id}
                                                    onClick={() => decide(a, true, true)}
                                                >
                                                    Approva per sessione
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary approval-deny"
                                                    disabled={busyId === a.id}
                                                    onClick={() => decide(a, false)}
                                                >
                                                    Nega
                                                </button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>

                {history.length > 0 && (
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">Recenti</h3>
                            <span className="badge">{history.length}</span>
                        </div>
                        <div className="card-body">
                            <ul className="pm-checklist">
                                {history.map((a) => {
                                    const { path } = payloadSummary(a.tool, a.payload);
                                    return (
                                        <li key={a.id} className={`pm-check-item approval-item approval-${a.status}`}>
                                            <div className="approval-main">
                                                <div className="approval-head">
                                                    <span className="pm-check-kind">{a.agent}</span>
                                                    <span className="approval-tool">{a.tool}</span>
                                                    {path && <span className="approval-path-inline">{path}</span>}
                                                </div>
                                            </div>
                                            <span className={`approval-status status-${a.status}`}>{STATUS_LABEL[a.status]}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
