'use client';

import type { DirectorOverview, OrchestratorOverview, ProjectMeta } from '../lib/types';
import { initials } from '../lib/text';

function openOnKey(onOpen: () => void) {
    return (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
        }
    };
}

const STATUS_LABEL: Record<string, string> = {
    idle: 'In attesa',
    orchestrating: 'Orchestrando',
    working: 'In lavoro',
    blocked: 'Bloccato',
    review: 'In revisione',
};

function StatusBadge({ status }: { status: string }) {
    return <span className={`status-badge status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function ProgressBar({ value }: { value: number | null }) {
    if (value === null) return <div className="progress-track empty" title="Nessun task" />;
    return (
        <div className="progress-track" title={`${value}%`}>
            <div className="progress-fill" style={{ width: `${value}%` }} />
        </div>
    );
}

function OrchestratorCard({
    orchestrator,
    onOpen,
}: {
    orchestrator: OrchestratorOverview;
    onOpen: () => void;
}) {
    const goal = orchestrator.active_goal;
    return (
        <article
            className="glass home-card home-card-orchestrator"
            onClick={onOpen}
            role="button"
            tabIndex={0}
            onKeyDown={openOnKey(onOpen)}
        >
            <header className="home-card-header">
                <div className="home-icon home-icon-core">{initials(orchestrator.name)}</div>
                <div className="home-card-title">
                    <h3>{orchestrator.name}</h3>
                    <span className="home-card-sub">Livello strategico · scomposizione e aggregazione</span>
                </div>
                <StatusBadge status={orchestrator.status} />
            </header>

            <div className="home-progress">
                <ProgressBar value={orchestrator.progress} />
                <span className="home-progress-label">
                    {orchestrator.progress === null ? '—' : `${orchestrator.progress}%`}
                </span>
            </div>

            <div className="home-goal">
                {goal ? (
                    <>
                        <div className="home-goal-id">{goal.id}</div>
                        <div className="home-goal-text">{goal.text}</div>
                        <ul className="macro-timeline">
                            {goal.macro_goals.map((m) => (
                                <li key={m.department} className={`macro-item macro-${m.status}`}>
                                    <span className="macro-dept">{m.department}</span>
                                    <span className="macro-desc">{m.description}</span>
                                    <span className="macro-status">{m.status}</span>
                                </li>
                            ))}
                        </ul>
                    </>
                ) : (
                    <div className="home-empty">
                        Nessun obiettivo attivo. Usa il modulo in alto per avviare l&apos;orchestrazione.
                    </div>
                )}
            </div>
        </article>
    );
}

function DirectorCard({
    director,
    onOpen,
}: {
    director: DirectorOverview;
    onOpen: () => void;
}) {
    return (
        <article
            className="glass home-card"
            onClick={onOpen}
            role="button"
            tabIndex={0}
            onKeyDown={openOnKey(onOpen)}
        >
            <header className="home-card-header">
                <div className="home-icon">{initials(director.name)}</div>
                <div className="home-card-title">
                    <h3>{director.name}</h3>
                    <span className="home-card-sub">{director.department}</span>
                </div>
                <StatusBadge status={director.status} />
            </header>

            <div className="home-progress">
                <ProgressBar value={director.progress} />
                <span className="home-progress-label">
                    {director.progress === null ? '—' : `${director.progress}%`}
                </span>
            </div>

            <div className="home-focus">
                {director.current_focus ? (
                    <span className="home-focus-text">{director.current_focus}</span>
                ) : (
                    <span className="home-focus-text muted">Nessun focus attivo</span>
                )}
            </div>

            <footer className="home-card-foot">
                <span className="badge">{director.active_subagents} sub-agenti attivi</span>
                <span className="home-enter">Apri dettaglio →</span>
            </footer>
        </article>
    );
}

export function HomeGrid({
    project,
    orchestrator,
    directors,
    onOpenDirector,
}: {
    project: ProjectMeta;
    orchestrator: OrchestratorOverview | null;
    directors: DirectorOverview[];
    onOpenDirector: (id: string) => void;
}) {
    return (
        <section className="home-section">
            <div className="home-project-head">
                <div>
                    <h1 className="home-title">{project.name}</h1>
                    <div className="title-desc">
                        {project.client} · {project.description || 'nessuna descrizione'}
                    </div>
                </div>
            </div>

            <div className="home-grid">
                {orchestrator ? (
                    <OrchestratorCard orchestrator={orchestrator} onOpen={() => onOpenDirector(orchestrator.id)} />
                ) : (
                    <div className="glass home-card home-empty">Orchestratore non disponibile.</div>
                )}
                {directors.map((d) => (
                    <DirectorCard key={d.id} director={d} onOpen={() => onOpenDirector(d.id)} />
                ))}
            </div>
        </section>
    );
}
