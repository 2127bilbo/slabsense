/**
 * Refund Credits
 * Called when AI grading fails after credits were deducted
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, transactionId, amount, reason } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (!transactionId && !amount) {
      return res.status(400).json({ error: 'Transaction ID or amount required' });
    }

    let refundAmount = amount;

    // If transaction ID provided, look up the original amount
    if (transactionId) {
      const { data: originalTx } = await supabase
        .from('credit_transactions')
        .select('amount')
        .eq('id', transactionId)
        .single();

      if (originalTx) {
        // Original amount is negative, so negate it for refund
        refundAmount = Math.abs(originalTx.amount);
      }
    }

    if (!refundAmount || refundAmount <= 0) {
      return res.status(400).json({ error: 'Invalid refund amount' });
    }

    // Get current balance
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('credits_balance, credits_expire_at')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Add credits back
    const newBalance = (profile.credits_balance || 0) + refundAmount;

    // Extend expiration if it was expired
    const now = new Date();
    const expiresAt = profile.credits_expire_at ? new Date(profile.credits_expire_at) : null;
    const newExpiresAt = (!expiresAt || expiresAt < now)
      ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      : expiresAt;

    await supabase
      .from('profiles')
      .update({
        credits_balance: newBalance,
        credits_expire_at: newExpiresAt,
      })
      .eq('id', userId);

    // Log refund transaction
    await supabase.from('credit_transactions').insert({
      user_id: userId,
      amount: refundAmount,
      transaction_type: 'refund',
      description: reason || 'Refund: AI grading failed',
    });

    return res.status(200).json({
      success: true,
      creditsRefunded: refundAmount,
      creditsRemaining: newBalance,
    });

  } catch (error) {
    console.error('[Refund] Error:', error);
    return res.status(500).json({
      error: 'Failed to process refund',
      message: error.message,
    });
  }
}
