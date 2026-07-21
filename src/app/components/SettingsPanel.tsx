'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { AgentMeta, ProviderId, SettingsPatch, SettingsResponse, Toast } from '../lib/types';
import { initials } from '../lib/text';

type Tab = 'provider' | 'params' | 'agents';

const PROVIDER_LABEL: Record<ProviderId, string> = {
    mock: 'Mock (simulato, senza rete)',
    anthropic: 'Anthropic-compatibile',
    openai: 'OpenAI-compatibile',
};

/**
 * Global LLM settings: provider + base URL + API key + model + generation params,
 * with per-agent model overrides. Mirrors the DirectorPanel shell. API keys are
 * write-only from here (shown masked); an empty key field leaves the stored one.
 */
export function SettingsPanel({
    onBack,
    pushToast,
}: {
    onBack: () => void;
    pushToast: (t: Omit<Toast, 'id'>) => void;
}) {
    const [tab, setTab] = useState<Tab>('provider');
    const [data, setData] = useState<SettingsResponse | null>(null);
    const [agents, setAgents] = useState<AgentMeta[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Editable form state.
    const [provider, setProvider] = useState<ProviderId>('mock');
    const [anthropicBaseURL, setAnthropicBaseURL] = useState('');
    const [anthropicModel, setAnthropicModel] = useState('');
    const [anthropicKey, setAnthropicKey] = useState('');
    const [openaiBaseURL, setOpenaiBaseURL] = useState('');
    const [openaiModel, setOpenaiModel] = useState('');
    const [openaiKey, setOpenaiKey] = useState('');
    const [temperature, setTemperature] = useState('');
    const [maxTokens, setMaxTokens] = useState('8192');
    const [thinking, setThinking] = useState(true);
    const [overrides, setOverrides] = useState<Record<string, string>>({});

    const hydrate = (d: SettingsResponse) => {
        setData(d);
        const s = d.settings;
        setProvider(s.provider);
        setAnthropicBaseURL(s.anthropic.baseURL);
        setAnthropicModel(s.anthropic.model);
        setOpenaiBaseURL(s.openai.baseURL);
        setOpenaiModel(s.openai.model);
        setTemperature(s.params.temperature == null ? '' : String(s.params.temperature));
        setMaxTokens(String(s.params.maxTokens));
        setThinking(s.params.thinking);
        setOverrides({ ...s.agentModelOverrides });
        setAnthropicKey('');
        setOpenaiKey('');
    };

    useEffect(() => {
        let alive = true;
        Promise.all([api.getSettings(), api.agents()])
            .then(([d, reg]) => {
                if (!alive) return;
                hydrate(d);
                setAgents(reg.agents);
            })
            .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Caricamento impostazioni fallito'));
        return () => {
            alive = false;
        };
    }, []);

    const catalogIds = useMemo(() => (data ? Object.keys(data.catalog) : []), [data]);

    const save = async () => {
        setBusy(true);
        try {
            const patch: SettingsPatch = {
                provider,
                anthropic: { baseURL: anthropicBaseURL, model: anthropicModel, ...(anthropicKey ? { apiKey: anthropicKey } : {}) },
                openai: { baseURL: openaiBaseURL, model: openaiModel, ...(openaiKey ? { apiKey: openaiKey } : {}) },
                params: {
                    temperature: temperature.trim() === '' ? null : Number(temperature),
                    maxTokens: Number(maxTokens) || 8192,
                    thinking,
                },
                agentModelOverrides: overrides,
            };
            await api.saveSettings(patch);
            const fresh = await api.getSettings();
            hydrate(fresh);
            pushToast({ level: 'success', message: 'Impostazioni salvate' });
        } catch (err) {
            pushToast({ level: 'error', message: err instanceof ApiError ? err.message : 'Salvataggio fallito' });
        } finally {
            setBusy(false);
        }
    };

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
    if (!data) {
        return (
            <section className="director-panel">
                <div className="glass panel-state">Caricamento impostazioni…</div>
            </section>
        );
    }

    const keyHint = (m: { set: boolean; hint: string; env: boolean }) =>
        m.set ? `chiave impostata (${m.hint})` : m.env ? 'presa da variabile d\'ambiente' : 'nessuna chiave';

    return (
        <section className="director-panel">
            <div className="header-actions">
                <div>
                    <button className="btn btn-secondary panel-back" onClick={onBack}>
                        ← Home
                    </button>
                    <h1 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="panel-icon">⚙️</span>
                        Impostazioni modello
                        <span className={`status-badge status-${provider === 'mock' ? 'idle' : 'working'}`}>
                            {provider}
                        </span>
                    </h1>
                    <div className="title-desc">Provider, endpoint, chiavi API, modello e parametri di generazione</div>
                </div>
                <button className="btn btn-primary" onClick={save} disabled={busy}>
                    {busy ? 'Salvataggio…' : 'Salva impostazioni'}
                </button>
            </div>

            <div className="panel-tabs">
                <button className={`view-tab ${tab === 'provider' ? 'active' : ''}`} onClick={() => setTab('provider')}>
                    Provider
                </button>
                <button className={`view-tab ${tab === 'params' ? 'active' : ''}`} onClick={() => setTab('params')}>
                    Parametri
                </button>
                <button className={`view-tab ${tab === 'agents' ? 'active' : ''}`} onClick={() => setTab('agents')}>
                    Modello per agente
                </button>
            </div>

            {/* Datalist shared by every model input: catalog ids as suggestions, free text allowed. */}
            <datalist id="aios-model-catalog">
                {catalogIds.map((id) => (
                    <option key={id} value={id}>
                        {data.catalog[id].label}
                    </option>
                ))}
            </datalist>

            {tab === 'provider' && (
                <div className="panel-grid panel-grid-1">
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">Modalità</h3>
                        </div>
                        <div className="card-body settings-form">
                            <label className="settings-field">
                                <span className="settings-label">Provider attivo</span>
                                <select
                                    className="topbar-input"
                                    value={provider}
                                    onChange={(e) => setProvider(e.target.value as ProviderId)}
                                >
                                    {data.providers.map((p) => (
                                        <option key={p} value={p}>
                                            {PROVIDER_LABEL[p]}
                                        </option>
                                    ))}
                                </select>
                                <span className="settings-help">
                                    {provider === 'mock'
                                        ? 'Agenti simulati, nessuna rete né chiave. Default sicuro.'
                                        : 'Le chiamate reali usano la configurazione qui sotto. Il cambio ha effetto subito, senza riavvio.'}
                                </span>
                            </label>
                        </div>
                    </div>

                    <div className={`glass panel-block ${provider === 'anthropic' ? '' : 'settings-dim'}`}>
                        <div className="card-header">
                            <h3 className="card-title">Anthropic-compatibile</h3>
                            <span className="badge">{keyHint(data.settings.anthropic.apiKey)}</span>
                        </div>
                        <div className="card-body settings-form">
                            <label className="settings-field">
                                <span className="settings-label">Base URL (opzionale)</span>
                                <input
                                    className="topbar-input"
                                    placeholder="https://api.anthropic.com (default)"
                                    value={anthropicBaseURL}
                                    onChange={(e) => setAnthropicBaseURL(e.target.value)}
                                />
                            </label>
                            <label className="settings-field">
                                <span className="settings-label">Chiave API</span>
                                <input
                                    className="topbar-input"
                                    type="password"
                                    autoComplete="off"
                                    placeholder={data.settings.anthropic.apiKey.set ? '•••• (lascia vuoto per non cambiare)' : 'sk-ant-…'}
                                    value={anthropicKey}
                                    onChange={(e) => setAnthropicKey(e.target.value)}
                                />
                            </label>
                            <label className="settings-field">
                                <span className="settings-label">Modello di default</span>
                                <input
                                    className="topbar-input"
                                    list="aios-model-catalog"
                                    placeholder="claude-opus-4-8"
                                    value={anthropicModel}
                                    onChange={(e) => setAnthropicModel(e.target.value)}
                                />
                            </label>
                        </div>
                    </div>

                    <div className={`glass panel-block ${provider === 'openai' ? '' : 'settings-dim'}`}>
                        <div className="card-header">
                            <h3 className="card-title">OpenAI-compatibile</h3>
                            <span className="badge">{keyHint(data.settings.openai.apiKey)}</span>
                        </div>
                        <div className="card-body settings-form">
                            <label className="settings-field">
                                <span className="settings-label">Base URL</span>
                                <input
                                    className="topbar-input"
                                    placeholder="http://localhost:11434/v1 · https://api.openai.com/v1 · …"
                                    value={openaiBaseURL}
                                    onChange={(e) => setOpenaiBaseURL(e.target.value)}
                                />
                            </label>
                            <label className="settings-field">
                                <span className="settings-label">Chiave API</span>
                                <input
                                    className="topbar-input"
                                    type="password"
                                    autoComplete="off"
                                    placeholder={data.settings.openai.apiKey.set ? '•••• (lascia vuoto per non cambiare)' : 'sk-… (vuota per server locali)'}
                                    value={openaiKey}
                                    onChange={(e) => setOpenaiKey(e.target.value)}
                                />
                            </label>
                            <label className="settings-field">
                                <span className="settings-label">Modello</span>
                                <input
                                    className="topbar-input"
                                    placeholder="gpt-4o-mini · llama3.1 · qwen2.5 · …"
                                    value={openaiModel}
                                    onChange={(e) => setOpenaiModel(e.target.value)}
                                />
                            </label>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'params' && (
                <div className="panel-grid panel-grid-1">
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">Parametri di generazione</h3>
                        </div>
                        <div className="card-body settings-form">
                            <label className="settings-field">
                                <span className="settings-label">Temperature (vuoto = default del modello)</span>
                                <input
                                    className="topbar-input"
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="2"
                                    placeholder="es. 0.7"
                                    value={temperature}
                                    onChange={(e) => setTemperature(e.target.value)}
                                />
                                <span className="settings-help">
                                    Su Anthropic con &quot;extended thinking&quot; attivo la temperature è ignorata (fissata dall&apos;API).
                                </span>
                            </label>
                            <label className="settings-field">
                                <span className="settings-label">Max token in output</span>
                                <input
                                    className="topbar-input"
                                    type="number"
                                    step="256"
                                    min="256"
                                    value={maxTokens}
                                    onChange={(e) => setMaxTokens(e.target.value)}
                                />
                            </label>
                            <label className="settings-field settings-check">
                                <input type="checkbox" checked={thinking} onChange={(e) => setThinking(e.target.checked)} />
                                <span className="settings-label">Extended thinking (Anthropic — ragionamento adattivo)</span>
                            </label>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'agents' && (
                <div className="panel-grid panel-grid-1">
                    <div className="glass panel-block">
                        <div className="card-header">
                            <h3 className="card-title">Override del modello per agente</h3>
                            <span className="badge">{Object.keys(overrides).length} attivi</span>
                        </div>
                        <div className="card-body">
                            <p className="settings-help" style={{ marginTop: 0 }}>
                                Vuoto = usa il modello di default del provider (o quello nel frontmatter dell&apos;agente).
                            </p>
                            <ul className="settings-agent-list">
                                {agents.map((a) => (
                                    <li key={a.id} className="settings-agent-row">
                                        <span className="settings-agent-name">
                                            <span className="settings-agent-mono">{initials(a.name)}</span>
                                            {a.name}
                                            <span className="settings-agent-level">{a.level}</span>
                                        </span>
                                        <input
                                            className="topbar-input"
                                            list="aios-model-catalog"
                                            placeholder={a.model}
                                            value={overrides[a.id] ?? ''}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setOverrides((prev) => {
                                                    const next = { ...prev };
                                                    if (v.trim()) next[a.id] = v;
                                                    else delete next[a.id];
                                                    return next;
                                                });
                                            }}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
