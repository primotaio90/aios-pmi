/**
 * Autonomy — the third permission axis: what an agent may do ON ITS OWN.
 *
 * Three axes, the MOST RESTRICTIVE always wins (docs/ARCHITECTURE.md §12):
 *  - Capability  = frontmatter `mcp_whitelist` (already existed): which tools
 *    the agent owns at all. Enforced first, in gateway.mjs.
 *  - Mode        = modes.mjs (Fase B): which of those are active right now.
 *    Subtractive only, never widens the whitelist. Enforced via opts.allow.
 *  - Autonomy    = THIS module: among the active tools, which start by
 *    themselves (`auto`), which ask first (`ask`), which are off-limits
 *    (`never`). Default is `auto` everywhere → zero-config behaviour is
 *    byte-for-byte identical to before.
 *
 * Policy sources, in resolution order (later sources override earlier ones,
 * EXCEPT the mode floor which is an unbreakable ceiling — see resolvePolicy):
 *  1. mode autonomy floor      (declarative, per operating mode — NEVER loosened)
 *  2. agent frontmatter        (auto_approve / ask_approve / never_approve — flat lists)
 *  3. project override         (projects/<id>/state/autonomy.json, same schema)
 *  4. session override         (in-memory only, "approve for this session", never on disk)
 *
 * Semantics: within ONE source the most restrictive matching entry wins. ACROSS
 * sources the LAST one with a matching entry wins (so a session "approve for
 * this session" can loosen a frontmatter `ask` to `auto`). The mode floor is
 * special: it is the guaranteed ceiling and can never be relaxed by anyone —
 * that is what keeps the Architect from writing, no matter the overrides.
 *
 * Entries are FLAT strings so frontmatter.mjs keeps parsing them. A tool may be
 * path-scoped with a glob suffix: `filesystem.fs_write:outputs/**` matches only
 * when payload.path falls inside the glob. The mini-glob (`**`, `*`) is internal
 * and dependency-free (vincolo: nessuna libreria nuova).
 *
 * ApprovalQueue: an `ask` call does not fail, it WAITS. It emits
 * `mcp.approval_required` on the bus (the SSE channel already carries any
 * `type`, bus.mjs untouched), persists to state/approvals.json and returns a
 * Promise that `resolve()` settles. Timeout: 120 s in an unattended engine run
 * (falls back to the existing `blocked` state), null (indefinite) when the call
 * comes from the interactive chat — the caller passes the context explicitly.
 */

// Policy precedence rank: higher = more restrictive. `auto` is the floor (0).
const RANK = { auto: 0, ask: 1, never: 2 };
const POLICIES = ['auto', 'ask', 'never'];

const APPROVALS_FILE = 'approvals';
const AUTONOMY_FILE = 'autonomy';
// Timeout for an approval in an unattended run: past this, the pending call is
// settled as a timeout so the engine task falls back to `blocked`.
const UNATTENDED_TIMEOUT_MS = 120_000;

/* ------------------------------------------------------------------------- *
 * Mini-glob: `**` = any run of characters (incl. separators), `*` = any run
 * except `/`, everything else literal. Compiled once per pattern, cached.
 * ------------------------------------------------------------------------- */
const globCache = new Map();

function compileGlob(pattern) {
    let re = '';
    const n = pattern.length;
    for (let i = 0; i < n; i += 1) {
        const ch = pattern[i];
        if (ch === '*') {
            if (pattern[i + 1] === '*') {
                // `**` at the very end (after a literal dir + '/'): the slash and
                // everything after it are optional, so `outputs/**` also matches
                // the bare directory `outputs` → `^outputs(/.*)?$`.
                if (i + 1 === n - 1 && re.endsWith('/')) {
                    re = re.slice(0, -1); // drop the literal trailing slash
                    re += '(/.*)?';
                } else {
                    re += '.*';
                }
                i += 1; // consume the second star
            } else {
                re += '[^/]*';
            }
        } else if ('\\^$.|?+()[]{}'.includes(ch)) {
            re += `\\${ch}`;
        } else {
            re += ch;
        }
    }
    return new RegExp(`^${re}$`);
}

/** True when `value` matches `pattern` (mini-glob, `/`-aware). */
export function matchGlob(pattern, value) {
    if (typeof pattern !== 'string' || typeof value !== 'string') return false;
    let re = globCache.get(pattern);
    if (!re) {
        re = compileGlob(pattern);
        globCache.set(pattern, re);
    }
    return re.test(value);
}

