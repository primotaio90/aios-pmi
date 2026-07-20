import fs from 'node:fs/promises';

export class McpDeniedError extends Error {
  constructor(agent, tool) {
    super(`Tool ${tool} non in whitelist per ${agent}`);
    this.name = 'McpDeniedError';
  }
}

/**
 * Declarative MCP gateway. mcp/servers.json declares servers and tools;
 * agents may only call tools listed in their frontmatter mcp_whitelist.
 * Every call — allowed, denied or failed — is logged with timestamp, agent,
 * tool, payload and outcome (auditability requirement).
 *
 * transport "internal" = deterministic in-process handlers (no network).
 * transport "stdio" is a declared extension point, not implemented here.
 */
export class McpGateway {
  constructor(configPath, store, bus, tasks) {
    this.configPath = configPath;
    this.store = store;
    this.bus = bus;
    this.tasks = tasks;
    this.registry = null; // set by system wiring
    this.config = { servers: {} };
  }

  async load() {
    this.config = JSON.parse(await fs.readFile(this.configPath, 'utf-8'));
    return this;
  }

  toolExists(qualified) {
    const [server, tool] = String(qualified).split('.');
    return Boolean(this.config.servers?.[server]?.tools?.[tool]);
  }

  toolSpec(qualified) {
    const [server, tool] = String(qualified).split('.');
    return this.config.servers?.[server]?.tools?.[tool] || null;
  }

  /** Executes a tool call on behalf of an agent, enforcing its whitelist. */
  async call(projectId, agentId, tool, payload = {}) {
    const started = Date.now();
    const agent = this.registry?.get(agentId);

    const log = async (outcome, extra = {}) => {
      const entry = {
        ts: new Date().toISOString(),
        agent: agentId,
        tool,
        payload,
        outcome,
        duration_ms: Date.now() - started,
        ...extra,
      };
      this.bus.emitEvent(projectId, 'mcp.call', entry, agentId);
    };

    if (!agent) {
      await log('denied', { error: 'agente sconosciuto' });
      throw new McpDeniedError(agentId, tool);
    }
    if (!this.toolExists(tool)) {
      await log('denied', { error: 'tool inesistente' });
      throw new McpDeniedError(agentId, tool);
    }
    if (!agent.mcp_whitelist.includes(tool)) {
      await log('denied', { error: 'fuori whitelist' });
      throw new McpDeniedError(agentId, tool);
    }

    try {
      const result = await this.#dispatch(projectId, agentId, tool, payload);
      await log('ok', { result_preview: preview(result) });
      return { ok: true, result };
    } catch (err) {
      await log('error', { error: String(err.message || err) });
      return { ok: false, error: String(err.message || err) };
    }
  }

