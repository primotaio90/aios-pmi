/**
 * Mock runner: deterministic playbooks driven ONLY by agent frontmatter
 * (mcp_whitelist, keywords, mock_summary). This is what keeps the
 * "new sub-agent = one new .md file" guarantee true even without an LLM:
 * any agent added to agents/ immediately works through the generic playbook.
 * Small delays make the live log readable in the dashboard.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(120 + Math.floor(Math.random() * 300));

const short = (text, n = 80) => (text.length > n ? text.slice(0, n).trim() + '…' : text);

/** Default payloads for domain tools, keyed by qualified tool name. */
function domainPayload(tool, goal, expert) {
  switch (tool) {
    case 'research.web_search':
      return { query: `${short(goal, 60)} ${expert.keywords.slice(0, 3).join(' ')}`.trim() };
    case 'data.read_spreadsheet':
      return { path: 'dati/bilancio_2025.csv' };
    case 'data.compute_roi':
      return { investment: 14500, annual_saving: 11200 };
    case 'diagram.mermaid_generate':
      return {
        title: short(goal, 50),
        steps: ['Ricezione merce', 'Etichettatura', 'Stoccaggio', 'Prelievo', 'Controllo', 'Spedizione'],
      };
    case 'api.openapi_parse':
      return { path: 'dati/api_gestionale.json' };
    case 'api.http_probe':
      return { url: 'https://gestionale.cliente.local/api/health' };
    default:
      return null;
  }
}

function describeEvidence(tool, res) {
  if (!res.ok) return `- \`${tool}\`: non riuscito (${res.error})`;
  const r = res.result;
  switch (tool) {
    case 'research.web_search':
      return `- \`${tool}\`: ${r.results.length} fonti su "${r.query}" — ${r.results.map((x) => x.title).join('; ')}`;
    case 'data.read_spreadsheet':
      return `- \`${tool}\`: letto ${r.path} (${r.row_count} righe, colonne: ${r.columns.join(', ')})`;
    case 'data.compute_roi':
      return `- \`${tool}\`: ROI ${r.roi_pct}% — payback ${r.payback_months} mesi (investimento €${r.investment})`;
    case 'diagram.mermaid_generate':
      return `- \`${tool}\`: diagramma "${r.title}" generato (${r.mermaid.split('\n').length} righe Mermaid)`;
    case 'api.openapi_parse':
      return `- \`${tool}\`: mappati ${r.endpoint_count} endpoint da ${r.path}`;
    case 'api.http_probe':
      return `- \`${tool}\`: ${r.url} → HTTP ${r.status} (${r.latency_ms}ms, simulato)`;
    default:
      return `- \`${tool}\`: ok`;
  }
}

// Rough token estimate (~4 chars/token) so the simulated usage is proportional
// to the real work done and comparable to the agent's token_budget.
const estTokens = (chars) => Math.max(1, Math.round(chars / 4));

