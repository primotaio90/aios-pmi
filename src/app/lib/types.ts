// Shared client-side types — mirror the API contracts in docs/ARCHITECTURE.md §6.

export type SessionUser = {
    username: string;
    name: string;
    role: string;
    since: string;
};

export type ModelInfo = {
    id: string;
    label: string;
    context_window: number | null;
    max_output: number | null;
    tier: string | null;
    known: boolean;
};

export type AgentUsage = {
    last: Record<string, unknown>;
    total_output: number;
    max_input: number;
    calls: number;
    runs: number;
};

export type AgentMeta = {
    id: string;
    name: string;
    level: 'orchestrator' | 'pm' | 'director' | 'expert';
    department: 'core' | 'business' | 'tech' | 'delivery';
    director: string | null;
    model: string;
    model_info?: ModelInfo;
    token_budget: number;
    icon: string;
    color: string;
    mcp_whitelist: string[];
    owns_files: string[];
    keywords: string[];
    system_prompt_chars?: number;
};

export type ProviderId = 'mock' | 'anthropic' | 'openai';

export type RegistryResponse = {
    agents: AgentMeta[];
    errors: { agent?: string; error: string }[];
    runner: ProviderId;
};

export type ProjectMeta = {
    id: string;
    name: string;
    client: string;
    description: string;
    created_at: string;
    pm_enabled?: boolean;
};

export type TaskCounts = Record<string, number>;

export type DirectorOverview = {
    id: string;
    name: string;
    department: string;
    icon: string;
    color: string;
    status: 'idle' | 'working' | 'blocked' | 'review';
    progress: number | null;
    active_subagents: number;
    current_focus: string | null;
    task_counts: TaskCounts;
};

export type MacroGoal = {
    department: string;
    description: string;
    task_ids: string[];
    status: string;
};

export type ActiveGoal = {
    id: string;
    text: string;
    status: string;
    macro_goals: MacroGoal[];
    report_path: string | null;
};

export type OrchestratorOverview = {
    id: string;
    name: string;
    icon: string;
    color: string;
    status: 'idle' | 'orchestrating';
    progress: number | null;
    active_goal: ActiveGoal | null;
};

export type OverviewResponse = {
    project: ProjectMeta;
    orchestrator: OrchestratorOverview | null;
    directors: DirectorOverview[];
};

export type Goal = {
    id: string;
    text: string;
    created_by: string;
    status: string;
    macro_goals: MacroGoal[];
    report_path: string | null;
    created_at: string;
    completed_at: string | null;
    error?: string;
};

export type Task = {
    id: string;
    goal_id: string;
    title: string;
    department: string;
    assignee: string;
    created_by: string;
    status: string;
    report?: string;
    outputs?: string[];
    created_at: string;
    updated_at: string;
    history?: { ts: string; from: string; to: string; by: string }[];
};

export type ProjectFile = {
    name: string;
    path: string;
    size?: number;
};

export type Subagent = {
    id: string;
    name: string;
    icon: string;
    model: string;
    model_info?: ModelInfo;
    token_budget: number;
    mcp_whitelist: string[];
    keywords: string[];
    active: boolean;
    instance: { instance_id: string; agent: string; by: string; task?: string } | null;
    usage: AgentUsage | null;
};

export type LogEntry = Record<string, unknown> & { ts?: string };

export type DirectorDrilldown = {
    director: {
        id: string;
        name: string;
        department: string;
        icon: string;
        color: string;
        model: string;
        model_info?: ModelInfo;
        token_budget: number;
        usage: AgentUsage | null;
        owns_files: string[];
        mcp_whitelist: string[];
    };
    files: ProjectFile[];
    output_files: ProjectFile[];
    subagents: Subagent[];
    tasks: Task[];
    logs: { mcp: LogEntry[]; lifecycle: LogEntry[] };
};

export type FileContent = { path: string; content: string };

export type LogsResponse = { events?: LogEntry[]; mcp?: LogEntry[]; lifecycle?: LogEntry[] };

export type BusEvent = {
    ts: string;
    project: string;
    type: string;
    agent: string | null;
    data: unknown;
};

export type Toast = {
    id: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
    /** Approvazione associata (Fase A): se presente il toast mostra Approva/Nega. */
    approval?: { id: string; agent: string; tool: string };
};

// --- LLM settings types -------------------------------------------------------

export type MaskedKey = { set: boolean; hint: string; env: boolean };

export type LlmSettings = {
    provider: ProviderId;
    anthropic: { baseURL: string; model: string; apiKey: MaskedKey };
    openai: { baseURL: string; model: string; apiKey: MaskedKey };
    params: { temperature: number | null; maxTokens: number; thinking: boolean };
    agentModelOverrides: Record<string, string>;
};

export type ModelCatalogEntry = { label: string; context_window: number; max_output: number; tier: string };
export type ModelCatalog = Record<string, ModelCatalogEntry>;

export type McpToolSpec = { description?: string; params?: Record<string, string> };
export type McpServerCatalog = Record<
    string,
    { transport?: string; description?: string; tools: Record<string, McpToolSpec> }
>;

