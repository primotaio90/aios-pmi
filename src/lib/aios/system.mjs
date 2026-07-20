import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from './bus.mjs';
import { Store } from './store.mjs';
import { Registry } from './registry.mjs';
import { TaskManager } from './tasks.mjs';
import { McpGateway } from './gateway.mjs';
import { Lifecycle } from './lifecycle.mjs';
import { Engine } from './engine.mjs';
import { ProjectManager } from './pm.mjs';
import { Auth } from './auth.mjs';
import { createRunner as createMockRunner } from './runners/mock.mjs';
import { createRunner as createClaudeRunner } from './runners/claude.mjs';

// Repo root, independent of process.cwd(): src/lib/aios/ -> ../../..
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * System singleton. Stored on globalThis so Next.js HMR and every route
 * handler share the same bus, sessions and lifecycle state.
 * AIOS_RUNNER=mock (default) | claude (requires ANTHROPIC_API_KEY).
 */
async function build() {
  const bus = new Bus();
  const store = new Store(path.join(ROOT, 'projects'));
  const tasks = new TaskManager(store, bus);
  const gateway = new McpGateway(path.join(ROOT, 'mcp', 'servers.json'), store, bus, tasks);
  await gateway.load();

  const registry = new Registry(path.join(ROOT, 'agents'), bus, { gateway });
  gateway.registry = registry;
  await registry.load();
  registry.watch();

  const lifecycle = new Lifecycle(registry, bus);
  const runnerMode = process.env.AIOS_RUNNER === 'claude' ? 'claude' : 'mock';

  // Fraction of an agent's token_budget (output) or model context window (input)
  // beyond which a warning notification is raised.
  const BUDGET_WARN = 0.8;
  const CONTEXT_WARN = 0.7;

  /**
   * Records the token usage of a single LLM call and surfaces it to the UI.
   * Called by both runners after each model interaction; in mock mode `usage`
   * is simulated (and marked so). Emits `llm.usage` (persisted to
   * logs/llm_calls.jsonl) and a `notify` warning past the thresholds above.
   */
  const reportUsage = (project, agentId, usage, meta = {}) => {
    const agent = registry.get(agentId);
    const model = agent?.model || 'unknown';
    const contextWindow = agent?.model_info?.context_window ?? null;
    const budget = agent?.token_budget ?? null;
    const input = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;
    const pctBudget = budget ? Math.round((output / budget) * 100) : null;
    const pctContext = contextWindow ? Math.round((input / contextWindow) * 100) : null;

    bus.emitEvent(
      project,
      'llm.usage',
      {
        agent: agentId,
        model,
        phase: meta.phase || 'run',
        task: meta.task || null,
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        calls: usage.calls || 1,
        token_budget: budget,
        context_window: contextWindow,
        pct_budget: pctBudget,
        pct_context: pctContext,
        simulated: Boolean(usage.simulated),
      },
      agentId
    );

    if (budget && output >= budget * BUDGET_WARN) {
      bus.emitEvent(project, 'notify', {
        level: 'warn',
        message: `${agent?.name || agentId} ha usato ${output} token in output (${pctBudget}% del budget ${budget}).`,
      });
    }
    if (contextWindow && input >= contextWindow * CONTEXT_WARN) {
      bus.emitEvent(project, 'notify', {
        level: 'warn',
        message: `${agent?.name || agentId}: contesto al ${pctContext}% della finestra di ${model}.`,
      });
    }
  };

  const deps = { registry, store, gateway, tasks, reportUsage };
  const runner = runnerMode === 'claude' ? createClaudeRunner(deps) : createMockRunner(deps);
  const engine = new Engine({ registry, store, bus, tasks, gateway, lifecycle, runner });
  const pm = new ProjectManager({ registry, store, bus, tasks, engine });
  pm.start(); // subscribe to goal.*/task.* and emit pm.* notifications
  const auth = new Auth(path.join(ROOT, 'config', 'users.json'));

  // Persistence wiring: single writer for every audit log (no double logging).
  bus.subscribe((evt) => {
    if (!evt.project || evt.project === '*') return;
    const persist = async () => {
      await store.appendLog(evt.project, 'events', evt);
      if (evt.type === 'mcp.call') {
        await store.appendLog(evt.project, 'mcp_calls', { ...evt.data });
      } else if (evt.type === 'agent.spawned' || evt.type === 'agent.teardown') {
        await store.appendLog(evt.project, 'lifecycle', { ts: evt.ts, agent: evt.agent, ...evt.data });
      } else if (evt.type === 'llm.usage') {
        await store.appendLog(evt.project, 'llm_calls', { ts: evt.ts, ...evt.data });
      }
    };
    persist().catch((err) => console.error('[aios] persistenza log fallita:', err.message));
  });

  return { root: ROOT, runnerMode, bus, store, registry, tasks, gateway, lifecycle, engine, pm, auth };
}

export function getSystem() {
  if (!globalThis.__AIOS__) {
    globalThis.__AIOS__ = build();
  }
  return globalThis.__AIOS__;
}
