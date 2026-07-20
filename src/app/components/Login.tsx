'use client';

import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { SessionUser } from '../lib/types';

const DEMO = [
    { username: 'mrossi', name: 'Marta Rossi' },
    { username: 'lbianchi', name: 'Luca Bianchi' },
    { username: 'gverdi', name: 'Giulia Verdi' },
];

export function Login({ onLogin }: { onLogin: (u: SessionUser) => void }) {
    const [username, setUsername] = useState('mrossi');
    const [password, setPassword] = useState('aios2026');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            onLogin(await api.login(username.trim(), password));
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Errore di rete');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-shell">
            <div className="glass login-card">
                <div className="brand">
                    <span className="brand-dot"></span>
                    <span>AIOS</span>
                </div>
                <h1 className="login-title">Dashboard di Automazione</h1>
                <p className="login-sub">
                    Studio di consulenza AI-native · Orchestratore, 3 Direttori e sub-agenti esperti on-demand.
                </p>

                <form onSubmit={submit} className="login-form">
                    <label className="login-field">
                        <span>Username</span>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="username"
                            spellCheck={false}
                        />
                    </label>
                    <label className="login-field">
                        <span>Password</span>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                        />
                    </label>

                    {error && <div className="login-error">{error}</div>}

                    <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
                        {loading ? 'Accesso…' : 'Accedi'}
                    </button>
                </form>

                <div className="login-demo">
                    <div className="consultant-title">Account demo (password: aios2026)</div>
                    <div className="login-demo-grid">
                        {DEMO.map((u) => (
                            <button
                                key={u.username}
                                type="button"
                                className={`login-demo-btn ${username === u.username ? 'active' : ''}`}
                                onClick={() => {
                                    setUsername(u.username);
                                    setPassword('aios2026');
                                }}
                            >
                                <div className="avatar">{u.name[0]}</div>
                                <div>
                                    <div className="login-demo-name">{u.name}</div>
                                    <div className="login-demo-user">{u.username}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                    <p className="login-note">
                        Il ruolo <strong>project_manager</strong> (Fase 2) è riservato e disabilitato.
                    </p>
                </div>
            </div>
        </div>
    );
}