  async #dispatch(projectId, agentId, qualified, payload) {
    switch (qualified) {
      case 'filesystem.fs_read': {
        const content = await this.store.readFile(projectId, required(payload, 'path'));
        return { path: payload.path, content };
      }
      case 'filesystem.fs_write': {
        const rel = required(payload, 'path');
        await this.store.writeFile(projectId, rel, required(payload, 'content'), {
          append: payload.mode === 'append',
        });
        this.bus.emitEvent(projectId, 'file.updated', { path: rel, mode: payload.mode || 'overwrite' }, agentId);
        return { path: rel, written: true };
      }
      case 'filesystem.fs_list':
        return { dir: payload.dir || '.', files: await this.store.listFiles(projectId, payload.dir || '.') };

      case 'research.web_search':
        return this.#webSearch(projectId, required(payload, 'query'));

      case 'data.read_spreadsheet':
        return this.#readSpreadsheet(projectId, required(payload, 'path'));

      case 'data.compute_roi': {
        const investment = Number(required(payload, 'investment'));
        const annualSaving = Number(required(payload, 'annual_saving'));
        if (investment <= 0 || annualSaving <= 0) throw new Error('investment e annual_saving devono essere > 0');
        return {
          investment,
          annual_saving: annualSaving,
          roi_pct: Math.round((annualSaving / investment) * 1000) / 10,
          payback_months: Math.round((investment / annualSaving) * 12),
        };
      }

      case 'diagram.mermaid_generate': {
        const steps = required(payload, 'steps');
        if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps deve essere una lista non vuota');
        const nodes = steps.map((s, i) => `  S${i}["${String(s).replace(/"/g, "'")}"]`);
        const edges = steps.slice(1).map((_, i) => `  S${i} --> S${i + 1}`);
        return {
          title: payload.title || 'Flusso',
          mermaid: ['flowchart TD', ...nodes, ...edges].join('\n'),
        };
      }

      case 'api.openapi_parse':
        return this.#openapiParse(projectId, required(payload, 'path'));

      case 'api.http_probe':
        // No real network in the internal transport: deterministic simulated probe.
        return { url: required(payload, 'url'), status: 200, latency_ms: 42, simulated: true };

      case 'tasks.task_update': {
        const task = await this.tasks.transition(
          projectId,
          required(payload, 'task_id'),
          required(payload, 'status'),
          agentId
        );
        return { task_id: task.id, status: task.status };
      }

      default:
        throw new Error(`Handler interno mancante per ${qualified}`);
    }
  }

  /** Deterministic simulated web search seeded by the query (no network). */
  async #webSearch(projectId, query) {
    let brief = '';
    try {
      brief = await this.store.readFile(projectId, 'brief.md');
    } catch {
      // no brief available
    }
    const topic = query.slice(0, 60);
    return {
      query,
      simulated: true,
      results: [
        {
          title: `Panoramica di settore: ${topic}`,
          url: 'https://ricerca.simulata/settore',
          snippet: `Trend, benchmark e player rilevanti per "${topic}". ${brief ? 'Contestualizzato sul brief del cliente.' : ''}`.trim(),
        },
        {
          title: `Best practice PMI: ${topic}`,
          url: 'https://ricerca.simulata/best-practice',
          snippet: `Casi studio di PMI italiane comparabili su "${topic}", con costi tipici e tempi di adozione.`,
        },
        {
          title: `Fornitori e soluzioni: ${topic}`,
          url: 'https://ricerca.simulata/fornitori',
          snippet: `Rassegna di soluzioni No-Code/SaaS applicabili a "${topic}" con fascia di prezzo.`,
        },
      ],
    };
  }

  async #readSpreadsheet(projectId, rel) {
    const raw = await this.store.readFile(projectId, rel);
    const lines = raw.trim().split(/\r?\n/);
    const sep = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].split(sep).map((h) => h.trim());
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(sep).map((c) => c.trim());
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    });
    return { path: rel, columns: header, row_count: rows.length, rows: rows.slice(0, 50) };
  }

  async #openapiParse(projectId, rel) {
    const raw = await this.store.readFile(projectId, rel);
    let endpoints = [];
    try {
      const spec = JSON.parse(raw);
      endpoints = Object.entries(spec.paths || {}).flatMap(([p, methods]) =>
        Object.keys(methods).map((m) => ({
          method: m.toUpperCase(),
          path: p,
          summary: methods[m]?.summary || '',
        }))
      );
    } catch {
      // Loose fallback: grep endpoint-looking lines from non-JSON docs.
      endpoints = raw
        .split('\n')
        .filter((l) => /(GET|POST|PUT|DELETE|PATCH)\s+\//.test(l))
        .map((l) => {
          const m = l.match(/(GET|POST|PUT|DELETE|PATCH)\s+(\/\S*)/);
          return { method: m[1], path: m[2], summary: l.trim().slice(0, 80) };
        });
    }
    return { path: rel, endpoint_count: endpoints.length, endpoints };
  }
}

function required(payload, key) {
  if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
    throw new Error(`Parametro obbligatorio mancante: ${key}`);
  }
  return payload[key];
}

function preview(result) {
  const s = JSON.stringify(result);
  return s.length > 220 ? s.slice(0, 220) + '…' : s;
}
