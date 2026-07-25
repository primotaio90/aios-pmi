'use client';

import { useState } from 'react';
import { ApiError } from '../lib/api';
import type { ModeId, OperatingMode } from '../lib/types';
import { MarkdownView } from './MarkdownView';
import { ModeSelector } from './ModeSelector';

const SUGGESTIONS = [
    'Analizza il mercato dell\'arredamento e proponi un posizionamento',
    'Definisci l\'architettura tecnica del sito e-commerce',
    'Pianifica la consegna in 8 settimane con milestone e gantt',
];

/**
 * Modalità di riserva usata finché il catalogo non è disponibile (rete KO o
 * primo render): il compositore resta identico al comportamento storico.
 */
const FALLBACK_MODE: OperatingMode = {
    id: 'orchestrator',
    label: 'Orchestratore',
    icon: '🧭',
    color: '#38bdf8',
    tagline: 'Coordina task, direttori e sub-agenti',
    description: 'Modalità base: scompone l\'obiettivo, delega ai direttori e aggrega i risultati.',
    orchestrates: true,
    tools: null,
    allow_writes: true,
    placeholder: 'Descrivi l\'obiettivo del cliente (min 5 caratteri)…',
    cta: 'Avvia orchestrazione',
};

function errorMessage(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    if (err instanceof Error) return err.message;
    return 'Invio fallito';
}

export function GoalComposer({
    busy,
    onSubmit,
    modes,
    mode,
    onModeChange,
    orchestratorTools,
    onAskMode,
    onOpenChat,
}: {
    busy: boolean;
    /** Modalità orchestrante: avvia il ciclo di orchestrazione sul goal. */
    onSubmit: (text: string) => Promise<void>;
    modes: OperatingMode[];
    mode: ModeId;
    onModeChange: (id: ModeId) => void;
    /** Whitelist effettiva dell'orchestratore, per marcare i tool non concessi. */
    orchestratorTools?: string[];
    /** Modalità non orchestranti: risposta diretta in markdown, senza goal. */
    onAskMode: (text: string, mode: ModeId) => Promise<string>;
    onOpenChat?: () => void;
}) {
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    // Risultato dell'ultima richiesta in modalità non orchestrante.
    const [reply, setReply] = useState<string | null>(null);
    const [asked, setAsked] = useState('');
    const [replyMode, setReplyMode] = useState<OperatingMode | null>(null);

    const active =
        modes.find((m) => m.id === mode) ?? modes.find((m) => m.id === 'orchestrator') ?? FALLBACK_MODE;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = text.trim();
        if (trimmed.length < 5 || sending) return;
        setSending(true);
        setError(null);
        try {
            if (active.orchestrates) {
                await onSubmit(trimmed);
                setText('');
            } else {
                const answer = await onAskMode(trimmed, active.id);
                setReply(answer);
                setAsked(trimmed);
                setReplyMode(active);
                // La textarea resta piena: serve a iterare sulla stessa richiesta.
            }
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setSending(false);
        }
    };

    const copyReply = async () => {
        if (reply === null) return;
        try {
            await navigator.clipboard?.writeText(reply);
        } catch {
            /* clipboard non disponibile: fallback silenzioso */
        }
    };

    /** Il piano dell'Architetto diventa il testo dell'obiettivo da orchestrare,
     *  con la richiesta originale come intestazione per non perdere il contesto. */
    const useAsGoal = () => {
        if (reply === null) return;
        setText(asked ? `${asked}\n\n--- Piano dell'Architetto ---\n${reply}` : reply);
        setReply(null);
        setReplyMode(null);
        onModeChange('orchestrator');
    };

    return (
        <div className="goal-composer glass">
            <div className="goal-composer-head">
                <h3 className="card-title">
                    <span>{active.orchestrates ? 'Nuovo obiettivo' : `${active.icon} ${active.label}`}</span>
                </h3>
                <span className="badge">{active.orchestrates ? '→ Orchestrator_Core' : 'risposta diretta'}</span>
            </div>

            <ModeSelector
                modes={modes}
                value={active.id}
                onChange={onModeChange}
                tools={orchestratorTools}
                disabled={sending}
            />

            <form onSubmit={submit} className="goal-form">
                <textarea
                    className="goal-textarea"
                    placeholder={active.placeholder}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                    disabled={sending}
                />
                <div className="goal-form-row">
                    <div className="goal-suggestions">
                        {active.orchestrates &&
                            SUGGESTIONS.map((s) => (
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
                        disabled={sending || (busy && active.orchestrates) || text.trim().length < 5}
                    >
                        {sending ? '…' : active.cta}
                    </button>
                </div>
                {error && <div className="login-error">{error}</div>}
            </form>

            {reply !== null && (
                <div className="mode-result">
                    <div className="card-header">
                        <h3 className="card-title">
                            <span>{replyMode ? `${replyMode.icon} Risposta · ${replyMode.label}` : 'Risposta'}</span>
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-secondary" onClick={copyReply}>
                                📋 Copia
                            </button>
                            {onOpenChat && (
                                <button type="button" className="btn btn-secondary" onClick={onOpenChat}>
                                    💬 Apri chat completa
                                </button>
                            )}
                            {replyMode?.id === 'architect' && (
                                <button type="button" className="btn btn-primary" onClick={useAsGoal}>
                                    🚀 Usa come obiettivo
                                </button>
                            )}
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => {
                                    setReply(null);
                                    setReplyMode(null);
                                }}
                            >
                                ✕ Chiudi
                            </button>
                        </div>
                    </div>
                    <div className="card-body">
                        <MarkdownView source={reply} />
                    </div>
                </div>
            )}
        </div>
    );
}