export type SettingsResponse = {
    settings: LlmSettings;
    catalog: ModelCatalog;
    providers: ProviderId[];
    servers: McpServerCatalog;
};

export type SettingsPatch = {
    provider?: ProviderId;
    anthropic?: { baseURL?: string; model?: string; apiKey?: string };
    openai?: { baseURL?: string; model?: string; apiKey?: string };
    params?: { temperature?: number | null; maxTokens?: number; thinking?: boolean };
    agentModelOverrides?: Record<string, string>;
};

// --- Per-agent chat / instructions / capabilities -----------------------------

export type AgentChatMessage = {
    ts: string;
    by: string;
    role: 'user' | 'agent';
    text: string;
    /** Modalità operativa attiva al momento del turno. Assente nelle voci di storico precedenti. */
    mode?: string;
};

export type AgentChatResponse = {
    reply: string;
    history: AgentChatMessage[];
};

export type AgentNote = { ts: string; text: string };

export type Capability = { qualified: string; server: string; tool: string; description: string };

export type CapabilitiesResponse = { available: Capability[]; current: string[] };

// --- Autonomia (Fase A) ------------------------------------------------------

/** Policy di autonomia di un tool: parte da solo, chiede conferma, o vietato. */
export type AutonomyPolicy = 'auto' | 'ask' | 'never';

/** Le tre liste piatte `tool[:glob]` che compongono la policy di un agente. */
export type AutonomyLists = { auto: string[]; ask: string[]; never: string[] };

export type AutonomyResponse = {
    available: Capability[];
    /** Liste di default dell'agente (frontmatter). */
    current: AutonomyLists;
    /** Override per-tenant effettivo (state/autonomy.json), quando richiesto. */
    project: AutonomyLists | null;
};

/** Richiesta di approvazione in coda per una chiamata `ask`. */
export type Approval = {
    id: string;
    ts: string;
    agent: string;
    tool: string;
    payload: Record<string, unknown>;
    mode: string | null;
    status: 'pending' | 'approved' | 'denied' | 'timeout';
    decided_by: string | null;
    decided_at: string | null;
};

// --- Project Manager (Fase 2) types -------------------------------------------

export type PMAgent = {
    id: string;
    name: string;
    icon: string;
    color: string;
};

export type PMKpis = {
    goals_total: number;
    goals_completed: number;
    tasks_total: number;
    tasks_done: number;
    tasks_blocked: number;
    tasks_review: number;
    progress: number | null;
};

export type ChecklistItem = {
    item_id: string;
    label: string;
    kind: 'file' | 'task' | 'delivery';
    source: string;
    checked: boolean;
};

export type PMTaskRef = {
    id: string;
    title: string;
    department: string;
    assignee: string;
};

export type PMNotification = {
    id: string;
    ts: string;
    to: string;
    subject: string;
    body: string;
    level: 'info' | 'warn' | 'error' | 'success';
    task_id: string | null;
    goal_id: string | null;
    transport: string;
};

export type PMActiveGoal = {
    id: string;
    text: string;
    status: string;
    report_path: string | null;
};

export type PMOverview = {
    project: ProjectMeta;
    active_goal: PMActiveGoal | null;
    kpis: PMKpis;
    checklist: ChecklistItem[];
    blocked_tasks: PMTaskRef[];
    review_tasks: PMTaskRef[];
    notifications: PMNotification[];
    pm: PMAgent | null;
};

export type PMChatMessage = {
    ts: string;
    by: string;
    role: 'user' | 'pm';
    text: string;
};

export type PMSuggestion = {
    kind: 'review' | 'blocked' | 'ok';
    task_id?: string;
    text: string;
};

export type PMChatResponse = {
    reply: string;
    history: PMChatMessage[];
};

export type PMChecklistToggle = {
    item_id: string;
    checked: boolean;
};

// --- Modalità operative dell'orchestratore -----------------------------------

export type ModeId = 'orchestrator' | 'architect' | 'code' | 'ask' | 'debug';

export type OperatingMode = {
    id: ModeId;
    label: string;
    icon: string;
    color: string;
    tagline: string;
    description: string;
    orchestrates: boolean;
    tools: string[] | null;
    allow_writes: boolean;
    placeholder: string;
    cta: string;
};

// --- Consegna ----------------------------------------------------------------

export type DeliveryItem = {
    id: string;
    title: string;
    kind: 'report' | 'output' | 'knowledge';
    status: 'ready' | 'partial';
    path: string | null;
    department: string | null;
    source: string | null;
    updated_at: string | null;
    size: number | null;
    note: string | null;
};

export type DeliveryGap = { id: string; label: string; reason: string; task_id: string | null; department: string | null };

export type DeliveryGoal = { id: string; text: string; status: string; report_path: string | null; ready: boolean };

export type DeliveryFile = { path: string; name: string; size: number; mtime: string };

export type DeliverySnapshot = {
    project: ProjectMeta;
    generated_at: string;
    readiness: { score: number | null; ready: number; partial: number; missing: number };
    items: DeliveryItem[];
    gaps: DeliveryGap[];
    goals: DeliveryGoal[];
    previous: DeliveryFile[];
};

export type DeliveryResult = { path: string; content: string };
