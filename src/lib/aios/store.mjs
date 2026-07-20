import fs from 'node:fs/promises';
import path from 'node:path';

/** Per-path async mutex so concurrent agents never interleave writes on the same file. */
class Mutex {
  constructor() {
    this.queue = Promise.resolve();
  }
  async acquire() {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const current = this.queue;
    this.queue = current.then(() => next);
    await current;
    return release;
  }
}

const DEPARTMENT_DIRS = ['business', 'tech', 'delivery', 'dati', 'outputs', 'logs', 'state'];

/**
 * Multi-tenant filesystem store. Each client (PMI) lives under projects/<id>/.
 * Every path is safe-joined inside the tenant directory: tenant isolation is
 * enforced here, below every caller (gateway, API, engine).
 */
export class Store {
  constructor(projectsRoot) {
    this.root = projectsRoot;
    this.locks = new Map();
  }

  #lock(absPath) {
    let lock = this.locks.get(absPath);
    if (!lock) {
      lock = new Mutex();
      this.locks.set(absPath, lock);
    }
    return lock;
  }

  projectDir(projectId) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId)) {
      throw new Error(`Id progetto non valido: ${projectId}`);
    }
    return path.join(this.root, projectId);
  }

  /** Resolves a relative path inside the tenant dir; rejects traversal and absolute paths. */
  safePath(projectId, rel) {
    const base = this.projectDir(projectId);
    if (typeof rel !== 'string' || path.isAbsolute(rel)) {
      throw new Error(`Percorso non valido: ${rel}`);
    }
    const abs = path.resolve(base, rel);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      throw new Error(`Percorso fuori dal progetto: ${rel}`);
    }
    return abs;
  }

  async listProjects() {
    let entries = [];
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        projects.push(await this.readProject(entry.name));
      } catch {
        // Not a valid tenant dir; skip.
      }
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readProject(projectId) {
    const raw = await fs.readFile(path.join(this.projectDir(projectId), 'project.json'), 'utf-8');
    return { id: projectId, ...JSON.parse(raw) };
  }

  /** Scaffolds a complete tenant: department dirs, seed .md files, empty logs/state. */
  async createProject({ id, name, client, description = '' }) {
    const dir = this.projectDir(id);
    await fs.mkdir(dir, { recursive: false });
    for (const sub of DEPARTMENT_DIRS) {
      await fs.mkdir(path.join(dir, sub), { recursive: true });
    }
    const project = {
      name,
      client,
      description,
      created_at: new Date().toISOString(),
      pm_enabled: false,
    };
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
    await fs.writeFile(
      path.join(dir, 'brief.md'),
      `# Brief — ${name}\n\n${description || '(da compilare con i consulenti)'}\n`
    );
    const seeds = {
      'business/vision_strategica.md': '# Vision Strategica\n',
      'business/analisi_competitiva.md': '# Analisi Competitiva\n',
      'tech/architettura_sistema.md': '# Architettura Sistema\n',
      'tech/mappa_integrazioni.md': '# Mappa Integrazioni\n',
      'delivery/gantt_progetto.md': '# Gantt Progetto\n',
      'delivery/stato_avanzamento.md': '# Stato Avanzamento\n',
    };
    for (const [rel, content] of Object.entries(seeds)) {
      await fs.writeFile(path.join(dir, rel), content);
    }
    return { id, ...project };
  }

  async readFile(projectId, rel) {
    return fs.readFile(this.safePath(projectId, rel), 'utf-8');
  }

  async writeFile(projectId, rel, content, { append = false } = {}) {
    const abs = this.safePath(projectId, rel);
    const release = await this.#lock(abs).acquire();
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      if (append) await fs.appendFile(abs, content);
      else await fs.writeFile(abs, content);
    } finally {
      release();
    }
  }

  async listFiles(projectId, relDir) {
    const abs = this.safePath(projectId, relDir);
    let entries = [];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const stat = await fs.stat(path.join(abs, entry.name));
      files.push({
        path: path.posix.join(relDir, entry.name),
        name: entry.name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  async appendLog(projectId, logName, obj) {
    const rel = `logs/${logName}.jsonl`;
    await this.writeFile(projectId, rel, JSON.stringify(obj) + '\n', { append: true });
  }

  /** Reads the last `limit` JSONL entries, optionally filtered by agent/type. */
  async readLog(projectId, logName, { limit = 200, agent, agents, type } = {}) {
    let raw;
    try {
      raw = await this.readFile(projectId, `logs/${logName}.jsonl`);
    } catch {
      return [];
    }
    let rows = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (agent) rows = rows.filter((r) => r.agent === agent);
    if (agents) rows = rows.filter((r) => agents.includes(r.agent));
    if (type) rows = rows.filter((r) => r.type === type);
    return rows.slice(-limit);
  }

  async readState(projectId, name, fallback) {
    try {
      return JSON.parse(await this.readFile(projectId, `state/${name}.json`));
    } catch {
      return fallback;
    }
  }

  async writeState(projectId, name, obj) {
    await this.writeFile(projectId, `state/${name}.json`, JSON.stringify(obj, null, 2));
  }
}
