/**
 * GET/POST /api/credits/balance
 * Returns the authenticated user's credits, expiration, and subscription status.
 * The user comes from the Supabase JWT; a userId in the query/body must match it.
 */
import { createClient } from '@supabase/supabase-js';
import { requireUser, AuthError, sendAuthError } from '../_lib/auth.js';

export const config = { maxDuration: 10 };

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await requireUser({ db: supabase }, req);
    const requested = req.query?.userId || req.body?.userId;
    if (requested && requested !== user.id) return res.status(403).json({ error: 'forbidden' });
    const userId = user.id;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select(`
        credits_balance,
        credits_expire_at,
        subscription_status,
        subscription_renews_at,
        used_trial,
        signup_bonus_eligible,
        cards_saved_count
      `)
      .eq('id', userId)
      .single();
    if (error || !profile) return res.status(404).json({ error: 'User not found' });

    let balance = profile.credits_balance || 0;
    const expiresAt = profile.credits_expire_at ? new Date(profile.credits_expire_at) : null;
    const now = new Date();

    if (expiresAt && expiresAt < now && balance > 0) {
      // Credits expired: zero the balance once and log it
      balance = 0;
      await supabase.from('profiles').update({ credits_balance: 0 }).eq('id', userId);
      await supabase.from('credit_transactions').insert({
        user_id: userId,
        amount: -(profile.credits_balance || 0),
        transaction_type: 'expired',
        description: 'Credits expired',
      });
    }

    let daysUntilExpiry = null;
    if (expiresAt && expiresAt > now) daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

    const isLifetime = ['lifetime', 'beta_lifetime'].includes(profile.subscription_status);
    const isFree = profile.subscription_status === 'free';
    const cardLimit = isFree ? 5 : null; // null = unlimited

    return res.status(200).json({
      success: true,
      credits: balance,
      expiresAt: expiresAt?.toISOString() || null,
      daysUntilExpiry,
      subscription: profile.subscription_status,
      renewsAt: profile.subscription_renews_at,
      trialUsed: profile.used_trial,
      bonusEligible: profile.signup_bonus_eligible,
      cardsSaved: profile.cards_saved_count || 0,
      cardLimit,
      canSaveMore: cardLimit === null || (profile.cards_saved_count || 0) < cardLimit,
      isLifetime,
      canUseAI: !isFree || isLifetime,
    });
  } catch (error) {
    if (error instanceof AuthError) return sendAuthError(res, error);
    console.error('[Balance] Error:', error);
    return res.status(500).json({ error: 'Failed to get balance', message: error.message });
  }
}
