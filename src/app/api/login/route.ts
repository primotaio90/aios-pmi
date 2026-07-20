import { getSystem } from '@/lib/aios/system.mjs';
import { requireUser } from '@/lib/apiAuth';

export async function POST(request: Request) {
  const sys = await getSystem();
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body JSON richiesto' }, { status: 400 });
  }
  const result = await sys.auth.login(body.username || '', body.password || '');
  if (!result) {
    return Response.json({ error: 'Credenziali non valide o account disabilitato' }, { status: 401 });
  }
  return Response.json(
    { user: result.user },
    {
      headers: {
        'Set-Cookie': `aios_token=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      },
    }
  );
}

export async function DELETE(request: Request) {
  const { sys, token } = await requireUser(request);
  if (token) sys.auth.logout(token);
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': 'aios_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' } }
  );
}