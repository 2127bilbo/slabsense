/**
 * /api/slabs — one serverless function for every slab route (Vercel Hobby allows 12 per deployment).
 *   GET  /api/slab?cert=…            → action "get"    (public cert read; rewritten in vercel.json)
 *   GET  /api/slabs/config           → action "config" (public Supabase URL + anon key for the studio)
 *   GET  /api/slabs/queue?status=…   → action "queue"  (admin)
 *   POST /api/slabs/status           → action "status" (admin)
 * vercel.json rewrites /api/slabs/:action → /api/slabs?action=:action and /api/slab → /api/slabs?action=get.
 */
import { createClient } from '@supabase/supabase-js';
import { adminIdsFromEnv } from './_lib/auth.js';
import { makeHandler as makeGet } from './_lib/routes/slab-get.js';
import { makeHandler as makeConfig } from './_lib/routes/slabs-config.js';
import { makeHandler as makeQueue } from './_lib/routes/slabs-queue.js';
import { makeHandler as makeStatus } from './_lib/routes/slabs-status.js';

export const config = { maxDuration: 10 };

export function makeHandler({ db, adminIds, env }) {
  const handlers = {
    get: makeGet(db),
    config: makeConfig({ env }),
    queue: makeQueue({ db, adminIds }),
    status: makeStatus({ db, adminIds }),
  };
  return async function handler(req, res) {
    const action = String(req.query?.action || 'get');
    const fn = handlers[action];
    if (!fn) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(404).json({ error: 'not_found' });
    }
    return fn(req, res);
  };
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://localhost',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing'
);
export default makeHandler({ db: supabase, adminIds: adminIdsFromEnv(process.env), env: process.env });
