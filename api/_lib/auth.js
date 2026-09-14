/** api/_lib/auth.js — Supabase JWT verification for serverless routes. Inject `db` (service-role client). */
export class AuthError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

export function bearerToken(req) {
  const h = req.headers?.authorization ?? req.headers?.Authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1] : null;
}

export async function requireUser({ db }, req) {
  const token = bearerToken(req);
  if (!token) throw new AuthError(401, 'unauthorized');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) throw new AuthError(401, 'unauthorized');
  return { id: data.user.id, email: data.user.email };
}

export function adminIdsFromEnv(env) {
  return new Set(String(env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
}

export async function requireAdmin({ db, adminIds }, req) {
  const user = await requireUser({ db }, req);
  if (!adminIds.has(user.id)) throw new AuthError(403, 'forbidden');
  return user;
}

export function sendAuthError(res, err) {
  if (err instanceof AuthError) return res.status(err.status).json({ error: err.code });
  throw err;
}
