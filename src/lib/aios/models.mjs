/**
 * Model capability catalog — declarative, so the dashboard can show each agent's
 * real context window / max output next to its configured model, and flag a model
 * that is unknown or too small for the assigned role.
 *
 * Extend this map when adopting a new model. Values reflect the model cards
 * (see the Claude API model catalog). context_window is the input window in tokens.
 */
export const MODEL_CATALOG = {
  'claude-fable-5': { label: 'Claude Fable 5', context_window: 1_000_000, max_output: 128_000, tier: 'mythos' },
  'claude-mythos-5': { label: 'Claude Mythos 5', context_window: 1_000_000, max_output: 128_000, tier: 'mythos' },
  'claude-opus-4-8': { label: 'Claude Opus 4.8', context_window: 1_000_000, max_output: 128_000, tier: 'opus' },
  'claude-opus-4-7': { label: 'Claude Opus 4.7', context_window: 1_000_000, max_output: 128_000, tier: 'opus' },
  'claude-opus-4-6': { label: 'Claude Opus 4.6', context_window: 1_000_000, max_output: 128_000, tier: 'opus' },
  'claude-sonnet-5': { label: 'Claude Sonnet 5', context_window: 1_000_000, max_output: 128_000, tier: 'sonnet' },
  'claude-sonnet-4-6': { label: 'Claude Sonnet 4.6', context_window: 1_000_000, max_output: 128_000, tier: 'sonnet' },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', context_window: 200_000, max_output: 64_000, tier: 'haiku' },
};

/** Returns catalog info for a model id, or an "unknown" descriptor the UI can flag. */
export function modelInfo(id) {
  const info = MODEL_CATALOG[id];
  if (info) return { id, ...info, known: true };
  return { id, label: id, context_window: null, max_output: null, tier: null, known: false };
}

/** Compact human string, e.g. "1M" / "200K", for token counts. */
export function formatTokens(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