/**
 * Splits a flat autonomy entry into { tool, glob }.
 * `filesystem.fs_write:outputs/**` → { tool: 'filesystem.fs_write', glob: 'outputs/**' }
 * `research.web_search`           → { tool: 'research.web_search', glob: null }
 */
function splitEntry(entry) {
    const s = String(entry || '').trim();
    const idx = s.indexOf(':');
    if (idx === -1) return { tool: s, glob: null };
    return { tool: s.slice(0, idx), glob: s.slice(idx + 1) || null };
}

/** True when `entry` (tool[:glob]) governs the call `tool` with `payload`. */
function entryMatches(entry, tool, payload) {
    const { tool: entryTool, glob } = splitEntry(entry);
    if (entryTool !== tool) return false;
    if (!glob) return true; // tool-wide rule
    // Path-scoped rule: applies only when the payload path falls in the glob.
    const target = payload && typeof payload.path === 'string' ? payload.path : '';
    return matchGlob(glob, target);
}

/** Most restrictive policy among `candidates` (rank max), default `auto`. */
function mostRestrictive(candidates) {
    let best = 'auto';
    for (const c of candidates) {
        if (POLICIES.includes(c) && RANK[c] > RANK[best]) best = c;
    }
    return best;
}

/**
 * Effective policy for ONE call, from an ORDERED set of rule lists. Every list
 * is `{ auto:[], ask:[], never:[] }` of flat `tool[:glob]` entries. Within one
 * source, the most restrictive matching entry wins (`never` > `ask` > `auto`).
 *
 * The sources are [mode floor, frontmatter, project, session]. The DURABLE
 * level is `mostRestrictive(floor, frontmatter, project)`: tenant and
 * frontmatter can only tighten the agent, never loosen the mode floor. The
 * SESSION is the single exception that may LOOSEN — it is the human saying
 * "approve for this session" — but with two hard limits: it can only relax
 * `ask` → `auto` (never remove a `never`), and it can never go below the mode
 * floor. So the Architect (floor `fs_write: never`) still cannot write, no
 * matter what the session says.
 */
export function resolvePolicy(sources, tool, payload) {
    const [floor, frontmatter, project, session] = sources;
    const voteOf = (src) => {
        if (!src) return null;
        const matched = [];
        for (const policy of POLICIES) {
            for (const entry of src[policy] || []) {
                if (entryMatches(entry, tool, payload)) matched.push(policy);
            }
        }
        return matched.length > 0 ? mostRestrictive(matched) : null;
    };

    const floorVote = voteOf(floor);
    // Durable level: mode floor + frontmatter + tenant, most restrictive wins.
    const durable = mostRestrictive([floorVote, voteOf(frontmatter), voteOf(project)].filter(Boolean));

    const sessionVote = voteOf(session);
    if (sessionVote === null) return durable;
    // The session may only LOOSEN: never add a restriction the durable level
    // did not already have. And a durable `never` is absolute (cannot relax).
    if (RANK[sessionVote] >= RANK[durable]) return durable;
    if (durable === 'never') return durable;
    // Relax ask → auto, but never below the mode floor.
    if (floorVote !== null && RANK[floorVote] > RANK[sessionVote]) return floorVote;
    return sessionVote;
}

/** Normalizes a raw {auto,ask,never} object into clean string arrays. */
export function normalizeLists(raw) {
    const out = { auto: [], ask: [], never: [] };
    if (!raw || typeof raw !== 'object') return out;
    for (const policy of POLICIES) {
        const list = Array.isArray(raw[policy]) ? raw[policy] : [];
        out[policy] = [...new Set(list.map((e) => String(e).trim()).filter(Boolean))];
    }
    return out;
}

/**
 * AutonomyPolicy — resolves the effective `auto|ask|never` for a call.
 * Holds the per-session (in-memory) overrides; durable overrides live in the
 * tenant's state/autonomy.json and are re-read per call (cheap JSON read).
 */
export class AutonomyPolicy {
    constructor({ registry, store }) {
        this.registry = registry;
        this.store = store;
        // Session overrides: `${project}/${agentId}` → { auto:[], ask:[], never:[] }.
        this.session = new Map();
    }

