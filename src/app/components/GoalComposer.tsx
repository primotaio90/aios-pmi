'use client';

import { useState } from 'react';
import { ApiError } from '../lib/api';

const SUGGESTIONS = [
    'Analizza il mercato dell\'arredamento e proponi un posizionamento',
    'Definisci l\'architettura tecnica del sito e-commerce',
    'Pianifica la consegna in 8 settimane con milestone e gantt',
];

export function GoalComposer({
    busy,
    onSubmit,
}: {
    busy: boolean;
    onSubmit: (text: string) => Promise<void>;
}) {
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (trimmed.length < 5 || sending) return;
        setSending(true);
        setError(null);
        try {
            await onSubmit(trimmed);
            setText('');
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Invio fallito');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="goal-composer glass">
            <div className="goal-composer-head">
                <h3 className="card-title">
                    <span>Nuovo obiettivo</span>
                </h3>
                <span className="badge">→ Orchestrator_Core</span>
            </div>
            <form onSubmit={submit} className="goal-form">
                <textarea
                    className="goal-textarea"
                    placeholder="Descrivi l'obiettivo del cliente (min 5 caratteri)…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                    disabled={sending}
                />
                <div className="goal-form-row">
                    <div className="goal-suggestions">
                        {SUGGESTIONS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                className="goal-suggestion"
                                onClick={() => setText(s)}
                                disabled={sending}
                                title={s}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary goal-submit"
                        disabled={sending || busy || text.trim().length < 5}
                    >
                        {sending ? 'Invio…' : 'Avvia orchestrazione'}
                    </button>
                </div>
                {error && <div className="login-error">{error}</div>}
            </form>
        </div>
    );
}
