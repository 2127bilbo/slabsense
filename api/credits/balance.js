/**
 * Get User Credit Balance
 * Returns current credits, expiration, and subscription status
 */

import { createClient } from '@supabase/supabase-js';

export const config = {
  maxDuration: 10,
};

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = req.query.userId || req.body?.userId;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Get user profile
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

    if (error || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if credits are expired
    let balance = profile.credits_balance || 0;
    const expiresAt = profile.credits_expire_at ? new Date(profile.credits_expire_at) : null;
    const now = new Date();

    if (expiresAt && expiresAt < now) {
      // Credits expired - zero out balance
      balance = 0;

      // Update in database
      await supabase
        .from('profiles')
        .update({ credits_balance: 0 })
        .eq('id', userId);

      // Log expiration
      await supabase.from('credit_transactions').insert({
        user_id: userId,
        amount: -(profile.credits_balance || 0),
        transaction_type: 'expired',
        description: 'Credits expired',
      });
    }

    // Calculate days until expiration
    let daysUntilExpiry = null;
    if (expiresAt && expiresAt > now) {
      daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    }

    // Determine tier limits
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
    console.error('[Balance] Error:', error);
    return res.status(500).json({
      error: 'Failed to get balance',
      message: error.message,
    });
  }
}
