'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { MarkdownView } from './MarkdownView';

/** Parser CSV a riga singola con supporto per campi tra virgolette. */
function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                cur += ch;
            }
        } else if (ch === '"') {
            quoted = true;
        } else if (ch === ',') {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

/** CSV come tabella essenziale; fallback a testo se la struttura non regge. */
function CsvTable({ content }: { content: string }) {
    const lines = content.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
    if (lines.length < 2) return <pre className="file-viewer-pre">{content}</pre>;
    const header = parseCsvLine(lines[0]);
    if (header.length < 2) return <pre className="file-viewer-pre">{content}</pre>;
    const rows = lines.slice(1).map(parseCsvLine);
    return (
        <table className="data-table">
            <thead>
                <tr>
                    {header.map((c, i) => (
                        <th key={i}>{c}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((r, ri) => (
                    <tr key={ri}>
                        {r.map((c, ci) => (
                            <td key={ci}>{c}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function FileBody({ path, content }: { path: string; content: string }) {
    if (path.endsWith('.md')) return <MarkdownView source={content} />;
    if (path.endsWith('.csv')) return <CsvTable content={content} />;
    if (path.endsWith('.json')) {
        // Parse outside the JSX so a parse failure never lands inside try/JSX.
        let pretty: string | null = null;
        try {
            pretty = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
            pretty = null;
        }
        if (pretty !== null) return <pre className="file-viewer-pre">{pretty}</pre>;
    }
    return <pre className="file-viewer-pre">{content}</pre>;
}

export function FileViewer({
    project,
    path,
    onClose,
}: {
    project: string;
    path: string;
    onClose: () => void;
}) {
    const [content, setContent] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true);
        setError(null);
        api.file(project, path)
            .then((f) => {
                if (alive) setContent(f.content);
            })
            .catch((err) => {
                if (alive) setError(err instanceof ApiError ? err.message : 'Lettura fallita');
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [project, path]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="glass modal-content file-viewer" onClick={(e) => e.stopPropagation()}>
                <div className="card-header">
                    <h3 className="card-title">
                        <span className="file-viewer-path">{path}</span>
                    </h3>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>
                        Chiudi
                    </button>
                </div>
                <div className="file-viewer-body">
                    {loading && <div className="home-empty">Caricamento…</div>}
                    {error && <div className="login-error">{error}</div>}
                    {content !== null && !loading && !error && <FileBody path={path} content={content} />}
                </div>
            </div>
        </div>
    );
}
