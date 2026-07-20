import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { modelInfo } from './models.mjs';

const LEVELS = ['orchestrator', 'pm', 'director', 'expert'];
const DEPARTMENTS = ['core', 'business', 'tech', 'delivery'];

/**
 * Agent registry: agents/<id>.md is the single source of truth.
 * Scanned at boot and hot-reloaded via fs.watch, so adding a sub-agent is
 * just adding a file — zero code changes (acceptance criterion #4).
 */
export class Registry {
  constructor(agentsDir, bus, { gateway = null } = {}) {
    this.agentsDir = agentsDir;
    this.bus = bus;
    this.gateway = gateway; // set later by system wiring for whitelist validation
    this.agents = new Map();
    this.errors = [];
    this.watcher = null;
  }

  async load() {
    const agents = new Map();
    const errors = [];
    let files = [];
    try {
      files = (await fs.readdir(this.agentsDir)).filter((f) => f.endsWith('.md'));
    } catch {
      this.agents = agents;
      this.errors = [{ file: this.agentsDir, error: 'Cartella agents/ non trovata' }];
      return this;
    }

    for (const file of files.sort()) {
      const id = file.replace(/\.md$/, '');
      try {
        const raw = await fs.readFile(path.join(this.agentsDir, file), 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        const agent = {
          id,
          name: meta.name || id,
          level: meta.level,
          department: meta.department,
          director: meta.director || null,
          model: meta.model || 'claude-opus-4-8',
          token_budget: meta.token_budget || 16000,
          icon: meta.icon || '🤖',
          color: meta.color || '#64748b',
          mcp_whitelist: meta.mcp_whitelist || [],
          owns_files: meta.owns_files || [],
          keywords: meta.keywords || [],
          mock_summary: meta.mock_summary || '',
          system_prompt: body,
          file: `agents/${file}`,
          // Real capabilities of the configured model, so the UI can show the
          // context window and flag an unknown/undersized model.
          model_info: modelInfo(meta.model || 'claude-opus-4-8'),
        };
        const problems = this.#validate(agent, meta);
        if (problems.length > 0) {
          errors.push({ file: agent.file, error: problems.join('; ') });
        } else {
          agents.set(id, agent);
        }
      } catch (err) {
        errors.push({ file: `agents/${file}`, error: String(err.message || err) });
      }
    }

    // Cross-agent validation: expert directors must exist, exactly one orchestrator.
    for (const agent of agents.values()) {
      if (agent.level === 'expert' && !agents.has(agent.director)) {
        errors.push({ file: agent.file, error: `director "${agent.director}" inesistente` });
        agents.delete(agent.id);
      }
    }
    const orchestrators = [...agents.values()].filter((a) => a.level === 'orchestrator');
    if (orchestrators.length !== 1) {
      errors.push({ file: 'agents/', error: `attesi 1 orchestrator, trovati ${orchestrators.length}` });
    }
    // The Project Manager is optional but, when present, sits above the orchestrator.
    // It is NOT counted among directors/experts and is exposed via pm().

    this.agents = agents;
    this.errors = errors;
    return this;
  }

  /** The Project Manager agent (level: pm), if defined. Sits above the orchestrator. */
  pm() {
    return this.all().find((a) => a.level === 'pm') || null;
  }

  #validate(agent, meta) {
    const problems = [];
    if (meta.id && meta.id !== agent.id) problems.push(`id "${meta.id}" diverso dal nome file`);
    if (!LEVELS.includes(agent.level)) problems.push(`level "${agent.level}" non valido`);
    if (!DEPARTMENTS.includes(agent.department)) problems.push(`department "${agent.department}" non valido`);
    if (agent.level === 'expert' && !agent.director) problems.push('campo "director" obbligatorio per gli expert');
    if (agent.level !== 'expert' && agent.director) problems.push('solo gli expert hanno un "director"');
    if (agent.level === 'pm' && agent.department !== 'core') problems.push('il PM deve avere department "core"');
    if (this.gateway) {
      for (const tool of agent.mcp_whitelist) {
        if (!this.gateway.toolExists(tool)) problems.push(`tool MCP sconosciuto in whitelist: ${tool}`);
      }
    }
    return problems;
  }

  /** Hot reload: a new .md file in agents/ becomes available without restart. */
  watch() {
    if (this.watcher) return;
    let timer = null;
    try {
      this.watcher = watch(this.agentsDir, () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          await this.load();
          this.bus.emitEvent('*', 'registry.updated', {
            agents: this.agents.size,
            errors: this.errors.length,
          });
        }, 300);
      });
      // Never keep one-shot scripts (scripts/demo.mjs) alive because of the watcher.
      this.watcher.unref?.();
    } catch {
      // Watching is best-effort (registry can still be reloaded on demand).
    }
  }

  get(id) {
    return this.agents.get(id) || null;
  }

  all() {
    return [...this.agents.values()];
  }

  orchestrator() {
    return this.all().find((a) => a.level === 'orchestrator') || null;
  }

  directors() {
    const order = ['business', 'tech', 'delivery'];
    return this.all()
      .filter((a) => a.level === 'director')
      .sort((a, b) => order.indexOf(a.department) - order.indexOf(b.department));
  }

  expertsOf(directorId) {
    return this.all().filter((a) => a.level === 'expert' && a.director === directorId);
  }
}
