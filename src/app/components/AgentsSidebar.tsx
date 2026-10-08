'use client';

import { useMemo, useState } from 'react';
import type { AgentMeta, DirectorOverview, OrchestratorOverview, OverviewResponse } from '../lib/types';
import { initials } from '../lib/text';

const STATUS_LABEL: Record<string, string> = {
    idle: 'In attesa',
    orchestrating: 'Orchestrando',
    working: 'In lavoro',
    blocked: 'Bloccato',
    review: 'In revisione',
};

const LEVEL_LABEL: Record<string, string> = {
    orchestrator: 'Orchestratore',
    pm: 'Project Manager',
    director: 'Direttore',
    expert: 'Sub-agente / Esperto',
};

function StatusBadge({ status }: { status?: string }) {
    if (!status) return null;
    return <span className={`status-badge status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function AgentsSidebar({
    agents,
    overview,
    collapsed,
    onToggleCollapse,
    onOpenDirector,
    onChatAgent,
    activeAgentId,
}: {
    agents: AgentMeta[];
    overview: OverviewResponse | null;
    collapsed: boolean;
    onToggleCollapse: () => void;
    onOpenDirector: (id: string) => void;
    onChatAgent: (id: string) => void;
    activeAgentId: string | null;
}) {
    const [search, setSearch] = useState('');
    const [filterLevel, setFilterLevel] = useState<'all' | 'core' | 'director' | 'expert'>('all');
    // Set of open director accordion IDs (all open by default)
    const [expandedDirectors, setExpandedDirectors] = useState<Set<string>>(new Set());
    const [initializedAccordions, setInitializedAccordions] = useState(false);

    // Group agents into Core (orchestrator, pm), Directors, and Experts mapped by director ID
    const { coreAgents, directors, expertsByDirector, orphanExperts } = useMemo(() => {
        const core: AgentMeta[] = [];
        const dirs: AgentMeta[] = [];
        const expertsMap = new Map<string, AgentMeta[]>();
        const orphans: AgentMeta[] = [];

        const dirIds = new Set(agents.filter((a) => a.level === 'director').map((a) => a.id));

        for (const agent of agents) {
            if (agent.level === 'orchestrator' || agent.level === 'pm') {
                core.push(agent);
            } else if (agent.level === 'director') {
                dirs.push(agent);
            } else if (agent.level === 'expert') {
                if (agent.director && dirIds.has(agent.director)) {
                    const list = expertsMap.get(agent.director) || [];
                    list.push(agent);
                    expertsMap.set(agent.director, list);
                } else {
                    orphans.push(agent);
                }
            }
        }

        return {
            coreAgents: core,
            directors: dirs,
            expertsByDirector: expertsMap,
            orphanExperts: orphans,
        };
    }, [agents]);

    // Expand all directors by default when agents load
    if (!initializedAccordions && directors.length > 0) {
        setExpandedDirectors(new Set(directors.map((d) => d.id)));
        setInitializedAccordions(true);
    }

    const toggleDirector = (id: string) => {
        setExpandedDirectors((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Filter helper
    const matchesSearch = (agent: AgentMeta) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
            agent.name.toLowerCase().includes(q) ||
            agent.id.toLowerCase().includes(q) ||
            agent.department.toLowerCase().includes(q) ||
            agent.keywords.some((k) => k.toLowerCase().includes(q)) ||
            (agent.model && agent.model.toLowerCase().includes(q))
        );
    };

    // Filtered collections
    const filteredCore = coreAgents.filter((a) => {
        if (filterLevel === 'director' || filterLevel === 'expert') return false;
        return matchesSearch(a);
    });

    const filteredDirectors = directors.filter((d) => {
        if (filterLevel === 'core' || filterLevel === 'expert') return false;
        // If director matches search or any of its subagents match search
        if (matchesSearch(d)) return true;
        const subs = expertsByDirector.get(d.id) || [];
        return subs.some(matchesSearch);
    });

    const filteredOrphans = orphanExperts.filter((a) => {
        if (filterLevel === 'core' || filterLevel === 'director') return false;
        return matchesSearch(a);
    });

    const getDirectorLive = (id: string): DirectorOverview | undefined => {
        return overview?.directors.find((d) => d.id === id);
    };

    const getOrchestratorLive = (): OrchestratorOverview | null | undefined => {
        return overview?.orchestrator;
    };

    const totalCount = agents.length;

    return (
        <aside className={`agents-sidebar glass ${collapsed ? 'collapsed' : ''}`} aria-label="Barra laterale agenti">
            {/* Header with Toggle */}
            <div className="sidebar-header">
                <button
                    type="button"
                    className="sidebar-toggle-btn"
                    onClick={onToggleCollapse}
                    title={collapsed ? 'Espandi barra agenti' : 'Riduci barra agenti'}
                >
                    <span className="sidebar-toggle-icon">{collapsed ? '▶' : '◀'}</span>
                </button>
                {!collapsed && (
                    <div className="sidebar-title-wrap">
                        <h2 className="sidebar-title">
                            🤖 Agenti <span className="sidebar-badge">{totalCount}</span>
                        </h2>
                        <span className="sidebar-subtitle">Gerarchia & Sub-agenti</span>
                    </div>
                )}
            </div>

            {/* Collapsed Compact View */}
            {collapsed ? (
                <div className="sidebar-collapsed-content">
                    <div className="collapsed-section-label" title="Agenti disponibili">
                        🤖 {totalCount}
                    </div>
                    <ul className="collapsed-icon-list">
                        {agents.map((a) => {
                            const isActive = activeAgentId === a.id;
                            const isDir = a.level === 'director' || a.level === 'orchestrator';
                            return (
                                <li key={a.id}>
                                    <button
                                        type="button"
                                        className={`collapsed-agent-btn ${isActive ? 'active' : ''}`}
                                        title={`${a.name} (${LEVEL_LABEL[a.level] || a.level})`}
                                        onClick={() => (isDir ? onOpenDirector(a.id) : onChatAgent(a.id))}
                                    >
                                        <span className="collapsed-avatar">{initials(a.name)}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ) : (
                /* Expanded Detailed View */
                <div className="sidebar-body">
                    {/* Search bar */}
                    <div className="sidebar-search-box">
                        <input
                            type="text"
                            className="sidebar-search-input"
                            placeholder="Cerca per nome, ruolo, tag..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                            <button
                                type="button"
                                className="sidebar-search-clear"
                                onClick={() => setSearch('')}
                                title="Cancella ricerca"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    {/* Filter Pills */}
                    <div className="sidebar-filters">
                        <button
                            type="button"
                            className={`sidebar-filter-chip ${filterLevel === 'all' ? 'active' : ''}`}
                            onClick={() => setFilterLevel('all')}
                        >
                            Tutti ({totalCount})
                        </button>
                        <button
                            type="button"
                            className={`sidebar-filter-chip ${filterLevel === 'core' ? 'active' : ''}`}
                            onClick={() => setFilterLevel('core')}
                        >
                            Core ({coreAgents.length})
                        </button>
                        <button
                            type="button"
                            className={`sidebar-filter-chip ${filterLevel === 'director' ? 'active' : ''}`}
                            onClick={() => setFilterLevel('director')}
                        >
                            Direttori ({directors.length})
                        </button>
                        <button
                            type="button"
                            className={`sidebar-filter-chip ${filterLevel === 'expert' ? 'active' : ''}`}
                            onClick={() => setFilterLevel('expert')}
                        >
                            Sub-agenti ({agents.filter((a) => a.level === 'expert').length})
                        </button>
                    </div>

                    {/* Agents Tree / List */}
                    <div className="sidebar-tree">
                        {/* CORE AGENTS SECTION */}
                        {filteredCore.length > 0 && (
                            <div className="sidebar-group">
                                <div className="sidebar-group-label">Core & Strategia</div>
                                {filteredCore.map((agent) => {
                                    const liveOrch = agent.level === 'orchestrator' ? getOrchestratorLive() : null;
                                    const isActive = activeAgentId === agent.id;
                                    return (
                                        <div
                                            key={agent.id}
                                            className={`sidebar-agent-card core-card ${isActive ? 'active' : ''}`}
                                        >
                                            <div className="agent-card-header">
                                                <div className="agent-avatar agent-avatar-core">{initials(agent.name)}</div>
                                                <div className="agent-info">
                                                    <div className="agent-name-row">
                                                        <span className="agent-name">{agent.name}</span>
                                                        {liveOrch && <StatusBadge status={liveOrch.status} />}
                                                    </div>
                                                    <div className="agent-sub">
                                                        {LEVEL_LABEL[agent.level] || agent.level} · {agent.department}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="agent-card-actions">
                                                {agent.level === 'orchestrator' && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => onOpenDirector(agent.id)}
                                                        title="Apri pannello di orchestrazione"
                                                    >
                                                        🔍 Dettaglio
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => onChatAgent(agent.id)}
                                                    title="Apri chat con l'agente"
                                                >
                                                    💬 Chat
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* DIRECTORS & SUB-AGENTS SECTION */}
                        {filteredDirectors.length > 0 && (
                            <div className="sidebar-group">
                                <div className="sidebar-group-label">Direzioni & Sub-agenti</div>
                                {filteredDirectors.map((director) => {
                                    const liveDir = getDirectorLive(director.id);
                                    const subagents = (expertsByDirector.get(director.id) || []).filter((s) => {
                                        if (filterLevel === 'core' || filterLevel === 'director') return false;
                                        return matchesSearch(s);
                                    });
                                    const totalSubCount = (expertsByDirector.get(director.id) || []).length;
                                    const isExpanded = expandedDirectors.has(director.id) || search.trim().length > 0;
                                    const isActive = activeAgentId === director.id;

                                    return (
                                        <div
                                            key={director.id}
                                            className={`sidebar-director-accordion ${isExpanded ? 'expanded' : ''}`}
                                        >
                                            <div
                                                className={`sidebar-agent-card director-card ${isActive ? 'active' : ''}`}
                                            >
                                                <div className="agent-card-header">
                                                    <button
                                                        type="button"
                                                        className="accordion-toggle"
                                                        onClick={() => toggleDirector(director.id)}
                                                        title={isExpanded ? 'Comprimi sub-agenti' : 'Espandi sub-agenti'}
                                                    >
                                                        <span className="chevron">{isExpanded ? '▼' : '▶'}</span>
                                                    </button>
                                                    <div className="agent-avatar">{initials(director.name)}</div>
                                                    <div className="agent-info">
                                                        <div className="agent-name-row">
                                                            <span className="agent-name">{director.name}</span>
                                                            {liveDir && <StatusBadge status={liveDir.status} />}
                                                        </div>
                                                        <div className="agent-sub">
                                                            {director.department} · {totalSubCount} sub-agenti
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="agent-card-actions">
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => onOpenDirector(director.id)}
                                                        title="Apri vista direzionale"
                                                    >
                                                        🔍 Dettaglio
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => onChatAgent(director.id)}
                                                        title="Chat diretta con il Direttore"
                                                    >
                                                        💬 Chat
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Sub-agents List */}
                                            {isExpanded && (
                                                <div className="subagent-list">
                                                    {subagents.length === 0 ? (
                                                        <div className="subagent-empty">
                                                            {search ? 'Nessun sub-agente trovato.' : 'Nessun sub-agente collegato.'}
                                                        </div>
                                                    ) : (
                                                        subagents.map((sub) => {
                                                            const isSubActive = activeAgentId === sub.id;
                                                            return (
                                                                <div
                                                                    key={sub.id}
                                                                    className={`subagent-card ${isSubActive ? 'active' : ''}`}
                                                                >
                                                                    <div className="subagent-head">
                                                                        <span className="subagent-icon">{initials(sub.name)}</span>
                                                                        <div className="subagent-details">
                                                                            <div className="subagent-name">{sub.name}</div>
                                                                            <div className="subagent-keywords">
                                                                                {sub.keywords.slice(0, 3).join(' · ')}
                                                                            </div>
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            className="subagent-chat-btn"
                                                                            onClick={() => onChatAgent(sub.id)}
                                                                            title={`Chat con ${sub.name}`}
                                                                        >
                                                                            💬
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* ORPHAN EXPERTS SECTION (IF ANY) */}
                        {filteredOrphans.length > 0 && (
                            <div className="sidebar-group">
                                <div className="sidebar-group-label">Altri Esperti</div>
                                {filteredOrphans.map((expert) => {
                                    const isActive = activeAgentId === expert.id;
                                    return (
                                        <div
                                            key={expert.id}
                                            className={`sidebar-agent-card expert-card ${isActive ? 'active' : ''}`}
                                        >
                                            <div className="agent-card-header">
                                                <div className="agent-avatar">{initials(expert.name)}</div>
                                                <div className="agent-info">
                                                    <div className="agent-name-row">
                                                        <span className="agent-name">{expert.name}</span>
                                                    </div>
                                                    <div className="agent-sub">{expert.department}</div>
                                                </div>
                                            </div>
                                            <div className="agent-card-actions">
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => onChatAgent(expert.id)}
                                                    title="Chat diretta con l'esperto"
                                                >
                                                    💬 Chat
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {filteredCore.length === 0 && filteredDirectors.length === 0 && filteredOrphans.length === 0 && (
                            <div className="sidebar-no-results">
                                Nessun agente trovato per &quot;{search}&quot;.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </aside>
    );
}
