'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, useEventStream } from './lib/api';
import type { AgentMeta, BusEvent, ModeId, OperatingMode, OverviewResponse, ProjectMeta, SessionUser, Toast } from './lib/types';
import { Login } from './components/Login';
import { Topbar } from './components/Topbar';
import { HomeGrid } from './components/HomeGrid';
import { DirectorPanel } from './components/DirectorPanel';
import { GoalComposer } from './components/GoalComposer';
import { PMConsole } from './components/PMConsole';
import { SettingsPanel } from './components/SettingsPanel';
import { AgentChat } from './components/AgentChat';
import { DeliveryPanel } from './components/DeliveryPanel';
import { AgentsSidebar } from './components/AgentsSidebar';
import { ToastStack } from './components/Toast';
import { initials } from './lib/text';

export default function Dashboard() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [openDirector, setOpenDirector] = useState<string | null>(null);
  const [openPM, setOpenPM] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [openDelivery, setOpenDelivery] = useState(false);
  const [chatAgent, setChatAgent] = useState<string | null>(null);
  const [orchestrating, setOrchestrating] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Operating modes: static catalogue + the orchestrator's own whitelist (to mark
  // the tools a mode declares but the agent has not been granted).
  const [modes, setModes] = useState<OperatingMode[]>([]);
  const [mode, setMode] = useState<ModeId>('orchestrator');
  // undefined = whitelist unknown (still loading / fetch failed): ModeSelector
  // then marks nothing. An empty [] would wrongly mean "the agent has no tools".
  const [orchestratorTools, setOrchestratorTools] = useState<string[] | undefined>(undefined);
  const [allAgents, setAllAgents] = useState<AgentMeta[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const current = projects.find((p) => p.id === projectId) ?? null;
  const { events, connected } = useEventStream(projectId);
  const seenEventRef = useRef<Set<string>>(new Set());

  // --- bootstrap session + projects --------------------------------------
  useEffect(() => {
    api.me()
      .then((u) => setUser(u))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    api.projects()
      .then((ps) => {
        setProjects(ps);
        if (ps.length > 0) setProjectId((cur) => cur ?? ps[0].id);
      })
      .catch(() => setProjects([]));
  }, [user]);

  // --- operating modes catalogue & agent registry (once per session) ------
  useEffect(() => {
    if (!user) return;
    api.modes()
      .then((ms) => setModes(ms))
      .catch(() => setModes([]));
    api.agents()
      .then((reg) => {
        setAllAgents(reg.agents || []);
        setOrchestratorTools(reg.agents.find((a) => a.level === 'orchestrator')?.mcp_whitelist);
      })
      .catch(() => setOrchestratorTools(undefined));
  }, [user]);

  // --- overview loading + refresh ----------------------------------------
  const reloadOverview = useCallback(async () => {
    if (!projectId) {
      setOverview(null);
      return;
    }
    try {
      const ov = await api.overview(projectId);
      setOverview(ov);
      setOverviewError(null);
    } catch (err) {
      setOverview(null);
      setOverviewError(err instanceof ApiError ? err.message : 'Caricamento overview fallito');
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadOverview();
  }, [projectId, reloadOverview]);

  // --- SSE → toasts + live refresh ---------------------------------------
  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...t, id }].slice(-5));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 6000);
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!projectId || events.length === 0) return;
    const evt = events[events.length - 1];
    const key = `${evt.ts}-${evt.type}-${evt.agent ?? ''}`;
    if (seenEventRef.current.has(key)) return;
    seenEventRef.current.add(key);
    if (seenEventRef.current.size > 500) seenEventRef.current = new Set([...seenEventRef.current].slice(-300));

    const data = (evt.data ?? {}) as {
      level?: string;
      message?: string;
      goal_id?: string;
      to?: string;
      status?: string;
    };

    if (evt.type === 'notify' && data.message) {
      pushToast({ level: (data.level as Toast['level']) || 'info', message: data.message });
    }
    if (evt.type === 'goal.completed' || evt.type === 'goal.failed') {
      pushToast({
        level: evt.type === 'goal.completed' ? 'success' : 'error',
        message: data.goal_id ? `Goal ${data.goal_id}: ${evt.type === 'goal.completed' ? 'completato' : 'fallito'}` : evt.type,
      });
      setOrchestrating(false);
    }
    if (evt.type === 'task.status' && data.status === 'blocked') {
      pushToast({ level: 'warn', message: `Task bloccato (${evt.agent ?? '—'})` });
    }
    // Lightweight refresh on any meaningful mutation event.
    if (
      [
        'goal.created',
        'goal.decomposed',
        'goal.completed',
        'goal.failed',
        'task.created',
        'task.status',
        'file.updated',
        'agent.spawned',
        'agent.teardown',
        'delivery.produced',
      ].includes(evt.type)
    ) {
      const t = setTimeout(reloadOverview, 250);
      return () => clearTimeout(t);
    }
  }, [events, projectId, pushToast, reloadOverview]);

  // --- actions -----------------------------------------------------------
  const handleLogin = (u: SessionUser) => setUser(u);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setProjects([]);
    setProjectId(null);
    setOverview(null);
    setOpenDirector(null);
    setOpenPM(false);
    setOpenSettings(false);
    setOpenDelivery(false);
    setChatAgent(null);
  };

  const openChat = useCallback((id: string) => {
    setOpenDirector(null);
    setOpenPM(false);
    setOpenSettings(false);
    setOpenDelivery(false);
    setChatAgent(id);
  }, []);

  const openDeliveryPanel = useCallback(() => {
    setOpenDirector(null);
    setOpenPM(false);
    setOpenSettings(false);
    setChatAgent(null);
    setOpenDelivery(true);
  }, []);

  const handleCreateProject = async (input: { name: string; client?: string; description?: string }) => {
    const p = await api.createProject(input);
    setProjects((prev) => [...prev, p]);
    setProjectId(p.id);
  };

  const handleSubmitGoal = async (text: string) => {
    if (!projectId) return;
    setOrchestrating(true);
    try {
      await api.submitGoal(projectId, text);
      pushToast({ level: 'info', message: 'Obiettivo inviato all\'Orchestratore' });
      await reloadOverview();
    } catch (err) {
      setOrchestrating(false);
      pushToast({ level: 'error', message: err instanceof ApiError ? err.message : 'Invio fallito' });
    }
  };

  /** Non-orchestrating modes: one-shot question to the orchestrator, no goal created. */
  const handleAskMode = async (text: string, modeId: ModeId): Promise<string> => {
    const agentId = overview?.orchestrator?.id;
    if (!projectId || !agentId) throw new Error('Orchestratore non disponibile');
    const { reply } = await api.agentChat(projectId, agentId, text, modeId);
    return reply;
  };

  // --- render ------------------------------------------------------------
  if (user === undefined) {
    return <div className="boot">Caricamento AIOS…</div>;
  }
  if (user === null) {
    return <Login onLogin={handleLogin} />;
  }

  const orchestratorId = overview?.orchestrator?.id ?? null;
  const isOrchestrator = openDirector && overview?.orchestrator && openDirector === overview.orchestrator.id;
  const isDirector =
    openDirector && overview?.directors.some((d) => d.id === openDirector);

  return (
    <div className="dashboard-shell">
      <Topbar
        user={user}
        projects={projects}
        current={current}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        agentsCount={allAgents.length}
        onSelect={(id) => {
          setProjectId(id);
          setOpenDirector(null);
          setOpenPM(false);
          setOpenSettings(false);
          setOpenDelivery(false);
          setChatAgent(null);
        }}
        onCreate={handleCreateProject}
        connected={connected}
        deliveryEnabled={Boolean(projectId)}
        onOpenDelivery={openDeliveryPanel}
        pmEnabled={Boolean(current?.pm_enabled)}
        onOpenPM={() => {
          setOpenDirector(null);
          setOpenSettings(false);
          setOpenDelivery(false);
          setChatAgent(null);
          setOpenPM(true);
        }}
        onOpenSettings={() => {
          setOpenDirector(null);
          setOpenPM(false);
          setOpenDelivery(false);
          setChatAgent(null);
          setOpenSettings(true);
        }}
        onLogout={handleLogout}
      />

      <div className="dashboard-body">
        <AgentsSidebar
          agents={allAgents}
          overview={overview}
          collapsed={!sidebarOpen}
          onToggleCollapse={() => setSidebarOpen((v) => !v)}
          onOpenDirector={(id) => {
            setOpenDirector(id);
            setOpenPM(false);
            setOpenSettings(false);
            setOpenDelivery(false);
            setChatAgent(null);
          }}
          onChatAgent={openChat}
          activeAgentId={chatAgent || openDirector}
        />

        <main className="dashboard-main">
          {openSettings ? (
            <SettingsPanel onBack={() => setOpenSettings(false)} pushToast={pushToast} />
          ) : openDelivery && projectId ? (
            <DeliveryPanel project={projectId} onBack={() => setOpenDelivery(false)} pushToast={pushToast} />
          ) : chatAgent && projectId ? (
            <AgentChat
              project={projectId}
              agentId={chatAgent}
              onBack={() => setChatAgent(null)}
              pushToast={pushToast}
              modes={modes}
            />
          ) : (
            <>
          {!projectId && (
            <div className="glass empty-state">
              <h2>Benvenuto, {user.name.split(' ')[0]}</h2>
              <p>Nessun progetto cliente presente. Crea il primo tenant dal pulsante + Nuovo in alto.</p>
            </div>
          )}

          {projectId && overviewError && (
            <div className="glass panel-state login-error">{overviewError}</div>
          )}

          {projectId && !overview && !overviewError && (
            <div className="glass panel-state">Caricamento progetto…</div>
          )}

          {projectId && overview && !openDirector && !openPM && (
            <div className="home-wrap">
              <GoalComposer
                busy={orchestrating}
                onSubmit={handleSubmitGoal}
                modes={modes}
                mode={mode}
                onModeChange={setMode}
                orchestratorTools={orchestratorTools}
                onAskMode={handleAskMode}
                onOpenChat={orchestratorId ? () => openChat(orchestratorId) : undefined}
              />
              <HomeGrid
                project={overview.project}
                orchestrator={overview.orchestrator}
                directors={overview.directors}
                onOpenDirector={(id) => setOpenDirector(id)}
                onChatAgent={openChat}
              />
            </div>
          )}

          {projectId && openDirector && isOrchestrator && overview?.orchestrator && (
            <OrchestratorPanel
              overview={overview}
              events={events}
              onBack={() => setOpenDirector(null)}
              onOpenDirector={(id) => setOpenDirector(id)}
              onChatAgent={openChat}
              onOpenDelivery={openDeliveryPanel}
            />
          )}

          {projectId && openDirector && isDirector && (
            <DirectorPanel
              project={projectId}
              directorId={openDirector}
              events={events}
              onBack={() => setOpenDirector(null)}
              onChatAgent={openChat}
            />
          )}

          {projectId && openPM && (
            <PMConsole project={projectId} events={events} onBack={() => setOpenPM(false)} />
          )}

          {projectId && openDirector && !isOrchestrator && !isDirector && (
            <div className="glass panel-state login-error">Agente non valido come drill-down.</div>
          )}
            </>
          )}
        </main>
      </div>

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
    </div>
  );
}

