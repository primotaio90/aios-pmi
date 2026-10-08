'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { DeliveryFile, DeliveryGap, DeliveryItem, DeliveryResult, DeliverySnapshot, Toast } from '../lib/types';
import { FileViewer } from './FileViewer';
import { MarkdownView } from './MarkdownView';

/**
 * Delivery desk: answers "what can we already hand to the client?" at a glance.
 * The snapshot is deterministic (no LLM): ready items, work in progress, gaps.
 * The consultant picks what goes in the package and produces a client-facing
 * markdown dossier, written by the engine through the MCP gateway.
 */

const KIND_LABEL: Record<DeliveryItem['kind'], string> = {
    report: 'Report',
    output: 'Output',
    knowledge: 'Documento',
};

/** Dimensione leggibile; stringa vuota se il dato non è disponibile. */
function fmtSize(bytes: number | null): string {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** ISO → "2026-07-25 14:32"; stringa vuota se il valore non è una data ISO. */
function fmtDate(iso: string | null): string {
    if (typeof iso !== 'string' || iso.length < 10) return '';
    return iso.slice(0, 16).replace('T', ' ');
}

/** Riga di un documento selezionabile (pronto o in lavorazione). */
function ItemRow({
    item,
    checked,
    onToggle,
    onOpen,
}: {
    item: DeliveryItem;
    checked: boolean;
    onToggle: (id: string) => void;
    onOpen: (path: string) => void;
}) {
    const path = item.path;
    const meta = [fmtDate(item.updated_at), fmtSize(item.size)].filter(Boolean);
    return (
        <li className={`delivery-item ${item.status}`}>
            <label className="delivery-item-main">
                <input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} />
                <span className="delivery-item-title">{item.title}</span>
            </label>
            <div className="delivery-item-meta">
                <span className="delivery-kind">{KIND_LABEL[item.kind]}</span>
                {item.department && <span className="badge">{item.department}</span>}
                {item.source && <span className="delivery-item-source">{item.source}</span>}
                {meta.map((m) => (
                    <span key={m}>{m}</span>
                ))}
            </div>
            {path && (
                <button type="button" className="delivery-item-path" onClick={() => onOpen(path)} title="Apri il documento">
                    {path}
                </button>
            )}
            {item.note && <div className="delivery-item-note">{item.note}</div>}
        </li>
    );
}

/** Riga di ciò che ancora non è consegnabile: sola lettura. */
function GapRow({ gap }: { gap: DeliveryGap }) {
    return (
        <li className="delivery-gap">
            <div className="delivery-item-title">{gap.label}</div>
            <div className="delivery-gap-reason">{gap.reason}</div>
            <div className="delivery-item-meta">
                {gap.department && <span className="badge">{gap.department}</span>}
                {gap.task_id && <span className="delivery-item-source">{gap.task_id}</span>}
            </div>
        </li>
    );
}

