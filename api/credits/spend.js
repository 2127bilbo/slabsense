/**
 * Spend Credits for Grading
 * Deducts credits before AI grading call
 * Returns a transaction ID for potential refund
 */

import { createClient } from '@supabase/supabase-js';

export const config = {
  maxDuration: 10,
};

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Credit costs
const COSTS = {
  ai: 1,      // Standard AI grade
  deep: 2,    // Deep AI grade
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, gradeType, scanId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (!gradeType || !COSTS[gradeType]) {
      return res.status(400).json({ error: 'Invalid grade type. Use "ai" or "deep"' });
    }

    const cost = COSTS[gradeType];

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('credits_balance, credits_expire_at, subscription_status')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check for lifetime accounts (unlimited)
    const isLifetime = ['lifetime', 'beta_lifetime'].includes(profile.subscription_status);

    if (isLifetime) {
      // Lifetime users don't spend credits, but we still log the usage
      const { data: transaction } = await supabase
        .from('credit_transactions')
        .insert({
          user_id: userId,
          amount: 0,
          transaction_type: gradeType === 'deep' ? 'grade_deep' : 'grade_ai',
          description: `${gradeType === 'deep' ? 'Deep' : 'AI'} grade (lifetime - no charge)`,
          scan_id: scanId || null,
        })
        .select()
        .single();

      return res.status(200).json({
        success: true,
        creditsSpent: 0,
        creditsRemaining: 'unlimited',
        transactionId: transaction?.id,
        isLifetime: true,
      });
    }

    // Check if credits are expired
    const expiresAt = profile.credits_expire_at ? new Date(profile.credits_expire_at) : null;
    const now = new Date();

    if (expiresAt && expiresAt < now) {
      return res.status(402).json({
        error: 'Credits expired',
        message: 'Your credits have expired. Please purchase more to continue.',
        creditsRemaining: 0,
      });
    }

    // Check balance
    const balance = profile.credits_balance || 0;

    if (balance < cost) {
      return res.status(402).json({
        error: 'Insufficient credits',
        message: `You need ${cost} credit${cost > 1 ? 's' : ''} for a ${gradeType} grade. You have ${balance}.`,
        creditsRequired: cost,
        creditsRemaining: balance,
      });
    }

    // Deduct credits
    const newBalance = balance - cost;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ credits_balance: newBalance })
      .eq('id', userId);

    if (updateError) {
      throw updateError;
    }

    // Log transaction
    const { data: transaction, error: transactionError } = await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        amount: -cost,
        transaction_type: gradeType === 'deep' ? 'grade_deep' : 'grade_ai',
        description: `${gradeType === 'deep' ? 'Deep' : 'AI'} grade`,
        scan_id: scanId || null,
      })
      .select()
      .single();

    if (transactionError) {
      console.error('[Spend] Failed to log transaction:', transactionError);
    }

    return res.status(200).json({
      success: true,
      creditsSpent: cost,
      creditsRemaining: newBalance,
      transactionId: transaction?.id,
    });

  } catch (error) {
    console.error('[Spend] Error:', error);
    return res.status(500).json({
      error: 'Failed to process credit spend',
      message: error.message,
    });
  }
}