/** Compact, read-only orchestrator view: macro-goal timeline + recent events. */
function OrchestratorPanel({
  overview,
  events,
  onBack,
  onOpenDirector,
  onChatAgent,
  onOpenDelivery,
}: {
  overview: OverviewResponse;
  events: BusEvent[];
  onBack: () => void;
  onOpenDirector: (id: string) => void;
  onChatAgent: (id: string) => void;
  onOpenDelivery: () => void;
}) {
  const o = overview.orchestrator!;
  const goal = o.active_goal;
  return (
    <section className="director-panel">
      <div className="header-actions">
        <div>
          <button className="btn btn-secondary panel-back" onClick={onBack}>
            ← Home
          </button>
          <h1 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="panel-icon">{initials(o.name)}</span>
            {o.name}
            <span className={`status-badge status-${o.status}`}>{o.status}</span>
          </h1>
          <div className="title-desc">Livello strategico · scomposizione e aggregazione report</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => onChatAgent(o.id)}>
            💬 Chat
          </button>
          <button className="btn btn-primary" onClick={onOpenDelivery} title="Cosa possiamo già consegnare al cliente">
            📦 Consegna
          </button>
        </div>
      </div>

      <div className="panel-grid panel-grid-1">
        <div className="glass panel-block">
          <div className="card-header">
            <h3 className="card-title">Obiettivo attivo</h3>
          </div>
          <div className="card-body">
            {goal ? (
              <>
                <div className="home-goal-id">{goal.id}</div>
                <div className="home-goal-text">{goal.text}</div>
                <ul className="macro-timeline macro-timeline-clickable">
                  {goal.macro_goals.map((m) => {
                    const dir = overview.directors.find((d) => d.department === m.department);
                    return (
                      <li
                        key={m.department}
                        className={`macro-item macro-${m.status}`}
                        onClick={() => dir && onOpenDirector(dir.id)}
                        role={dir ? 'button' : undefined}
                        tabIndex={dir ? 0 : undefined}
                        onKeyDown={(e) => {
                          if (dir && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            onOpenDirector(dir.id);
                          }
                        }}
                      >
                        <span className="macro-dept">{m.department}</span>
                        <span className="macro-desc">{m.description}</span>
                        <span className="macro-status">{m.status}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className="home-empty">Nessun obiettivo attivo.</div>
            )}
          </div>
        </div>
      </div>

      <EventTicker events={events} />
    </section>
  );
}

/** Live tail of the last bus events (debug/observability). */
function EventTicker({ events }: { events: BusEvent[] }) {
  const tail = events.slice(-25).reverse();
  return (
    <div className="glass event-ticker">
      <div className="card-header">
        <h3 className="card-title">Event bus (ultimi {tail.length})</h3>
      </div>
      <div className="card-body">
        {tail.length === 0 ? (
          <div className="home-empty">In attesa di eventi…</div>
        ) : (
          <ul className="log-list">
            {tail.map((e, i) => (
              <li key={i} className="ticker-line">
                <span className="log-ts">{e.ts.slice(11, 19)}</span>
                <span className="log-agent">{e.agent ?? '—'}</span>
                <span className="log-tool">{e.type}</span>
                <span className="log-preview">{summarize(e)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function summarize(e: BusEvent): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  if (typeof d.message === 'string') return d.message;
  if (typeof d.goal_id === 'string') return `goal ${d.goal_id}`;
  if (typeof d.task_id === 'string') return `task ${d.task_id}`;
  return JSON.stringify(d).slice(0, 90);
}