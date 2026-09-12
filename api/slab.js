/**
 * GET /api/slab?cert=SS26-00001
 * Public read of one slab through the slab_public view (no user id, no shipping — see migration 20260912_slabs.sql).
 */
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 10 };

const CERT_RE = /^[A-Z]{2,4}\d{2}-\d{5}$/;

export function makeHandler(db) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const cert = String(req.query?.cert || '').trim().toUpperCase();
    if (!cert) return res.status(400).json({ error: 'cert_required' });
    if (!CERT_RE.test(cert)) return res.status(404).json({ error: 'not_found' });

    const { data, error } = await db.from('slab_public').select('*').eq('cert', cert).maybeSingle();
    if (error) {
      console.error('[api/slab] query failed:', error);
      return res.status(500).json({ error: 'query_failed' });
    }
    if (!data) return res.status(404).json({ error: 'not_found' });

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ slab: data });
  };
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://localhost',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing'
);
export default makeHandler(supabase);
