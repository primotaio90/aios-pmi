import { requireUser, unauthorized } from '@/lib/apiAuth';

type ModelInfo = {
  id: string;
  label: string;
  context_window: number | null;
  max_output: number | null;
  tier: string | null;
  known: boolean;
};

type Agent = {
  id: string;
  name: string;
  level: string;
  department: string;
  director: string | null;
  model: string;
  model_info: ModelInfo;
  token_budget: number;
  icon: string;
  color: string;
  mcp_whitelist: string[];
  owns_files: string[];
  keywords: string[];
};

type LlmUsageRow = {
  ts?: string;
  agent?: string;
  input_tokens?: number;
  output_tokens?: number;
  token_budget?: number | null;
  context_window?: number | null;
  pct_budget?: number | null;
  pct_context?: number | null;
  calls?: number;
  simulated?: boolean;
};

/** Aggregates per-agent LLM usage from logs/llm_calls.jsonl. */
function aggregateUsage(rows: LlmUsageRow[]) {
  const byAgent: Record<
    string,
    { last: LlmUsageRow; total_output: number; max_input: number; calls: number; runs: number }
  > = {};
  for (const r of rows) {
    if (!r.agent) continue;
    const acc = byAgent[r.agent] || { last: r, total_output: 0, max_input: 0, calls: 0, runs: 0 };
    acc.last = r;
    acc.total_output += r.output_tokens || 0;
    acc.max_input = Math.max(acc.max_input, r.input_tokens || 0);
    acc.calls += r.calls || 1;
    acc.runs += 1;
    byAgent[r.agent] = acc;
  }
  return byAgent;
}

/**
 * Drill-down view (progressive disclosure, level 2): the director's .md folder,
 * its sub-agents (available + currently active instances) and the recent
 * MCP/lifecycle logs of the whole department.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ project: string; director: string }> }
) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const { project, director: directorId } = await params;

  const director: Agent | null = sys.registry.get(directorId);
  if (!director || director.level !== 'director') {
    return Response.json({ error: `Direttore ${directorId} inesistente` }, { status: 404 });
  }

  try {
    await sys.store.readProject(project);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }

  const experts: Agent[] = sys.registry.expertsOf(directorId);
  const activeInstances = sys.lifecycle
    .active(project)
    .filter((i: { by: string }) => i.by === directorId);
  const departmentAgents = [directorId, ...experts.map((e) => e.id)];

  const [files, outputFiles, tasks, mcpLogs, lifecycleLogs, llmLogs] = await Promise.all([
    sys.store.listFiles(project, director.department),
    sys.store.listFiles(project, 'outputs'),
    sys.tasks.list(project, { department: director.department }),
    sys.store.readLog(project, 'mcp_calls', { agents: departmentAgents, limit: 80 }),
    sys.store.readLog(project, 'lifecycle', { agents: experts.map((e) => e.id), limit: 40 }),
    sys.store.readLog(project, 'llm_calls', { agents: departmentAgents, limit: 200 }),
  ]);
  const usageByAgent = aggregateUsage(llmLogs as LlmUsageRow[]);

  return Response.json({
    director: {
      id: director.id,
      name: director.name,
      department: director.department,
      icon: director.icon,
      color: director.color,
      model: director.model,
      model_info: director.model_info,
      token_budget: director.token_budget,
      usage: usageByAgent[director.id] || null,
      owns_files: director.owns_files,
      mcp_whitelist: director.mcp_whitelist,
    },
    files,
    output_files: outputFiles.filter((f: { name: string }) =>
      tasks.some((t: { id: string }) => f.name.startsWith(t.id))
    ),
    subagents: experts.map((e) => {
      const instance = activeInstances.find((i: { agent: string }) => i.agent === e.id);
      return {
        id: e.id,
        name: e.name,
        icon: e.icon,
        model: e.model,
        model_info: e.model_info,
        token_budget: e.token_budget,
        mcp_whitelist: e.mcp_whitelist,
        keywords: e.keywords,
        active: Boolean(instance),
        instance: instance || null,
        usage: usageByAgent[e.id] || null,
      };
    }),
    tasks,
    logs: { mcp: mcpLogs, lifecycle: lifecycleLogs },
  });
}