    /** Agent's frontmatter autonomy lists (default empty = all auto). */
    frontmatterLists(agent) {
        return normalizeLists({
            auto: agent?.auto_approve,
            ask: agent?.ask_approve,
            never: agent?.never_approve,
        });
    }

    /** Durable per-tenant override, state/autonomy.json (same schema). */
    async projectLists(projectId, agentId) {
        const all = await this.store.readState(projectId, AUTONOMY_FILE, {});
        return normalizeLists(all?.[agentId]);
    }

    /** In-memory session override ("approve for this session"): may tighten OR
     *  loosen the frontmatter, but never the mode floor (resolvePolicy ceiling). */
    sessionLists(projectId, agentId) {
        return normalizeLists(this.session.get(`${projectId}/${agentId}`));
    }

    /**
     * Effective policy map for an agent in a project+mode:
     *   { [tool]: 'auto'|'ask'|'never' }
     * `tools` = the already-active set (whitelist ∩ mode), so autonomy can only
     * tighten what is reachable, never resurrect a denied tool.
     */
    async effective(projectId, agentId, modeId, tools, modeFloor = {}) {
        const agent = this.registry.get(agentId);
        const frontmatter = this.frontmatterLists(agent);
        const project = await this.projectLists(projectId, agentId);
        const session = this.sessionLists(projectId, agentId);
        const floor = normalizeLists(modeFloor);
        const out = {};
        for (const tool of tools || []) {
            // No payload here: a path-scoped entry is evaluated tool-wide at this
            // stage (conservative: the tool is `ask` unless every scoped rule is auto).
            out[tool] = resolvePolicy([floor, frontmatter, project, session], tool, {});
        }
        return out;
    }

    /**
     * Policy for a single concrete call (payload-aware: path globs apply).
     * `modeFloor` is the declarative floor of the active mode ({tool: policy}).
     */
    async policyFor(projectId, agentId, tool, payload, modeFloor = {}) {
        const agent = this.registry.get(agentId);
        const frontmatter = this.frontmatterLists(agent);
        const project = await this.projectLists(projectId, agentId);
        const session = this.sessionLists(projectId, agentId);
        const floor = normalizeLists(modeFloor);
        return resolvePolicy([floor, frontmatter, project, session], tool, payload);
    }

    /** Sets/replaces the in-memory session override for an agent in a project. */
    setSessionOverride(projectId, agentId, lists) {
        this.session.set(`${projectId}/${agentId}`, normalizeLists(lists));
    }

    /** Writes the durable per-tenant override (state/autonomy.json). */
    async setProjectOverride(projectId, agentId, lists) {
        const all = await this.store.readState(projectId, AUTONOMY_FILE, {});
        all[agentId] = normalizeLists(lists);
        await this.store.writeState(projectId, AUTONOMY_FILE, all);
        return all[agentId];
    }
}

/**
 * ApprovalQueue — pending `ask` calls waiting for a human decision.
 * A request is persisted (state/approvals.json) so the panel survives a reload,
 * emits `mcp.approval_required`, and returns a Promise settled by `resolve()`.
 */
export class ApprovalQueue {
    constructor({ bus, store }) {
        this.bus = bus;
        this.store = store;
        // In-flight resolvers: approvalId → { resolve, timer }.
        this.pending = new Map();
        this.chains = new Map(); // per-project write serialization
        // Records marked stale after a restart: they still show in the panel
        // (flagged) but no in-memory resolver is waiting on them anymore.
        this.stale = new Set();
    }

