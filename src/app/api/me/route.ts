import { requireUser, unauthorized } from '@/lib/apiAuth';

export async function GET(request: Request) {
  const { user } = await requireUser(request);
  if (!user) return unauthorized();
  return Response.json({ user });
}