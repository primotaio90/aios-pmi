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
 * Policy sources, in resolution order (each can only tighten the previous):
 *  1. mode autonomy floor      (declarative, per operating mode)
 *  2. agent frontmatter        (auto_approve / ask_approve / never_approve — flat lists)
 *  3. project override         (projects/<id>/state/autonomy.json, same schema, wins)
 *  4. session override         (in-memory only, "approve for this session", never on disk)
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
    for (let i = 0; i < pattern.length; i += 1) {
        const ch = pattern[i];
        if (ch === '*') {
            if (pattern[i + 1] === '*') {
                re += '.*';
                i += 1; // consume the second star
                // A trailing `/**` also matches the bare directory (outputs/** ≡ outputs).
                if (pattern[i + 1] === '/' && i + 1 === pattern.length - 1) {
                    re += '?'; // make the final slash optional via the '.*?' trick below
                }
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
 * Effective policy for ONE call, from a set of rule lists. Every list is
 * `{ auto:[], ask:[], never:[] }` of flat `tool[:glob]` entries. For the call
 * `tool`+`payload` we collect, per source, the policy that source assigns
 * (the source's own most-restrictive matching entry), then take the most
 * restrictive across all sources. A source with no matching entry is neutral.
 */
export function resolvePolicy(sources, tool, payload) {
    const votes = [];
    for (const src of sources) {
        if (!src) continue;
        const matched = [];
        for (const policy of POLICIES) {
            for (const entry of src[policy] || []) {
                if (entryMatches(entry, tool, payload)) matched.push(policy);
            }
        }
        if (matched.length > 0) votes.push(mostRestrictive(matched));
    }
    return mostRestrictive(votes); // empty → 'auto'
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

    /** In-memory session override ("approve always, just this once"). */
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

    /** Pending (unresolved) approvals for a tenant, newest first. */
    async pendingList(projectId) {
        const list = await this.#read(projectId);
        return list.filter((a) => a.status === 'pending').reverse();
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
            status: 'pending', // pending | approved | denied | timeout
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
     */
    async resolve(projectId, id, approved, byUser) {
        const status = approved ? 'approved' : 'denied';
        const record = await this.#settle(projectId, id, status, byUser || 'consultant');

        const inflight = this.pending.get(id);
        if (inflight) {
            if (inflight.timer) clearTimeout(inflight.timer);
            this.pending.delete(id);
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
