/**
 * Operating-mode catalog (require the aios_token cookie).
 *   GET /api/modes   → { modes }
 *
 * Static, secret-free catalog read from src/lib/aios/modes.mjs: `listModes()`
 * strips the system-prompt overlay, so only what the UI needs is exposed.
 * `requireUser` is here for the session guard alone (the system singleton is
 * not needed to serve a declarative catalog).
 */
import { requireUser, unauthorized } from '@/lib/apiAuth';
import type { NextRequest } from 'next/server';
import { listModes } from '@/lib/aios/modes.mjs';

export async function GET(request: NextRequest) {
  const { user } = await requireUser(request);
  if (!user) return unauthorized();
  try {
    return Response.json({ modes: listModes() });
  } catch (err) {
    return Response.json({ error: String((err as Error).message || err) }, { status: 500 });
  }
}