export function DeliveryPanel({
    project,
    onBack,
    pushToast,
}: {
    project: string;
    onBack: () => void;
    pushToast: (t: Omit<Toast, 'id'>) => void;
}) {
    const [snapshot, setSnapshot] = useState<DeliverySnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    const [selected, setSelected] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [producing, setProducing] = useState(false);
    const [result, setResult] = useState<DeliveryResult | null>(null);
    const [viewing, setViewing] = useState<string | null>(null);

    // Applying a snapshot always resets the selection to its default:
    // everything ready is in, everything partial is out.
    const applySnapshot = useCallback((snap: DeliverySnapshot) => {
        setSnapshot(snap);
        setSelected(snap.items.filter((i) => i.status === 'ready').map((i) => i.id));
    }, []);

    useEffect(() => {
        let alive = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        api.delivery(project)
            .then((snap) => {
                if (!alive) return;
                applySnapshot(snap);
                setError(null);
            })
            .catch((err) => {
                if (alive) setError(err instanceof ApiError ? err.message : 'Caricamento della consegna fallito');
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [project, reloadKey, applySnapshot]);

    const ready = useMemo(() => snapshot?.items.filter((i) => i.status === 'ready') ?? [], [snapshot]);
    const partial = useMemo(() => snapshot?.items.filter((i) => i.status === 'partial') ?? [], [snapshot]);
    const gaps = snapshot?.gaps ?? [];
    const previous: DeliveryFile[] = snapshot?.previous ?? [];

    const toggle = (id: string) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const selectReady = (on: boolean) =>
        setSelected((prev) => {
            const readyIds = ready.map((i) => i.id);
            const others = prev.filter((id) => !readyIds.includes(id));
            return on ? [...others, ...readyIds] : others;
        });

    const produce = async (e: React.FormEvent) => {
        e.preventDefault();
        if (producing || selected.length === 0) return;
        setProducing(true);
        setError(null);
        try {
            const res = await api.produceDelivery(project, {
                title: title.trim() || undefined,
                include: selected,
                notes: notes.trim() || undefined,
            });
            setResult(res.delivery);
            applySnapshot(res.snapshot);
            pushToast({ level: 'success', message: `Pacchetto di consegna generato: ${res.delivery.path}` });
        } catch (err) {
            // The submit button is at the bottom of a long page while the error
            // banner is at the top: a toast guarantees the failure is seen.
            const msg = err instanceof ApiError ? err.message : 'Generazione del pacchetto fallita';
            setError(msg);
            pushToast({ level: 'error', message: msg });
        } finally {
            setProducing(false);
        }
    };

    const download = () => {
        if (!result) return;
        const blob = new Blob([result.content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.path.split('/').pop() || 'consegna.md';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const copy = async () => {
        if (!result) return;
        try {
            await navigator.clipboard.writeText(result.content);
            pushToast({ level: 'success', message: 'Dossier copiato negli appunti' });
        } catch {
            pushToast({ level: 'warn', message: 'Copia negli appunti non disponibile' });
        }
    };

    const score = snapshot?.readiness.score ?? null;

    return (
        <section className="director-panel">
            <div className="header-actions">
                <div>
                    <button className="btn btn-secondary panel-back" onClick={onBack}>
                        ← Home
                    </button>
                    <h1 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        📦 Consegna al cliente
                        {snapshot?.project?.client && <span className="badge">{snapshot.project.client}</span>}
                    </h1>
                    <div className="title-desc">Cosa è già consegnabile, cosa è in lavorazione, cosa manca</div>
                </div>
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setReloadKey((n) => n + 1)}
                    disabled={loading}
                >
                    ↻ Aggiorna
                </button>
            </div>

            {error && <div className="glass panel-state login-error">{error}</div>}

            {!snapshot && loading && <div className="glass panel-state">Caricamento della consegna…</div>}

            {snapshot && (
                <>
                    {/* Readiness a colpo d'occhio */}
                    <div className="glass panel-block delivery-hero">
                        <div className="delivery-score">
                            <div className="delivery-score-num">{score === null ? '—' : `${score}%`}</div>
                            <div className="delivery-score-label">Pronto alla consegna</div>
                            <div className={`progress-track ${score === null ? 'empty' : ''}`}>
                                <div className="progress-fill" style={{ width: `${score ?? 0}%` }} />
                            </div>
                        </div>
                        <div className="delivery-kpis">
                            <div className="pm-kpi kpi-success">
                                <div className="pm-kpi-value">{snapshot.readiness.ready}</div>
                                <div className="pm-kpi-label">Pronti</div>
                            </div>
                            <div className="pm-kpi kpi-warn">
                                <div className="pm-kpi-value">{snapshot.readiness.partial}</div>
                                <div className="pm-kpi-label">In lavorazione</div>
                            </div>
                            <div className="pm-kpi kpi-error">
                                <div className="pm-kpi-value">{snapshot.readiness.missing}</div>
                                <div className="pm-kpi-label">Non disponibili</div>
                            </div>
                        </div>
                    </div>

                    {/* Pronto alla consegna */}
                    <div className="glass panel-block delivery-section">
                        <div className="card-header">
                            <h3 className="card-title">✅ Pronto alla consegna</h3>
                            <div className="delivery-select-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => selectReady(true)} disabled={ready.length === 0}>
                                    Seleziona tutto
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={() => selectReady(false)} disabled={ready.length === 0}>
                                    Deseleziona tutto
                                </button>
                            </div>
                        </div>
                        <div className="card-body">
                            {ready.length === 0 ? (
                                <div className="home-empty">
                                    Nessun documento è ancora consegnabile. Completa un obiettivo o approva i task in
                                    revisione per popolare questa lista.
                                </div>
                            ) : (
                                <ul className="delivery-list">
                                    {ready.map((item) => (
                                        <ItemRow
                                            key={item.id}
                                            item={item}
                                            checked={selected.includes(item.id)}
                                            onToggle={toggle}
                                            onOpen={setViewing}
                                        />
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* In lavorazione */}
                    <div className="glass panel-block delivery-section">
                        <div className="card-header">
                            <h3 className="card-title">🟡 In lavorazione</h3>
                            <span className="badge">{partial.length}</span>
                        </div>
                        <div className="card-body">
                            {partial.length === 0 ? (
                                <div className="home-empty">Niente in attesa di approvazione.</div>
                            ) : (
                                <ul className="delivery-list">
                                    {partial.map((item) => (
                                        <ItemRow
                                            key={item.id}
                                            item={item}
                                            checked={selected.includes(item.id)}
                                            onToggle={toggle}
                                            onOpen={setViewing}
                                        />
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* Gap */}
                    <div className="glass panel-block delivery-section">
                        <div className="card-header">
                            <h3 className="card-title">⛔ Non ancora disponibile</h3>
                            <span className="badge">{gaps.length}</span>
                        </div>
                        <div className="card-body">
                            {gaps.length === 0 ? (
                                <div className="home-empty">Nessuna lacuna aperta.</div>
                            ) : (
                                <ul className="delivery-list">
                                    {gaps.map((gap) => (
                                        <GapRow key={gap.id} gap={gap} />
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* Produzione del pacchetto */}
                    <div className="glass panel-block delivery-section">
                        <div className="card-header">
                            <h3 className="card-title">Genera il pacchetto</h3>
                            <span className="badge">{selected.length} selezionati</span>
                        </div>
                        <div className="card-body">
                            <form className="delivery-form" onSubmit={produce}>
                                <input
                                    className="delivery-input"
                                    placeholder="Titolo del pacchetto (opzionale)"
                                    maxLength={120}
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    disabled={producing}
                                />
                                <textarea
                                    className="delivery-textarea"
                                    rows={3}
                                    placeholder="Note per il cliente (opzionale)"
                                    maxLength={4000}
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    disabled={producing}
                                />
                                <div className="delivery-actions">
                                    <button type="submit" className="btn btn-primary" disabled={producing || selected.length === 0}>
                                        {producing ? 'Generazione…' : '📦 Genera pacchetto di consegna'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>

                    {/* Anteprima del dossier appena prodotto */}
                    {result && (
                        <div className="glass panel-block delivery-preview">
                            <div className="card-header">
                                <h3 className="card-title">Anteprima del pacchetto</h3>
                                <span className="badge">{result.path}</span>
                            </div>
                            <div className="card-body">
                                <div className="delivery-actions">
                                    <button type="button" className="btn btn-secondary" onClick={download}>
                                        ⬇️ Scarica .md
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={copy}>
                                        📋 Copia
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={() => setResult(null)}>
                                        ✕ Chiudi anteprima
                                    </button>
                                </div>
                                <MarkdownView source={result.content} />
                            </div>
                        </div>
                    )}

                    {/* Consegne precedenti */}
                    <div className="glass panel-block delivery-section">
                        <div className="card-header">
                            <h3 className="card-title">Consegne precedenti</h3>
                            <span className="badge">{previous.length}</span>
                        </div>
                        <div className="card-body">
                            {previous.length === 0 ? (
                                <div className="home-empty">Nessun pacchetto generato finora.</div>
                            ) : (
                                <ul className="delivery-prev-list">
                                    {previous.map((f) => (
                                        <li key={f.path}>
                                            <button type="button" className="delivery-prev-row" onClick={() => setViewing(f.path)}>
                                                <span className="file-name">{f.name}</span>
                                                <span className="file-path">{f.path}</span>
                                                <span className="delivery-item-meta">
                                                    {fmtDate(f.mtime)} · {fmtSize(f.size)}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </>
            )}

            {viewing && <FileViewer project={project} path={viewing} onClose={() => setViewing(null)} />}
        </section>
    );
}
