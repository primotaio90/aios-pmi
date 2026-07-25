'use client';

import { useRef } from 'react';
import type { ModeId, OperatingMode } from '../lib/types';

/**
 * Selettore delle modalità operative dell'orchestratore.
 *
 * Le modalità sono **sottrattive**: restringono gli strumenti e la postura
 * dell'agente, non concedono mai capacità fuori dalla sua `mcp_whitelist`.
 * Il componente è puramente presentazionale: nessun fetch, tutto via props.
 *
 * Accessibilità: gruppo `radiogroup` con roving tabindex — solo la modalità
 * attiva è raggiungibile con Tab; ← → (e ↑ ↓) spostano la selezione, Home/Fine
 * portano alla prima/ultima, Invio e Spazio confermano la modalità sotto focus.
 */
export function ModeSelector({
    modes,
    value,
    onChange,
    tools,
    disabled = false,
}: {
    modes: OperatingMode[];
    value: ModeId;
    onChange: (id: ModeId) => void;
    /** Whitelist effettiva dell'agente: serve a marcare i tool non concessi. */
    tools?: string[];
    disabled?: boolean;
}) {
    const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

    if (modes.length === 0) return null;

    const index = Math.max(
        0,
        modes.findIndex((m) => m.id === value)
    );
    const active = modes[index];

    // Sposta selezione e focus sulla modalità `next` (con wrap ai bordi).
    const selectAt = (next: number) => {
        const i = (next + modes.length) % modes.length;
        onChange(modes[i].id);
        chipRefs.current[i]?.focus();
    };

    const onChipKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            selectAt(i + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            selectAt(i - 1);
        } else if (e.key === 'Home') {
            e.preventDefault();
            selectAt(0);
        } else if (e.key === 'End') {
            e.preventDefault();
            selectAt(modes.length - 1);
        } else if (e.key === 'Enter' || e.key === ' ') {
            // Gestito qui (e non dal click nativo) per non emettere due volte.
            e.preventDefault();
            onChange(modes[i].id);
        }
    };

    // `tools` assente = whitelist dell'agente sconosciuta: non marchiamo nulla.
    const granted = Array.isArray(tools) ? tools : null;
    // Modalità senza restrizione (`tools: null`) → mostra la whitelist dell'agente.
    const shown = active.tools ?? granted ?? [];
    const emptyLabel =
        active.tools === null && granted === null
            ? 'tutti gli strumenti dell’agente'
            : 'nessuno strumento disponibile';

    return (
        <div className="mode-selector" style={{ ['--mode-color' as string]: active.color }}>
            <div className="mode-chips" role="radiogroup" aria-label="Modalità operativa">
                {modes.map((m, i) => {
                    const on = m.id === active.id;
                    return (
                        <button
                            key={m.id}
                            type="button"
                            ref={(el) => {
                                chipRefs.current[i] = el;
                            }}
                            className={`mode-chip${on ? ' on' : ''}`}
                            style={{ ['--mode-color' as string]: m.color }}
                            role="radio"
                            aria-checked={on}
                            tabIndex={on ? 0 : -1}
                            disabled={disabled}
                            title={`${m.label} · ${m.tagline}`}
                            onClick={() => onChange(m.id)}
                            onKeyDown={(e) => onChipKeyDown(e, i)}
                        >
                            <span className="mode-chip-icon" aria-hidden="true">
                                {m.icon}
                            </span>
                            <span className="mode-chip-label">{m.label}</span>
                        </button>
                    );
                })}
            </div>

            <div className="mode-hint">
                <span className="mode-hint-tagline">{active.tagline}</span>
                <span className="mode-hint-desc">{active.description}</span>
            </div>

            <div className="mode-tools">
                {shown.length === 0 ? (
                    <span className="mode-tool">{emptyLabel}</span>
                ) : (
                    shown.map((t) => {
                        const off = granted !== null && !granted.includes(t);
                        return (
                            <span
                                key={t}
                                className={`mode-tool${off ? ' off' : ''}`}
                                title={off ? 'Capacità non concessa a questo agente' : t}
                            >
                                {t}
                            </span>
                        );
                    })
                )}
            </div>
        </div>
    );
}
