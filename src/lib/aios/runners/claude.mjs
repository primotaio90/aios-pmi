/**
 * Claude runner: same interface as the mock runner, backed by the Claude API
 * (@anthropic-ai/sdk). Enable with AIOS_RUNNER=claude and ANTHROPIC_API_KEY.
 *
 * - Each agent runs with the model declared in its frontmatter (default claude-opus-4-8).
 * - Experts run a manual tool loop: their mcp_whitelist is converted to Anthropic
 *   tool definitions and every tool_use is executed through the MCP gateway, so
 *   whitelist enforcement and audit logging are identical to mock mode.
 * - token_budget caps the cumulative output tokens of an expert's loop.
 */

let AnthropicCtor = null;
async function getClient() {
  if (!AnthropicCtor) {
    ({ default: AnthropicCtor } = await import('@anthropic-ai/sdk'));
  }
  return new AnthropicCtor();
}

const JSON_TYPES = { string: 'string', number: 'number', list: 'array', object: 'object' };

function toolDefinitions(gateway, whitelist) {
  return whitelist.map((qualified) => {
    const spec = gateway.toolSpec(qualified) || { description: qualified, params: {} };
    const properties = {};
    for (const [key, type] of Object.entries(spec.params || {})) {
      const base = String(type).split('|')[0].trim();
      properties[key] =
        base === 'list'
          ? { type: 'array', items: { type: 'string' } }
          : { type: JSON_TYPES[base] || 'string', description: String(type) };
    }
    return {
      // Anthropic tool names cannot contain dots.
      name: qualified.replace('.', '__'),
      description: spec.description || qualified,
      input_schema: { type: 'object', properties, required: Object.keys(properties) },
    };
  });
}

function usageOf(response) {
  const u = response.usage || {};
  return {
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_read_input_tokens: u.cache_read_input_tokens || 0,
    calls: 1,
  };
}

async function completeJSON(client, agent, prompt, schema) {
  const response = await client.messages.create({
    model: agent.model,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: agent.system_prompt,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  });
  const text = response.content.find((b) => b.type === 'text')?.text || '{}';
  return { value: JSON.parse(text), usage: usageOf(response) };
}

async function completeText(client, agent, prompt) {
  const response = await client.messages.create({
    model: agent.model,
    max_tokens: 8192,
    thinking: { type: 'adaptive' },
    system: agent.system_prompt,
    messages: [{ role: 'user', content: prompt }],
  });
  return { text: response.content.find((b) => b.type === 'text')?.text || '', usage: usageOf(response) };
}

export function createRunner({ registry, gateway, reportUsage = () => {} }) {
  return {
    async decompose(project, goal, directors) {
      const client = await getClient();
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
      const { value, usage } = await completeJSON(
        client,
        orchestrator,
        [
          `Obiettivo dei consulenti: ${goal}`,
          '',
          `Brief del cliente:\n${brief.ok ? brief.result.content : '(brief non disponibile)'}`,
          '',
          `Scomponi l'obiettivo in esattamente un macro-obiettivo per ciascun dipartimento: ${directors
            .map((d) => `${d.department} (${d.name})`)
            .join(', ')}. Ogni descrizione deve essere operativa e specifica per il cliente.`,
        ].join('\n'),
        schema
      );
      reportUsage(project, orchestrator.id, usage, { phase: 'decompose' });
      return value.macro_goals;
    },

    async plan(project, director, macroGoal, experts) {
      const client = await getClient();
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
      const { value, usage } = await completeJSON(
        client,
        director,
        [
          `Macro-obiettivo assegnato dall'Orchestratore: ${macroGoal.description}`,
          '',
          'Sub-agenti disponibili nel tuo dipartimento:',
          ...experts.map((e) => `- ${e.id}: ${e.name} — keywords: ${e.keywords.join(', ')}`),
          '',
          'Scegli SOLO i sub-agenti realmente necessari (token efficiency) e assegna a ciascuno un task con titolo operativo in italiano.',
        ].join('\n'),
        schema
      );
      reportUsage(project, director.id, usage, { phase: 'plan' });
      return value.assignments;
    },

    async runExpert(project, expert, task, goal, tools) {
      const client = await getClient();
      const definitions = toolDefinitions(gateway, expert.mcp_whitelist);
      const outputs = [];
      const messages = [
        {
          role: 'user',
          content: [
            `Task ${task.id}: ${task.title}`,
            `Obiettivo generale: ${goal}`,
            '',
            'Esegui il task usando i tool disponibili (sono gli unici autorizzati per te).',
            `Scrivi il tuo deliverable in outputs/${task.id}_${expert.id}.md con filesystem__fs_write.`,
            'Al termine rispondi con una sintesi finale di 2-4 frasi per il tuo Direttore.',
          ].join('\n'),
        },
      ];

      let spentOut = 0;
      let lastInput = 0;
      let cacheRead = 0;
      let calls = 0;
      let finalText = '';
      for (let i = 0; i < 8; i++) {
        const response = await client.messages.create({
          model: expert.model,
          max_tokens: 4096,
          thinking: { type: 'adaptive' },
          system: expert.system_prompt,
          tools: definitions,
          messages,
        });
        calls += 1;
        spentOut += response.usage.output_tokens || 0;
        lastInput = response.usage.input_tokens || 0; // full context of the last turn
        cacheRead += response.usage.cache_read_input_tokens || 0;
        finalText = response.content.find((b) => b.type === 'text')?.text || finalText;

        if (response.stop_reason !== 'tool_use' || spentOut >= expert.token_budget) break;

        messages.push({ role: 'assistant', content: response.content });
        const results = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const qualified = block.name.replace('__', '.');
          const res = await tools.call(qualified, block.input);
          if (qualified === 'filesystem.fs_write' && res.ok) outputs.push(block.input.path);
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(res.ok ? res.result : { error: res.error }),
            is_error: !res.ok,
          });
        }
        messages.push({ role: 'user', content: results });
      }
      // Report cumulative output (vs token_budget) and the peak input context
      // reached in the last turn (vs the model's context window).
      reportUsage(
        project,
        expert.id,
        { input_tokens: lastInput, output_tokens: spentOut, cache_read_input_tokens: cacheRead, calls },
        { phase: 'expert', task: task.id }
      );
      return { summary: finalText.trim() || `${expert.name}: task completato.`, outputs };
    },

    async synthesize(project, director, macroGoal, expertReports) {
      const client = await getClient();
      const { text, usage } = await completeText(
        client,
        director,
        [
          `Macro-obiettivo: ${macroGoal.description}`,
          '',
          'Report dei tuoi sub-agenti:',
          ...expertReports.map((r) => `- ${r.expert_name} (${r.task_id}): ${r.summary}`),
          '',
          "Sintetizza per l'Orchestratore in max 10 righe markdown: risultati, decisioni, rischi.",
        ].join('\n')
      );
      reportUsage(project, director.id, usage, { phase: 'synthesize' });
      return text;
    },

    async aggregate(project, goal, directorReports) {
      const client = await getClient();
      const orchestrator = registry.orchestrator();
      const { text, usage } = await completeText(
        client,
        orchestrator,
        [
          `Obiettivo: ${goal.text}`,
          '',
          'Sintesi dei tre Direttori:',
          ...directorReports.map((r) => `## ${r.director_name} (${r.department})\n${r.synthesis}`),
          '',
          'Scrivi il report finale in markdown per i consulenti umani: executive summary, sezione per dipartimento, prossimi passi.',
        ].join('\n')
      );
      reportUsage(project, orchestrator.id, usage, { phase: 'aggregate' });
      return text;
    },
  };
}