    #chain(projectId, fn) {
        const prev = this.chains.get(projectId) || Promise.resolve();
        const next = prev.then(fn, fn);
        this.chains.set(projectId, next);
        return next;
    }

    async #read(projectId) {
        return (await this.store.readState(projectId, APPROVALS_FILE, [])) || [];
    }

    async #write(projectId, list) {
        await this.store.writeState(projectId, APPROVALS_FILE, list);
    }

    /**
     * Marks every persisted 'pending' record as stale at boot. The in-memory
     * resolvers die with the process, so after a restart a persisted 'pending'
     * is an orphan nobody is waiting on: approving it settles the record (so it
     * stops cluttering the queue) but unblocks nothing. We flag them so the UI
     * can render them distinctly instead of pretending they are live.
     */
    async markOrphans(projectId) {
        return this.#chain(projectId, async () => {
            const list = await this.#read(projectId);
            let changed = false;
            for (const rec of list) {
                if (rec.status === 'pending' && !this.pending.has(rec.id)) {
                    rec.status = 'stale';
                    rec.decided_by = null;
                    rec.decided_at = rec.decided_at || new Date().toISOString();
                    this.stale.add(rec.id);
                    changed = true;
                }
            }
            if (changed) await this.#write(projectId, list);
            return changed;
        });
    }

    /**
     * Pending (unresolved, LIVE) approvals for a tenant, newest first. Routed
     * through the per-project chain so it never reads a half-written state.
     */
    async pendingList(projectId) {
        return this.#chain(projectId, async () => {
            const list = await this.#read(projectId);
            return list.filter((a) => a.status === 'pending').reverse();
        });
    }

    /** All approvals incl. stale/resolved, newest first (for the panel history). */
    async list(projectId, { limit = 50 } = {}) {
        return this.#chain(projectId, async () => {
            const list = await this.#read(projectId);
            return list.slice(-limit).reverse();
        });
    }

    /**
     * Registers an approval request and waits for its resolution.
     *   timeoutMs: number → settle as { approved:false, reason:'timeout' };
     *              null   → wait indefinitely (interactive chat).
     * Resolves to { approved:boolean, by:string|null, reason?:'denied'|'timeout' }.
     */
    request(projectId, agentId, tool, payload, { timeoutMs = UNATTENDED_TIMEOUT_MS, mode = null } = {}) {
        const id = `A-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const record = {
            id,
            ts: new Date().toISOString(),
            agent: agentId,
            tool,
            payload,
            mode,
            status: 'pending', // pending | approved | denied | timeout | stale
            decided_by: null,
            decided_at: null,
        };

        const promise = new Promise((resolvePromise) => {
            let timer = null;
            if (typeof timeoutMs === 'number' && timeoutMs > 0) {
                timer = setTimeout(() => {
                    this.pending.delete(id);
                    this.#settle(projectId, id, 'timeout', null).catch(() => { });
                    resolvePromise({ approved: false, by: null, reason: 'timeout' });
                }, timeoutMs);
                // Never keep a node process alive because of a pending approval timer.
                timer.unref?.();
            }
            this.pending.set(id, { resolve: resolvePromise, timer });
        });

        // Persist + notify (best-effort; the in-memory resolver is the source of truth).
        this.#chain(projectId, async () => {
            const list = await this.#read(projectId);
            list.push(record);
            if (list.length > 200) list.splice(0, list.length - 200);
            await this.#write(projectId, list);
        }).catch(() => { });
        this.bus.emitEvent(
            projectId,
            'mcp.approval_required',
            { id, agent: agentId, tool, payload, mode },
            agentId
        );

        return promise;
    }

    /**
     * Settles a pending request from the UI. Returns the updated record, or null
     * when the id is unknown / already decided (idempotent on the persisted state).
     * If a live in-memory resolver exists it is released (the paused tool call
     * proceeds or is denied); for a stale record only the persisted state moves.
     */
    async resolve(projectId, id, approved, byUser) {
        const status = approved ? 'approved' : 'denied';
        const record = await this.#settle(projectId, id, status, byUser || 'consultant');

        const inflight = this.pending.get(id);
        if (inflight) {
            if (inflight.timer) clearTimeout(inflight.timer);
            this.pending.delete(id);
            this.stale.delete(id);
            inflight.resolve({ approved: Boolean(approved), by: byUser || 'consultant', reason: approved ? undefined : 'denied' });
        }

        this.bus.emitEvent(
            projectId,
            'mcp.approval_resolved',
            { id, approved: Boolean(approved), by: byUser || 'consultant', status },
            null
        );
        return record;
    }

    /** Persists the decision on the stored record (serialized per project). */
    async #settle(projectId, id, status, byUser) {
        return this.#chain(projectId, async () => {
            const list = await this.#read(projectId);
            const rec = list.find((a) => a.id === id);
            if (!rec) return null;
            // Idempotent: a settled record is not overwritten (e.g. timeout raced a click).
            if (rec.status !== 'pending') return rec;
            rec.status = status;
            rec.decided_by = byUser;
            rec.decided_at = new Date().toISOString();
            await this.#write(projectId, list);
            return rec;
        });
    }
}
