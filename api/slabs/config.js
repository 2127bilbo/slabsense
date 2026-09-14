/** GET /api/slabs/config — public Supabase connection values for the static studio page. */
export const config = { maxDuration: 5 };
export function makeHandler({ env }) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    return res.status(200).json({ supabaseUrl: env.VITE_SUPABASE_URL || env.SUPABASE_URL || '', anonKey: env.VITE_SUPABASE_ANON_KEY || '' });
  };
}
export default makeHandler({ env: process.env });
