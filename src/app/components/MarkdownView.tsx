'use client';

import type { ReactNode } from 'react';

/**
 * Rendering Markdown minimale e sicuro: parser interno che produce elementi
 * React (mai HTML iniettato). Copre il sottoinsieme usato dai file di
 * progetto: titoli, liste (anche con checkbox), tabelle GFM, blocchi di
 * codice, citazioni, grassetto/corsivo/codice inline, link http(s).
 */

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    const re = new RegExp(INLINE_RE.source, 'g');
    let last = 0;
    let n = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) nodes.push(text.slice(last, m.index));
        const tok = m[0];
        const key = `${keyPrefix}-${n++}`;
        if (tok.startsWith('`')) {
            nodes.push(<code key={key}>{tok.slice(1, -1)}</code>);
        } else if (tok.startsWith('**')) {
            nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
        } else if (tok.startsWith('[')) {
            const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
            if (link && /^https?:\/\//.test(link[2])) {
                nodes.push(
                    <a key={key} href={link[2]} target="_blank" rel="noreferrer">
                        {link[1]}
                    </a>
                );
            } else {
                nodes.push(link ? link[1] : tok);
            }
        } else {
            nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
        }
        last = m.index + tok.length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}[-\s:|]*$/;
const CHECKBOX_RE = /^\[([ xX])\]\s+(.*)$/;

function splitRow(row: string): string[] {
    return row
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
}

function isBlockStart(line: string): boolean {
    return (
        HEADING_RE.test(line) ||
        HR_RE.test(line) ||
        UL_RE.test(line) ||
        OL_RE.test(line) ||
        line.startsWith('```') ||
        line.trimStart().startsWith('>')
    );
}

function listItem(raw: string, key: string): ReactNode {
    const check = CHECKBOX_RE.exec(raw);
    if (check) {
        const done = check[1] !== ' ';
        return (
            <li key={key} className={done ? 'md-task-done' : undefined}>
                {done ? '☑ ' : '☐ '}
                {renderInline(check[2], key)}
            </li>
        );
    }
    return <li key={key}>{renderInline(raw, key)}</li>;
}

export function MarkdownView({ source }: { source: string }) {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const blocks: ReactNode[] = [];
    let i = 0;
    let b = 0;

    // Frontmatter YAML in testa: reso come scheda proprietà, non come testo.
    if (lines[0]?.trim() === '---') {
        const end = lines.indexOf('---', 1);
        if (end > 0) {
            const rows = lines
                .slice(1, end)
                .map((l) => /^([\w][\w_-]*):\s*(.*)$/.exec(l))
                .filter((m): m is RegExpExecArray => m !== null);
            if (rows.length > 0) {
                blocks.push(
                    <dl key={`b${b++}`} className="md-frontmatter">
                        {rows.map((r, k) => (
                            <div key={k} style={{ display: 'contents' }}>
                                <dt>{r[1]}</dt>
                                <dd>{r[2]}</dd>
                            </div>
                        ))}
                    </dl>
                );
            }
            i = end + 1;
        }
    }

    while (i < lines.length) {
        const line = lines[i];

        if (!line.trim()) {
            i++;
            continue;
        }

        // Blocco di codice
        if (line.startsWith('```')) {
            const code: string[] = [];
            i++;
            while (i < lines.length && !lines[i].startsWith('```')) {
                code.push(lines[i]);
                i++;
            }
            i++; // salta la chiusura
            blocks.push(
                <pre key={`b${b++}`}>
                    <code>{code.join('\n')}</code>
                </pre>
            );
            continue;
        }

        // Titoli
        const h = HEADING_RE.exec(line);
        if (h) {
            const level = h[1].length;
            const key = `b${b++}`;
            const content = renderInline(h[2], key);
            if (level === 1) blocks.push(<h1 key={key}>{content}</h1>);
            else if (level === 2) blocks.push(<h2 key={key}>{content}</h2>);
            else if (level === 3) blocks.push(<h3 key={key}>{content}</h3>);
            else if (level === 4) blocks.push(<h4 key={key}>{content}</h4>);
            else if (level === 5) blocks.push(<h5 key={key}>{content}</h5>);
            else blocks.push(<h6 key={key}>{content}</h6>);
            i++;
            continue;
        }

        // Separatore
        if (HR_RE.test(line)) {
            blocks.push(<hr key={`b${b++}`} />);
            i++;
            continue;
        }

        // Citazione
        if (line.trimStart().startsWith('>')) {
            const quote: string[] = [];
            while (i < lines.length && lines[i].trimStart().startsWith('>')) {
                quote.push(lines[i].trimStart().replace(/^>\s?/, ''));
                i++;
            }
            const key = `b${b++}`;
            blocks.push(<blockquote key={key}>{renderInline(quote.join(' '), key)}</blockquote>);
            continue;
        }

        // Tabella GFM: riga con "|" seguita dalla riga separatore
        if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_SEP_RE.test(lines[i + 1])) {
            const header = splitRow(line);
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                rows.push(splitRow(lines[i]));
                i++;
            }
            const key = `b${b++}`;
            blocks.push(
                <table key={key}>
                    <thead>
                        <tr>
                            {header.map((c, k) => (
                                <th key={k}>{renderInline(c, `${key}-h${k}`)}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, ri) => (
                            <tr key={ri}>
                                {r.map((c, ci) => (
                                    <td key={ci}>{renderInline(c, `${key}-${ri}-${ci}`)}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            );
            continue;
        }

        // Lista puntata
        if (UL_RE.test(line)) {
            const items: string[] = [];
            while (i < lines.length && UL_RE.test(lines[i])) {
                items.push(UL_RE.exec(lines[i])![1]);
                i++;
            }
            const key = `b${b++}`;
            blocks.push(<ul key={key}>{items.map((it, k) => listItem(it, `${key}-${k}`))}</ul>);
            continue;
        }

        // Lista numerata
        if (OL_RE.test(line)) {
            const items: string[] = [];
            while (i < lines.length && OL_RE.test(lines[i])) {
                items.push(OL_RE.exec(lines[i])![1]);
                i++;
            }
            const key = `b${b++}`;
            blocks.push(<ol key={key}>{items.map((it, k) => listItem(it, `${key}-${k}`))}</ol>);
            continue;
        }

        // Paragrafo: righe consecutive fino a riga vuota o inizio di blocco
        const para: string[] = [line.trim()];
        i++;
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) && !lines[i].includes('|')) {
            para.push(lines[i].trim());
            i++;
        }
        const key = `b${b++}`;
        blocks.push(<p key={key}>{renderInline(para.join(' '), key)}</p>);
    }

    return <article className="md-doc">{blocks}</article>;
}
