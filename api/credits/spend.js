/**
 * POST /api/credits/spend  { gradeType: 'ai' | 'deep', scanId? }
 * Deducts credits before an AI grade. The user comes from the Supabase JWT in the
 * Authorization header — never from the body. Returns a transactionId for refunds.
 * Logic lives in api/_lib/credits.js (atomic RPC, legacy fallback pre-migration).
 */
import { createClient } from '@supabase/supabase-js';
import { requireUser, AuthError, sendAuthError } from '../_lib/auth.js';
import { spendWithDb } from '../_lib/credits.js';

export const config = { maxDuration: 10 };

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await requireUser({ db: supabase }, req);
    const { gradeType, scanId, userId } = req.body || {};
    if (userId && userId !== user.id) return res.status(403).json({ error: 'forbidden' });
    const { status, body } = await spendWithDb(supabase, { userId: user.id, gradeType, scanId: scanId || null });
    return res.status(status).json(body);
  } catch (error) {
    if (error instanceof AuthError) return sendAuthError(res, error);
    console.error('[Spend] Error:', error);
    return res.status(500).json({ error: 'Failed to process credit spend', message: error.message });
  }
}
