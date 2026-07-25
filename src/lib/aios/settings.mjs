/**
 * Global LLM settings — the runtime source of truth the dashboard can edit.
 *
 * Historically the runner mode and credentials were frozen at boot from env
 * (AIOS_RUNNER, ANTHROPIC_API_KEY). This module lets the UI change provider,
 * base URL, API keys, model and generation params WITHOUT a restart: the
 * dispatcher runner (system.mjs) and the LLM runner read getSettings() per call.
 *
 * Persisted to config/llm_settings.local.json (gitignored). Env stays as a
 * fallback (see resolveProvider). Secrets are never returned to the client in
 * clear — the API route uses publicSettings() which masks them.
 *
 * NOTE: on serverless (Vercel) the FS is read-only, so writes won't persist in
 * production — same caveat as the rest of the AIOS state (see docs/DEPLOY.md).
 * On a persistent host (Fly.io) the file lives on the mounted volume via
 * AIOS_ROOT (see docs/DEPLOY.md).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveRoot } from './paths.mjs';

const SETTINGS_PATH = path.join(resolveRoot(), 'config', 'llm_settings.local.json');

export const PROVIDERS = ['mock', 'anthropic', 'openai'];
const MASK = '••••••••';

/** Factory so the env-derived default is re-evaluated each read. */
function defaults() {
  return {
    provider: process.env.AIOS_RUNNER === 'claude' ? 'anthropic' : 'mock',
    anthropic: { baseURL: '', apiKey: '', model: 'claude-opus-4-8' },
    openai: { baseURL: '', apiKey: '', model: '' },
    params: { temperature: null, maxTokens: 8192, thinking: true },
    agentModelOverrides: {},
  };
}

/** Deep-merges a (possibly partial, client-supplied) patch over a base config. */
function mergeSettings(base, patch) {
  const out = {
    ...base,
    anthropic: { ...base.anthropic },
    openai: { ...base.openai },
    params: { ...base.params },
    agentModelOverrides: { ...base.agentModelOverrides },
  };
  if (patch.provider && PROVIDERS.includes(patch.provider)) out.provider = patch.provider;

  for (const p of ['anthropic', 'openai']) {
    const src = patch[p];
    if (!src || typeof src !== 'object') continue;
    if (typeof src.baseURL === 'string') out[p].baseURL = src.baseURL.trim();
    if (typeof src.model === 'string') out[p].model = src.model.trim();
    // Only overwrite the key with a real, non-masked value. Empty string /
    // the mask sentinel means "leave the stored key unchanged".
    const key = src.apiKey;
    if (typeof key === 'string' && key.trim() && !key.includes('•') && key !== MASK) {
      out[p].apiKey = key.trim();
    }
  }

  if (patch.params && typeof patch.params === 'object') {
    const pp = patch.params;
    if ('temperature' in pp) {
      out.params.temperature =
        pp.temperature === null || pp.temperature === '' || pp.temperature === undefined
          ? null
          : Number(pp.temperature);
    }
    if ('maxTokens' in pp) out.params.maxTokens = Number(pp.maxTokens) || base.params.maxTokens;
    if ('thinking' in pp) out.params.thinking = Boolean(pp.thinking);
  }

  if (patch.agentModelOverrides && typeof patch.agentModelOverrides === 'object') {
    // The UI sends the full map; replace wholesale, dropping empty values.
    out.agentModelOverrides = {};
    for (const [id, model] of Object.entries(patch.agentModelOverrides)) {
      if (typeof model === 'string' && model.trim()) out.agentModelOverrides[id] = model.trim();
    }
  }
  return out;
}

let cache = null;
let cacheMtime = -1;

/** Current effective settings (file over env-derived defaults), cached by mtime. */
export async function getSettings() {
  try {
    const stat = await fs.stat(SETTINGS_PATH);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
    const raw = await fs.readFile(SETTINGS_PATH, 'utf-8');
    cache = mergeSettings(defaults(), JSON.parse(raw));
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch {
    // No file yet → defaults; do not pin an mtime so the next write is picked up.
    cache = defaults();
    cacheMtime = -1;
    return cache;
  }
}

/** Merges a patch, persists it and refreshes the cache. Returns the new config. */
export async function saveSettings(patch) {
  const current = await getSettings();
  const next = mergeSettings(current, patch || {});
  await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2));
  cache = next;
  try {
    cacheMtime = (await fs.stat(SETTINGS_PATH)).mtimeMs;
  } catch {
    cacheMtime = -1;
  }
  return next;
}

/** Client-safe view: API keys masked, plus whether an env key is available. */
export async function publicSettings() {
  const s = await getSettings();
  const mask = (key, envName) => ({
    set: Boolean(key),
    hint: key ? `${MASK}${key.slice(-4)}` : '',
    env: Boolean(process.env[envName]),
  });
  return {
    provider: s.provider,
    anthropic: { baseURL: s.anthropic.baseURL, model: s.anthropic.model, apiKey: mask(s.anthropic.apiKey, 'ANTHROPIC_API_KEY') },
    openai: { baseURL: s.openai.baseURL, model: s.openai.model, apiKey: mask(s.openai.apiKey, 'OPENAI_API_KEY') },
    params: s.params,
    agentModelOverrides: s.agentModelOverrides,
  };
}

/** Resolves the concrete { provider, baseURL, apiKey } for the active provider,
 *  applying env fallback for the key. Used by the LLM runner. */
export function providerConfig(settings) {
  if (settings.provider === 'openai') {
    return {
      provider: 'openai',
      baseURL: settings.openai.baseURL || undefined,
      apiKey: settings.openai.apiKey || process.env.OPENAI_API_KEY || '',
    };
  }
  return {
    provider: 'anthropic',
    baseURL: settings.anthropic.baseURL || undefined,
    apiKey: settings.anthropic.apiKey || process.env.ANTHROPIC_API_KEY || '',
  };
}

/** Resolves the model for one agent: per-agent override → provider default /
 *  frontmatter model. OpenAI endpoints can't use Claude ids, so the configured
 *  openai.model wins there unless a per-agent override is set. */
export function modelFor(agent, settings) {
  const override = settings.agentModelOverrides?.[agent?.id];
  if (override) return override;
  if (settings.provider === 'openai') return settings.openai.model || agent?.model || '';
  return agent?.model || settings.anthropic.model;
}
