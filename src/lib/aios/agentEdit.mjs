/**
 * Durable edits to an agent's definition file (agents/<id>.md), the single
 * source of truth. Two operations the dashboard exposes:
 *   - appendInstruction: a human correction becomes a permanent "operative note"
 *     in the agent's system prompt (body), so it persists across future runs.
 *   - setWhitelist: grant/revoke the agent's MCP tools (frontmatter mcp_whitelist).
 *
 * After a write we reload the registry immediately (fs.watch would also fire,
 * but reloading now makes the change visible to the very next request).
 *
 * NOTE: writes go to the filesystem — on serverless (Vercel) these won't persist
 * (read-only FS); same caveat as the rest of AIOS state (docs/DEPLOY.md).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';

const NOTES_START = '<!-- AIOS-NOTES:START -->';
const NOTES_END = '<!-- AIOS-NOTES:END -->';
const NOTES_HEADING = '## Note operative (aggiornate dalla dashboard)';
const ID_RE = /^[a-z0-9_]+$/;

/** Parses the managed notes block out of a body → { before, notes: [{ts,text}] }. */
export function parseNotes(body) {
  const start = body.indexOf(NOTES_START);
  const end = body.indexOf(NOTES_END);
  if (start === -1 || end === -1 || end < start) return { before: body.trimEnd(), notes: [] };
  const block = body.slice(start + NOTES_START.length, end);
  const notes = [];
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s+\*\*(.+?)\*\*\s+—\s+([\s\S]*)$/);
    if (m) notes.push({ ts: m[1], text: m[2].trim() });
  }
  return { before: body.slice(0, start).trimEnd(), notes };
}

function renderBody(before, notes) {
  if (notes.length === 0) return `${before}\n`;
  const lines = notes.map((n) => `- **${n.ts}** — ${n.text.replace(/\r?\n+/g, ' ').trim()}`);
  return `${before}\n\n${NOTES_START}\n${NOTES_HEADING}\n\n${lines.join('\n')}\n${NOTES_END}\n`;
}

export class AgentEditor {
  constructor({ registry, gateway, bus }) {
    this.registry = registry;
    this.gateway = gateway;
    this.bus = bus;
  }

  #fileFor(agentId) {
    if (!ID_RE.test(agentId) || !this.registry.get(agentId)) {
      throw new Error(`Agente sconosciuto: ${agentId}`);
    }
    return path.join(this.registry.agentsDir, `${agentId}.md`);
  }

  async #read(agentId) {
    const file = this.#fileFor(agentId);
    const raw = await fs.readFile(file, 'utf-8');
    return { file, ...parseFrontmatter(raw) };
  }

  async #writeAndReload(file, meta, body, project, evtType, evtData) {
    await fs.writeFile(file, serializeFrontmatter(meta, body));
    await this.registry.load(); // make it visible immediately (watch also fires)
    this.bus?.emitEvent(project || '*', evtType, evtData);
  }

  /** Lists the current operative notes (read from the live registry body). */
  notes(agentId) {
    const agent = this.registry.get(agentId);
    if (!agent) throw new Error(`Agente sconosciuto: ${agentId}`);
    return parseNotes(agent.system_prompt).notes;
  }

  /** Appends a permanent operative note to the agent's system prompt. */
  async appendInstruction(agentId, text, { by = 'consultant', project = null } = {}) {
    const clean = String(text || '').trim();
    if (!clean) throw new Error('Istruzione vuota');
    const { file, meta, body } = await this.#read(agentId);
    const { before, notes } = parseNotes(body);
    notes.unshift({ ts: new Date().toISOString(), text: clean });
    await this.#writeAndReload(file, meta, renderBody(before, notes), project, 'agent.instruction', {
      agent: agentId,
      by,
      preview: clean.slice(0, 80),
    });
    return this.notes(agentId);
  }

  /** Available tools (from the MCP catalog) + the agent's current whitelist. */
  capabilities(agentId) {
    const agent = this.registry.get(agentId);
    if (!agent) throw new Error(`Agente sconosciuto: ${agentId}`);
    const servers = this.gateway?.config?.servers ?? {};
    const available = [];
    for (const [server, def] of Object.entries(servers)) {
      for (const [tool, spec] of Object.entries(def.tools || {})) {
        available.push({ qualified: `${server}.${tool}`, server, tool, description: spec.description || '' });
      }
    }
    return { available, current: agent.mcp_whitelist };
  }

  /** Replaces the agent's mcp_whitelist. Every tool must exist in the catalog. */
  async setWhitelist(agentId, tools, { by = 'consultant', project = null } = {}) {
    if (!Array.isArray(tools)) throw new Error('whitelist deve essere una lista');
    const unique = [...new Set(tools.map((t) => String(t)))];
    for (const tool of unique) {
      if (!this.gateway.toolExists(tool)) throw new Error(`Tool MCP inesistente: ${tool}`);
    }
    const { file, meta, body } = await this.#read(agentId);
    meta.mcp_whitelist = unique;
    await this.#writeAndReload(file, meta, body, project, 'agent.capabilities', {
      agent: agentId,
      by,
      count: unique.length,
    });
    return this.capabilities(agentId);
  }
}
