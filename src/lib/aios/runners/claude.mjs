/**
 * LLM runner: same interface as the mock runner, backed by a real provider
 * (Anthropic-protocol or OpenAI-compatible). Selected/configured at RUNTIME from
 * the dashboard settings (src/lib/aios/settings.mjs) — provider, base URL, API
 * key, model and generation params are read per call, so changes in the UI take
 * effect without a restart. Env (ANTHROPIC_API_KEY / OPENAI_API_KEY) is fallback.
 *
 * - Each agent runs with its resolved model (per-agent override → provider
 *   default → frontmatter model; see modelFor()).
 * - Experts run a manual tool loop: their mcp_whitelist is converted to the
 *   provider's tool format and every tool call goes through the MCP gateway, so
 *   whitelist enforcement and audit logging are identical to mock mode.
 * - token_budget caps the cumulative output tokens of an expert's loop.
 */
import { getSettings, providerConfig, modelFor } from '../settings.mjs';
import { getLLMClient } from '../llm/index.mjs';

/** Builds the concrete provider client for the current settings. */
function clientFor(settings) {
  return getLLMClient(providerConfig(settings));
}

export function createRunner({ registry, gateway, reportUsage = () => {} }) {
  return {
    async decompose(project, goal, directors) {
      const settings = await getSettings();
      const client = clientFor(settings);
      const orchestrator = registry.orchestrator();
      const brief = await gateway.call(project, orchestrator.id, 'filesystem.fs_read', { path: 'brief.md' });
      const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['macro_goals'],
        properties: {
          macro_goals: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['department', 'description'],
              properties: {
                department: { type: 'string', enum: directors.map((d) => d.department) },
                description: { type: 'string' },
              },
            },
          },
        },
      };
      const { value, usage } = await client.completeJSON({
        model: modelFor(orchestrator, settings),
        system: orchestrator.system_prompt,
        prompt: [
          `Obiettivo dei consulenti: ${goal}`,
          '',
          `Brief del cliente:\n${brief.ok ? brief.result.content : '(brief non disponibile)'}`,
          '',
          `Scomponi l'obiettivo in esattamente un macro-obiettivo per ciascun dipartimento: ${directors
            .map((d) => `${d.department} (${d.name})`)
            .join(', ')}. Ogni descrizione deve essere operativa e specifica per il cliente.`,
        ].join('\n'),
        schema,
        params: settings.params,
      });
      reportUsage(project, orchestrator.id, usage, { phase: 'decompose' });
      return value.macro_goals;
    },

    async plan(project, director, macroGoal, experts) {
      const settings = await getSettings();
      const client = clientFor(settings);
      const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['assignments'],
        properties: {
          assignments: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['expertId', 'title'],
              properties: {
                expertId: { type: 'string', enum: experts.map((e) => e.id) },
                title: { type: 'string' },
              },
            },
          },
        },
      };
      const { value, usage } = await client.completeJSON({
        model: modelFor(director, settings),
        system: director.system_prompt,
        prompt: [
          `Macro-obiettivo assegnato dall'Orchestratore: ${macroGoal.description}`,
          '',
          'Sub-agenti disponibili nel tuo dipartimento:',
          ...experts.map((e) => `- ${e.id}: ${e.name} — keywords: ${e.keywords.join(', ')}`),
          '',
          'Scegli SOLO i sub-agenti realmente necessari (token efficiency) e assegna a ciascuno un task con titolo operativo in italiano.',
        ].join('\n'),
        schema,
        params: settings.params,
      });
      reportUsage(project, director.id, usage, { phase: 'plan' });
      return value.assignments;
    },

    async runExpert(project, expert, task, goal, tools) {
      const settings = await getSettings();
      const client = clientFor(settings);
      const toolSpecs = expert.mcp_whitelist.map((qualified) => ({
        qualified,
        ...(gateway.toolSpec(qualified) || { description: qualified, params: {} }),
      }));
      const outputs = [];
      const callTool = async (qualified, input) => {
        const res = await tools.call(qualified, input);
        if (qualified === 'filesystem.fs_write' && res.ok && input?.path) outputs.push(input.path);
        return res;
      };
      const { text, usage } = await client.runToolLoop({
        model: modelFor(expert, settings),
        system: expert.system_prompt,
        userText: [
          `Task ${task.id}: ${task.title}`,
          `Obiettivo generale: ${goal}`,
          '',
          'Esegui il task usando i tool disponibili (sono gli unici autorizzati per te).',
          `Scrivi il tuo deliverable in outputs/${task.id}_${expert.id}.md con filesystem__fs_write.`,
          'Al termine rispondi con una sintesi finale di 2-4 frasi per il tuo Direttore.',
        ].join('\n'),
        toolSpecs,
        params: settings.params,
        tokenBudget: expert.token_budget,
        maxIters: 8,
        callTool,
      });
      reportUsage(project, expert.id, usage, { phase: 'expert', task: task.id });
      return { summary: text.trim() || `${expert.name}: task completato.`, outputs };
    },

    async synthesize(project, director, macroGoal, expertReports) {
      const settings = await getSettings();
      const client = clientFor(settings);
      const { text, usage } = await client.completeText({
        model: modelFor(director, settings),
        system: director.system_prompt,
        prompt: [
          `Macro-obiettivo: ${macroGoal.description}`,
          '',
          'Report dei tuoi sub-agenti:',
          ...expertReports.map((r) => `- ${r.expert_name} (${r.task_id}): ${r.summary}`),
          '',
          "Sintetizza per l'Orchestratore in max 10 righe markdown: risultati, decisioni, rischi.",
        ].join('\n'),
        params: settings.params,
      });
      reportUsage(project, director.id, usage, { phase: 'synthesize' });
      return text;
    },

    async aggregate(project, goal, directorReports) {
      const settings = await getSettings();
      const client = clientFor(settings);
      const orchestrator = registry.orchestrator();
      const { text, usage } = await client.completeText({
        model: modelFor(orchestrator, settings),
        system: orchestrator.system_prompt,
        prompt: [
          `Obiettivo: ${goal.text}`,
          '',
          'Sintesi dei tre Direttori:',
          ...directorReports.map((r) => `## ${r.director_name} (${r.department})\n${r.synthesis}`),
          '',
          'Scrivi il report finale in markdown per i consulenti umani: executive summary, sezione per dipartimento, prossimi passi.',
        ].join('\n'),
        params: settings.params,
      });
      reportUsage(project, orchestrator.id, usage, { phase: 'aggregate' });
      return text;
    },
  };
}
