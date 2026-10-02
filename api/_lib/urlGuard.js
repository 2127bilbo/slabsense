/**
 * Redirect-URL guard for the Stripe routes: a success/cancel/return URL supplied by the
 * client is used only when it points at one of our own origins (audit G-04: open redirect).
 */

/** Origins the app may be served from: VITE_APP_URL plus the production hosts. */
export function allowedOrigins(env = process.env) {
  const set = new Set(['https://www.slabsenseai.com', 'https://slabsenseai.com']);
  for (const key of ['VITE_APP_URL', 'APP_URL']) {
    const v = env[key];
    if (!v) continue;
    try { set.add(new URL(v).origin); } catch { /* ignore malformed */ }
  }
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_URL) set.add(`https://${env.VERCEL_URL}`);
  if (env.NODE_ENV !== 'production') { set.add('http://localhost:5173'); set.add('http://localhost:5174'); set.add('http://localhost:5175'); }
  return set;
}

/**
 * The candidate URL if it is http(s) and its origin is allowed, else null.
 * @param {unknown} candidate
 * @param {Set<string>|string[]} origins
 */
export function sameOriginUrl(candidate, origins = allowedOrigins()) {
  if (typeof candidate !== 'string' || candidate.length > 2048) return null;
  let u;
  try { u = new URL(candidate); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const allowed = origins instanceof Set ? origins : new Set(origins);
  return allowed.has(u.origin) ? u.toString() : null;
}

/** An integer quantity clamped to [min, max]; non-numbers become min. */
export function clampQuantity(q, min = 1, max = 50) {
  const n = Number.parseInt(q, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
