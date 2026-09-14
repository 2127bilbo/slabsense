/** GET /api/slabs/queue?status=paid|engraved|shipped[&q=] — admin only. */
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, adminIdsFromEnv, sendAuthError } from '../_lib/auth.js';
import { QUEUE_SELECT, flattenQueueRow } from '../_lib/slabs.js';

export const config = { maxDuration: 10 };
const STATUSES = ['paid', 'engraved', 'shipped'];

export function makeHandler({ db, adminIds }) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    try { await requireAdmin({ db, adminIds }, req); } catch (e) { return sendAuthError(res, e); }
    const status = String(req.query?.status || 'paid');
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'bad_status' });
    const q = String(req.query?.q || '').trim().toLowerCase();
    const { data, error } = await db.from('slabs').select(QUEUE_SELECT).eq('status', status)
      .order('paid_at', { ascending: status === 'paid' }).limit(200);
    if (error) { console.error('[slabs/queue]', error); return res.status(500).json({ error: 'query_failed' }); }
    let rows = (data || []).map(flattenQueueRow);
    if (q) rows = rows.filter((r) => r.cert.toLowerCase().includes(q) || String(r.scan?.card_name || '').toLowerCase().includes(q));
    return res.status(200).json({ rows });
  };
}
const supabase = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://localhost', process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing');
export default makeHandler({ db: supabase, adminIds: adminIdsFromEnv(process.env) });
