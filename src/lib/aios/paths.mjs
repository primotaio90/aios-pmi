/**
 * Single resolution point for the AIOS data root (the directory that holds
 * projects/, agents/, mcp/, config/).
 *
 * Priority:
 *   1. `AIOS_ROOT` env var — explicit override, set in containers / deploys
 *      where the data root is a mounted volume or a different layout.
 *   2. Fallback: three levels above this module (src/lib/aios/ → repo root),
 *      which is what `next dev` and the default `next start` both resolve to
 *      (Next rewrites import.meta.url to the *source* file path, so the
 *      relative climb keeps working inside .next/server chunks).
 *
 * Centralised here so system.mjs and settings.mjs can never drift apart again
 * (they previously computed the same value independently).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FALLBACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function resolveRoot() {
  const fromEnv = process.env.AIOS_ROOT;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }
  return FALLBACK;
}
