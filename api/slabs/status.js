/** POST /api/slabs/status — admin only. {cert,status:'engraved',svg,label_text,label_settings} | {cert,status:'shipped'} */
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, adminIdsFromEnv, sendAuthError } from '../_lib/auth.js';
import { assertTransition, statusPatch, sanitizeSettings, SLAB_LABEL_BUCKET } from '../_lib/slabs.js';

export const config = { maxDuration: 10 };

export function makeHandler({ db, adminIds, now }) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    try { await requireAdmin({ db, adminIds }, req); } catch (e) { return sendAuthError(res, e); }
    const body = req.body || {};
    const cert = String(body.cert || '').trim().toUpperCase();
    const to = String(body.status || '');
    if (!cert) return res.status(400).json({ error: 'cert_required' });
    const { data: slab, error } = await db.from('slabs').select('*').eq('cert', cert).maybeSingle();
    if (error) { console.error('[slabs/status]', error); return res.status(500).json({ error: 'query_failed' }); }
    if (!slab) return res.status(404).json({ error: 'not_found' });
    try { assertTransition(slab.status, to); } catch { return res.status(409).json({ error: 'bad_transition', from: slab.status }); }
    const patch = statusPatch(to, now ? now() : new Date());
    if (to === 'engraved') {
      if (typeof body.svg !== 'string' || !body.svg.startsWith('<?xml')) return res.status(400).json({ error: 'svg_required' });
      if (!body.label_text || typeof body.label_text !== 'object') return res.status(400).json({ error: 'label_text_required' });
      if (body.label_text.cert !== cert) return res.status(400).json({ error: 'label_text_mismatch' });
      const path = `${cert}.svg`;
      const up = await db.storage.from(SLAB_LABEL_BUCKET).upload(path, body.svg, { contentType: 'image/svg+xml', upsert: true });
      if (up.error) { console.error('[slabs/status] upload', up.error); return res.status(500).json({ error: 'upload_failed' }); }
      patch.label_svg_path = path;
      patch.label_text = body.label_text;
      patch.label_settings = sanitizeSettings(body.label_settings);
    }
    const upd = await db.from('slabs').update(patch).eq('cert', cert).eq('status', slab.status);
    if (upd.error) { console.error('[slabs/status] update', upd.error); return res.status(500).json({ error: 'update_failed' }); }
    return res.status(200).json({ slab: { ...slab, ...patch } });
  };
}
const supabase = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://localhost', process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing');
export default makeHandler({ db: supabase, adminIds: adminIdsFromEnv(process.env) });
