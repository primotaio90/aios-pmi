import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Role-based auth for the three human consultants.
 * Users live in config/users.json; passwords are stored as sha256 hex.
 * The "project_manager" role is reserved for Fase 2 (account disabled).
 * Sessions are in-memory tokens (the singleton survives Next.js HMR).
 */
export class Auth {
  constructor(usersPath) {
    this.usersPath = usersPath;
    this.sessions = new Map(); // token -> { username, name, role, since }
  }

  async #users() {
    const raw = await fs.readFile(this.usersPath, 'utf-8');
    return JSON.parse(raw).users || [];
  }

  async login(username, password) {
    const users = await this.#users();
    const hash = createHash('sha256').update(String(password)).digest('hex');
    const user = users.find((u) => u.username === username);
    if (!user || user.disabled || user.password_sha256 !== hash) return null;
    const token = randomUUID();
    const session = { username: user.username, name: user.name, role: user.role, since: new Date().toISOString() };
    this.sessions.set(token, session);
    return { token, user: session };
  }

  check(token) {
    return (token && this.sessions.get(token)) || null;
  }

  logout(token) {
    this.sessions.delete(token);
  }
}
