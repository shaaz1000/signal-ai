import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { AUTH_UNAVAILABLE_MESSAGE, authSecret, getCurrentUser } from '@/lib/security/auth';
import { setFlag, SETTABLE_FLAGS } from '@/lib/security/flags';
import { crossSite, jsonError, jsonOk, readJson } from '@/lib/security/http';
import { limited } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ key: z.enum(SETTABLE_FLAGS), value: z.boolean() }).strict();

/** POST /api/admin/flags { key: 'generation_disabled', value }: admins only. Every change is written to the audit log. */
export async function POST(request: Request) {
  const blocked = limited(request.headers) ?? crossSite(request);
  if (blocked) return blocked;
  const body = await readJson(request, Body, 512);
  if (!body.ok) return body.response;
  const env = process.env;
  if (!authSecret(env)) return jsonError(503, 'auth_unavailable', AUTH_UNAVAILABLE_MESSAGE);
  try {
    const db = await getDb();
    const user = await getCurrentUser(db, request, env);
    if (!user) return jsonError(401, 'unauthenticated', 'Sign in to continue.');
    if (user.role !== 'admin') return jsonError(403, 'forbidden', 'This action needs an administrator.');
    await setFlag(db, { key: body.data.key, value: body.data.value, actor: `user:${user.id}` });
    return jsonOk({ key: body.data.key, value: body.data.value });
  } catch {
    return jsonError(503, 'unavailable', 'The flag could not be changed.', 30);
  }
}
