'use client';

import { useState } from 'react';
import type { ProjectMeta, SessionUser } from '../lib/types';

export function Topbar({
    user,
    projects,
    current,
    onSelect,
    onCreate,
    connected,
    pmEnabled,
    onOpenPM,
    onLogout,
}: {
    user: SessionUser;
    projects: ProjectMeta[];
    current: ProjectMeta | null;
    onSelect: (id: string) => void;
    onCreate: (input: { name: string; client?: string; description?: string }) => Promise<void>;
    connected: boolean;
    pmEnabled: boolean;
    onOpenPM: () => void;
    onLogout: () => void;
}) {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [client, setClient] = useState('');
    const [description, setDescription] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        setErr(null);
        try {
            await onCreate({ name: name.trim(), client: client.trim() || undefined, description: description.trim() });
            setName('');
            setClient('');
            setDescription('');
            setCreating(false);
        } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : 'Creazione fallita');
        } finally {
            setBusy(false);
        }
    };

    return (
        <header className="topbar glass">
            <div className="topbar-left">
                <div className="brand topbar-brand">
                    <span className="brand-dot"></span>
                    <span>AIOS</span>
                </div>

                <div className="tenant-switcher">
                    <select
                        value={current?.id ?? ''}
                        onChange={(e) => onSelect(e.target.value)}
                        className="tenant-select"
                        aria-label="Progetto cliente"
                    >
                        {projects.length === 0 && <option value="">— nessun progetto —</option>}
                        {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name} · {p.client}
                            </option>
                        ))}
                    </select>
                    <button type="button" className="btn btn-secondary topbar-new" onClick={() => setCreating((v) => !v)}>
                        + Nuovo
                    </button>
                </div>
            </div>

            <div className="topbar-right">
                <span className={`sse-pill ${connected ? 'on' : 'off'}`} title="Stato SSE event bus">
                    <span className="pulse-dot"></span>
                    {connected ? 'live' : 'riconnessione…'}
                </span>

                <button
                    type="button"
                    className={`pm-slot ${pmEnabled ? 'pm-slot-on' : 'pm-slot-off'}`}
                    title={pmEnabled ? 'Apri console Project Manager' : 'PM non abilitato per questo tenant'}
                    onClick={pmEnabled ? onOpenPM : undefined}
                    disabled={!pmEnabled}
                >
                    PM · Fase 2
                </button>

                <div className="user-chip">
                    <div className="avatar">{user.name[0]}</div>
                    <div className="user-chip-info">
                        <div className="user-chip-name">{user.name}</div>
                        <div className="user-chip-role">{user.role}</div>
                    </div>
                </div>

                <button type="button" className="btn btn-secondary" onClick={onLogout}>
                    Esci
                </button>
            </div>

            {creating && (
                <form className="topbar-create glass" onSubmit={submit}>
                    <input
                        className="topbar-input"
                        placeholder="Nome progetto *"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <input
                        className="topbar-input"
                        placeholder="Cliente"
                        value={client}
                        onChange={(e) => setClient(e.target.value)}
                    />
                    <input
                        className="topbar-input topbar-input-wide"
                        placeholder="Descrizione breve"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                    <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                        {busy ? 'Creazione…' : 'Crea tenant'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
                        Annulla
                    </button>
                    {err && <div className="login-error topbar-err">{err}</div>}
                </form>
            )}
        </header>
    );
}