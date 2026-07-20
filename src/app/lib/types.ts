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
    level: 'orchestrator' | 'director' | 'expert';
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

export type RegistryResponse = {
    agents: AgentMeta[];
    errors: { agent?: string; error: string }[];
    runner: 'mock' | 'claude';
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
