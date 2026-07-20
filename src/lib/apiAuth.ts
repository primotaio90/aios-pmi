import { getSystem } from '@/lib/aios/system.mjs';

export type SessionUser = { username: string; name: string; role: string; since: string };

/**
 * Shared auth guard for the API routes: resolves the system singleton and the
 * session user from the aios_token httpOnly cookie. user === null → 401.
 */
export async function requireUser(request: Request) {
  const sys = await getSystem();
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)aios_token=([^;]+)/);
  const token = match ? match[1] : null;
  const user: SessionUser | null = sys.auth.check(token);
  return { sys, user, token };
}

export function unauthorized() {
  return Response.json({ error: 'Autenticazione richiesta' }, { status: 401 });
}