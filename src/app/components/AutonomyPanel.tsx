'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { AutonomyLists, AutonomyPolicy, AutonomyResponse, Capability, Toast } from '../lib/types';

/**
 * Editor dell'autonomia di un agente — il terzo asse di permessi (Fase A).
 * Riusa il markup della tab «Capacità» (`.pm-checklist`, `.pm-check-item`,
 * raggruppamento per server MCP) sostituendo la checkbox con un controllo
 * segmentato a 3 stati: auto (parte da solo) / ask (chiede conferma) / never
 * (vietato). In testata il riepilogo `N auto · M con conferma · K vietati` e tre
 * profili rapidi (Conservativo / Bilanciato / Autonomo).
 *
 * Il componente è guidato dai dati dell'API (`available` = catalogo tool,
 * `current` = liste dell'agente) e salva tramite `onSave`, così lo stesso
 * pannello serve sia la tab dell'agente sia la matrice d'insieme in
 * SettingsPanel. Senza configurazione ogni tool resta `auto` (retro-compatibile).
 */

const POLICY_LABEL: Record<AutonomyPolicy, string> = {
    auto: 'Auto',
    ask: 'Conferma',
    never: 'Vietato',
};

const PROFILES: { id: string; label: string; hint: string; apply: (tools: string[]) => AutonomyLists }[] = [
    {
        id: 'conservative',
        label: 'Conservativo',
        hint: 'Solo letture in auto; scritture e aggiornamenti chiedono conferma.',
        apply: (tools) => ({
            auto: tools.filter((t) => /fs_read|fs_list|web_search|read_spreadsheet|openapi_parse/.test(t)),
            ask: tools.filter((t) => !/fs_read|fs_list|web_search|read_spreadsheet|openapi_parse/.test(t)),
            never: [],
        }),
    },
    {
        id: 'balanced',
        label: 'Bilanciato',
        hint: 'Letture e scritture su outputs/ in auto; tutto il resto chiede.',
        apply: (tools) => ({
            auto: tools.filter((t) => /fs_read|fs_list|web_search|read_spreadsheet|openapi_parse|mermaid_generate/.test(t)),
            ask: tools.filter((t) => !/fs_read|fs_list|web_search|read_spreadsheet|openapi_parse|mermaid_generate/.test(t)),
            never: [],
        }),
    },
    {
        id: 'autonomous',
        label: 'Autonomo',
        hint: 'Tutto in auto: l\'agente agisce senza chiedere (comportamento base).',
        apply: (tools) => ({ auto: [...tools], ask: [], never: [] }),
    },
];

/** Policy effettiva di un tool date le tre liste (path-glob ignorato a questo livello). */
function policyOf(tool: string, lists: AutonomyLists): AutonomyPolicy {
    const base = (e: string) => e.split(':')[0];
    if (lists.never.some((e) => base(e) === tool)) return 'never';
    if (lists.ask.some((e) => base(e) === tool)) return 'ask';
    return 'auto';
}

export function AutonomyPanel({
    agentId,
    project,
    onSaved,
    pushToast,
}: {
    agentId: string;
    project?: string;
    onSaved?: (lists: AutonomyLists) => void;
    pushToast: (t: Omit<Toast, 'id'>) => void;
}) {
    const [available, setAvailable] = useState<Capability[]>([]);
    const [lists, setLists] = useState<AutonomyLists>({ auto: [], ask: [], never: [] });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        api.agentAutonomy(agentId, project)
            .then((res: AutonomyResponse) => {
                if (!alive) return;
                setAvailable(res.available);
                // L'override tenant (se presente) ha precedenza sulla vista di default.
                setLists(res.project ?? res.current);
            })
            .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Caricamento autonomia fallito'))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, [agentId, project]);

    const tools = useMemo(() => available.map((c) => c.qualified), [available]);

    const counts = useMemo(() => {
        let auto = 0;
        let ask = 0;
        let never = 0;
        for (const t of tools) {
            const p = policyOf(t, lists);
            if (p === 'never') never += 1;
            else if (p === 'ask') ask += 1;
            else auto += 1;
        }
        return { auto, ask, never };
    }, [tools, lists]);

    const byServer = useMemo(() => {
        const groups: Record<string, Capability[]> = {};
        for (const c of available) (groups[c.server] ??= []).push(c);
        return groups;
    }, [available]);

    /** Sposta un tool nella lista della policy scelta (rimuovendolo dalle altre). */
    const setPolicy = (tool: string, policy: AutonomyPolicy) => {
        setLists((prev) => {
            const strip = (arr: string[]) => arr.filter((e) => e.split(':')[0] !== tool);
            const next: AutonomyLists = { auto: strip(prev.auto), ask: strip(prev.ask), never: strip(prev.never) };
            next[policy] = [...next[policy], tool];
            return next;
        });
    };

    const applyProfile = (profileId: string) => {
        const profile = PROFILES.find((p) => p.id === profileId);
        if (profile) setLists(profile.apply(tools));
    };

    const save = async () => {
        setSaving(true);
        try {
            const res = await api.setAgentAutonomy(agentId, lists, project ? { project } : {});
            setLists(res.project ?? res.current);
            onSaved?.(res.project ?? res.current);
            pushToast({ level: 'success', message: project ? 'Autonomia del progetto aggiornata' : 'Autonomia aggiornata' });
        } catch (err) {
            pushToast({ level: 'error', message: err instanceof ApiError ? err.message : 'Salvataggio autonomia fallito' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="home-empty">Caricamento autonomia…</div>;
    if (error) return <div className="login-error">{error}</div>;

    return (
        <div className="glass panel-block">
            <div className="card-header">
                <h3 className="card-title">Autonomia dell’agente</h3>
                <span className="autonomy-summary">
                    {counts.auto} auto · {counts.ask} con conferma · {counts.never} vietat{counts.never === 1 ? 'o' : 'i'}
                </span>
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                    {saving ? 'Salvataggio…' : 'Salva autonomia'}
                </button>
            </div>
            <div className="card-body">
                <p className="settings-help" style={{ marginTop: 0 }}>
                    Fra i tool concessi, quali l’agente avvia da solo (<strong>Auto</strong>), quali chiedono prima
                    conferma (<strong>Conferma</strong>) e quali sono vietati (<strong>Vietato</strong>). Vince sempre la
                    regola più restrittiva. Senza configurazione tutto resta Auto.
                    {project ? ' Questa scelta vale solo per il progetto corrente.' : ''}
                </p>

                <div className="autonomy-profiles">
                    {PROFILES.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            className="autonomy-profile"
                            title={p.hint}
                            onClick={() => applyProfile(p.id)}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {Object.entries(byServer).map(([server, serverTools]) => (
                    <div key={server} className="agent-tool-group">
                        <div className="agent-tool-server">{server}</div>
                        <ul className="pm-checklist">
                            {serverTools.map((t) => {
                                const policy = policyOf(t.qualified, lists);
                                return (
                                    <li key={t.qualified} className="pm-check-item autonomy-item">
                                        <span className="pm-check-label autonomy-label">
                                            <span className="pm-check-kind">{t.tool}</span>
                                            {t.description}
                                        </span>
                                        <span className="autonomy-seg" role="group" aria-label={`Autonomia ${t.qualified}`}>
                                            {(['auto', 'ask', 'never'] as AutonomyPolicy[]).map((p) => (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    className={`autonomy-seg-btn seg-${p}${policy === p ? ' on' : ''}`}
                                                    onClick={() => setPolicy(t.qualified, p)}
                                                >
                                                    {POLICY_LABEL[p]}
                                                </button>
                                            ))}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
}