export function createRunner({ registry, store, gateway, reportUsage = () => {} }) {
  return {
    /** Orchestrator-level decomposition: one macro-goal per department. */
    async decompose(project, goal, directors) {
      const orchestrator = registry.orchestrator();
      // Reading the brief goes through the gateway so it is audited like any MCP call.
      const brief = await gateway.call(project, orchestrator.id, 'filesystem.fs_read', { path: 'brief.md' });
      await jitter();
      const templates = {
        business: `Tradurre «${short(goal)}» in strategia operativa: contesto di mercato, numeri del cliente, processi correnti e ROI atteso.`,
        tech: `Progettare l'ecosistema tecnologico per «${short(goal)}»: architettura, integrazioni con gestionale/CRM e strumenti (No-Code, API, custom).`,
        delivery: `Pianificare il roll-out di «${short(goal)}»: fasi e scadenze, formazione del personale della PMI, qualità e stato avanzamento.`,
      };
      const macro = directors.map((d) => ({
        department: d.department,
        description: templates[d.department] || `Contributo di ${d.name} a «${short(goal)}».`,
      }));
      reportUsage(
        project,
        orchestrator.id,
        {
          input_tokens: estTokens(orchestrator.system_prompt.length + (brief.ok ? brief.result.content.length : 0) + goal.length),
          output_tokens: estTokens(macro.map((m) => m.description).join(' ').length),
          simulated: true,
        },
        { phase: 'decompose' }
      );
      return macro;
    },

    /** Director-level planning: pick experts by keyword match on the goal text. */
    async plan(project, director, macroGoal, experts) {
      await jitter();
      const haystack = `${macroGoal.description} ${macroGoal.goal_text || ''}`.toLowerCase();
      let selected = experts.filter((e) => e.keywords.some((k) => haystack.includes(String(k).toLowerCase())));
      if (selected.length < 2) selected = experts; // demo richness: fall back to the whole team
      return selected.slice(0, 4).map((e) => ({
        expertId: e.id,
        title: `${e.name} — ${short(macroGoal.description, 70)}`,
      }));
    },

    /**
     * Generic expert playbook:
     * 1) read context (department file + brief) 2) run up to two domain tools
     * from the whitelist 3) write a structured report in outputs/ 4) return summary.
     * `tools.call` is pre-bound to this expert, so the whitelist is enforced.
     */
    async runExpert(project, expert, task, goal, tools) {
      const evidence = [];
      const director = registry.get(expert.director);
      const canRead = expert.mcp_whitelist.includes('filesystem.fs_read');
      const canWrite = expert.mcp_whitelist.includes('filesystem.fs_write');

      if (canRead) {
        const contextFiles = ['brief.md', ...(director?.owns_files?.slice(0, 1) || [])];
        for (const file of contextFiles) {
          const res = await tools.call('filesystem.fs_read', { path: file });
          if (res.ok) evidence.push(`- \`filesystem.fs_read\`: contesto acquisito da ${file} (${res.result.content.length} caratteri)`);
          await jitter();
        }
      }

      const domainTools = expert.mcp_whitelist.filter(
        (t) => !t.startsWith('filesystem.') && !t.startsWith('tasks.')
      );
      for (const tool of domainTools.slice(0, 2)) {
        const payload = domainPayload(tool, goal, expert);
        if (!payload) continue;
        const res = await tools.call(tool, payload);
        evidence.push(describeEvidence(tool, res));
        if (tool === 'diagram.mermaid_generate' && res.ok && canWrite) {
          await tools.call('filesystem.fs_write', {
            path: `outputs/${task.id}_flusso.mmd`,
            content: res.result.mermaid + '\n',
          });
        }
        await jitter();
      }

      const summary = expert.mock_summary
        ? expert.mock_summary.replace('{goal}', short(goal, 70))
        : `${expert.name}: attività completata su «${short(goal, 70)}» (${evidence.length} evidenze raccolte).`;

      // Simulated usage proportional to context read (system prompt + tool results)
      // and work produced (evidence + summary). Marked simulated for the UI.
      reportUsage(
        project,
        expert.id,
        {
          input_tokens: estTokens(expert.system_prompt.length + goal.length) + evidence.length * 320,
          output_tokens: estTokens(summary.length) + evidence.length * 140 + 300,
          calls: 1 + evidence.length,
          simulated: true,
        },
        { phase: 'expert', task: task.id }
      );

      const outputs = [];
      if (canWrite) {
        const outPath = `outputs/${task.id}_${expert.id}.md`;
        const report = [
          `# Report — ${expert.name}`,
          '',
          `- **Task**: ${task.id} · ${task.title}`,
          `- **Obiettivo**: ${goal}`,
          `- **Direttore**: ${director?.name || expert.director}`,
          `- **Data**: ${new Date().toISOString()}`,
          '',
          '## Evidenze (chiamate MCP)',
          '',
          ...(evidence.length ? evidence : ['- Nessun tool di dominio in whitelist: analisi basata sul contesto.']),
          '',
          '## Conclusioni',
          '',
          summary,
          '',
        ].join('\n');
        const res = await tools.call('filesystem.fs_write', { path: outPath, content: report });
        if (res.ok) outputs.push(outPath);
      }

      return { summary, outputs };
    },

    /** Director synthesis of its experts' reports (bottom-up, one level). */
    async synthesize(project, director, macroGoal, expertReports) {
      await jitter();
      const bullets = expertReports.map((r) => `- **${r.expert_name}** (${r.task_id}): ${r.summary}`);
      const synthesis = [
        `**Macro-obiettivo**: ${macroGoal.description}`,
        '',
        ...bullets,
        '',
        `Sintesi di ${director.name}: le attività del dipartimento sono state completate e i deliverable sono in \`outputs/\`.`,
      ].join('\n');
      reportUsage(
        project,
        director.id,
        {
          input_tokens: estTokens(director.system_prompt.length + expertReports.map((r) => r.summary).join(' ').length),
          output_tokens: estTokens(synthesis.length),
          simulated: true,
        },
        { phase: 'synthesize' }
      );
      return synthesis;
    },

    /** Orchestrator aggregation: the final report written to outputs/. */
    async aggregate(project, goal, directorReports) {
      await jitter();
      const sections = directorReports.map((r) =>
        [`## ${r.director_name} (${r.department})`, '', r.synthesis].join('\n')
      );
      const report = [
        `# Report finale — ${goal.id}`,
        '',
        `**Obiettivo**: ${goal.text}`,
        `**Data**: ${new Date().toISOString()}`,
        '',
        ...sections,
        '',
        '---',
        '_Generato da Orchestrator_Core aggregando i report dei tre Direttori._',
        '',
      ].join('\n');
      const orchestrator = registry.orchestrator();
      if (orchestrator) {
        reportUsage(
          project,
          orchestrator.id,
          {
            input_tokens: estTokens(orchestrator.system_prompt.length + directorReports.map((r) => r.synthesis).join(' ').length),
            output_tokens: estTokens(report.length),
            simulated: true,
          },
          { phase: 'aggregate' }
        );
      }
      return report;
    },
  };
}
