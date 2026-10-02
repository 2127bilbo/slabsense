/**
 * ============================================================================
 * ROUTE HELPERS — route.js (audit D-15)
 * ============================================================================
 * One service-role client factory and one wrapper for the routes that all did the same thing:
 * CORS headers, OPTIONS, method check, bearer-token user, "body userId must match the token",
 * AuthError → 401/403, anything else → 500 with a short message. Routes keep only their logic.
 *
 *   export default userRoute({ label: 'Spend' }, async ({ req, res, db, user }) => { ... });
 * ============================================================================
 */
import { createClient } from '@supabase/supabase-js';
import { requireUser, AuthError, sendAuthError } from './auth.js';

/** Service-role Supabase client (API only). Throws when the server is not configured. */
export function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('server_not_configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** CORS + preflight. `origin: null` sends no Allow-Origin (same-origin routes). Returns true when handled. */
export function preflight(req, res, { methods = ['POST'], origin = '*' } = {}) {
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  if (!methods.includes(req.method)) { res.status(405).json({ error: 'Method not allowed' }); return true; }
  return false;
}

/**
 * A route that needs a signed-in user.
 * @param {object} opts
 * @param {string[]} [opts.methods=['POST']]
 * @param {string|null} [opts.origin='*']
 * @param {string} opts.label           log prefix and the 500 message ("<label> failed")
 * @param {object} [opts.db]            injected client (tests); default serviceDb()
 * @param {(ctx: {req, res, db, user}) => Promise<any>} fn
 */
export function userRoute({ methods = ['POST'], origin = '*', label = 'api', db = null } = {}, fn) {
  return async function handler(req, res) {
    if (preflight(req, res, { methods, origin })) return;
    let client;
    try { client = db || serviceDb(); } catch { return res.status(500).json({ error: 'server_not_configured' }); }
    try {
      const user = await requireUser({ db: client }, req);
      // Older clients still send userId; it may only ever be the caller's own id.
      const claimed = req.body?.userId || req.query?.userId;
      if (claimed && claimed !== user.id) return res.status(403).json({ error: 'forbidden' });
      return await fn({ req, res, db: client, user });
    } catch (error) {
      if (error instanceof AuthError) return sendAuthError(res, error);
      console.error(`[${label}] Error:`, error);
      return res.status(500).json({ error: `${label} failed`, message: error.message });
    }
  };
}
