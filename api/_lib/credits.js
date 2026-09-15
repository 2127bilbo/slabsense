/**
 * api/_lib/credits.js — credit spend / refund logic shared by the credit endpoints.
 *
 * Preferred path: the atomic database functions from
 * supabase/migrations/20260915_credits_atomic.sql (spend_credits / refund_credits).
 * Until that migration is applied the functions do not exist, so each call falls back to
 * a legacy read-modify-write path that at least fails closed (no charge without a logged,
 * refundable transaction) and refunds each transaction only once.
 *
 * Both entry points take the service-role client as `db` and an already-authenticated
 * user id; they never trust a user id from the request body.
 */
import { GRADE_TIERS } from '../../src/lib/grade-tiers.js';

export const LIFETIME_STATUSES = ['lifetime', 'beta_lifetime'];

export function isMissingFunction(error) {
  if (!error) return false;
  return error.code === '42883' || error.code === 'PGRST202' ||
    /could not find the function|function .* does not exist/i.test(String(error.message || ''));
}

const tierFor = (gradeType) => GRADE_TIERS[gradeType] || null;

// ── spend ────────────────────────────────────────────────────────────────────

/** @returns {Promise<{status:number, body:object}>} */
export async function spendWithDb(db, { userId, gradeType, scanId = null }) {
  const tier = tierFor(gradeType);
  if (!tier) return { status: 400, body: { error: 'Invalid grade type. Use "ai" or "deep"' } };
  if (!userId) return { status: 400, body: { error: 'User ID required' } };

  const { data, error } = await db.rpc('spend_credits', {
    p_user_id: userId, p_grade_type: gradeType, p_cost: tier.credits, p_scan_id: scanId,
  });
  if (!error) return mapSpendResult(data, gradeType, tier);
  if (!isMissingFunction(error)) throw error;
  console.warn('[credits] spend_credits() missing — legacy path; apply 20260915_credits_atomic.sql');
  return legacySpend(db, { userId, gradeType, scanId, tier });
}

function mapSpendResult(r, gradeType, tier) {
  if (!r || typeof r !== 'object') return { status: 500, body: { error: 'Failed to process credit spend' } };
  if (r.success) {
    return {
      status: 200,
      body: {
        success: true,
        creditsSpent: r.credits_spent ?? 0,
        creditsRemaining: r.credits_remaining,
        transactionId: r.transaction_id,
        isLifetime: !!r.is_lifetime,
      },
    };
  }
  switch (r.error) {
    case 'user_not_found': return { status: 404, body: { error: 'User not found' } };
    case 'credits_expired':
      return { status: 402, body: { error: 'Credits expired', message: 'Your credits have expired. Please purchase more to continue.', creditsRemaining: 0 } };
    case 'insufficient_credits':
      return {
        status: 402,
        body: {
          error: 'Insufficient credits',
          message: `You need ${tier.credits} credit${tier.credits > 1 ? 's' : ''} for a ${gradeType} grade. You have ${r.credits_remaining ?? 0}.`,
          creditsRequired: r.credits_required ?? tier.credits,
          creditsRemaining: r.credits_remaining ?? 0,
        },
      };
    default: return { status: 400, body: { error: r.error || 'Invalid request' } };
  }
}

/** Pre-migration path. Fails closed: if the transaction cannot be logged, the balance is restored. */
async function legacySpend(db, { userId, gradeType, scanId, tier }) {
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('credits_balance, credits_expire_at, subscription_status')
    .eq('id', userId)
    .single();
  if (profileError || !profile) return { status: 404, body: { error: 'User not found' } };

  const label = gradeType === 'deep' ? 'Deep' : 'AI';
  if (LIFETIME_STATUSES.includes(profile.subscription_status)) {
    const { data: tx, error: txErr } = await db
      .from('credit_transactions')
      .insert({ user_id: userId, amount: 0, transaction_type: tier.transactionType, description: `${label} grade (lifetime - no charge)`, scan_id: scanId || null })
      .select()
      .single();
    if (txErr || !tx) return { status: 500, body: { error: 'Failed to log transaction' } };
    return { status: 200, body: { success: true, creditsSpent: 0, creditsRemaining: 'unlimited', transactionId: tx.id, isLifetime: true } };
  }

  const expiresAt = profile.credits_expire_at ? new Date(profile.credits_expire_at) : null;
  if (expiresAt && expiresAt < new Date()) {
    return { status: 402, body: { error: 'Credits expired', message: 'Your credits have expired. Please purchase more to continue.', creditsRemaining: 0 } };
  }
  const balance = profile.credits_balance || 0;
  if (balance < tier.credits) {
    return {
      status: 402,
      body: {
        error: 'Insufficient credits',
        message: `You need ${tier.credits} credit${tier.credits > 1 ? 's' : ''} for a ${gradeType} grade. You have ${balance}.`,
        creditsRequired: tier.credits,
        creditsRemaining: balance,
      },
    };
  }

  const newBalance = balance - tier.credits;
  const { error: updateError } = await db.from('profiles').update({ credits_balance: newBalance }).eq('id', userId);
  if (updateError) throw updateError;

  const { data: tx, error: txErr } = await db
    .from('credit_transactions')
    .insert({ user_id: userId, amount: -tier.credits, transaction_type: tier.transactionType, description: `${label} grade`, scan_id: scanId || null })
    .select()
    .single();
  if (txErr || !tx) {
    // No refundable record → give the credit straight back rather than charge silently.
    await db.from('profiles').update({ credits_balance: balance }).eq('id', userId);
    return { status: 500, body: { error: 'Failed to log transaction; no credits were charged' } };
  }
  return { status: 200, body: { success: true, creditsSpent: tier.credits, creditsRemaining: newBalance, transactionId: tx.id, isLifetime: false } };
}

// ── refund ───────────────────────────────────────────────────────────────────

/** @returns {Promise<{status:number, body:object}>} */
export async function refundWithDb(db, { userId, transactionId, reason = null }) {
  if (!userId) return { status: 400, body: { error: 'User ID required' } };
  if (!transactionId) return { status: 400, body: { error: 'Transaction ID required' } };

  const { data, error } = await db.rpc('refund_credits', {
    p_user_id: userId, p_transaction_id: transactionId, p_reason: reason,
  });
  if (!error) return mapRefundResult(data);
  if (!isMissingFunction(error)) throw error;
  console.warn('[credits] refund_credits() missing — legacy path; apply 20260915_credits_atomic.sql');
  return legacyRefund(db, { userId, transactionId, reason });
}

function mapRefundResult(r) {
  if (!r || typeof r !== 'object') return { status: 500, body: { error: 'Failed to process refund' } };
  if (r.success) {
    return { status: 200, body: { success: true, creditsRefunded: r.credits_refunded ?? 0, creditsRemaining: r.credits_remaining, alreadyRefunded: !!r.already_refunded } };
  }
  switch (r.error) {
    case 'transaction_not_found': return { status: 404, body: { error: 'Transaction not found' } };
    case 'not_refundable': return { status: 400, body: { error: 'Transaction is not refundable' } };
    default: return { status: 400, body: { error: r.error || 'Invalid request' } };
  }
}

const marker = (transactionId) => `[tx:${transactionId}]`;

/** Pre-migration path: ownership check, one refund per transaction (marker in the description), no expiry extension. */
async function legacyRefund(db, { userId, transactionId, reason }) {
  const { data: tx } = await db
    .from('credit_transactions')
    .select('id, user_id, amount, transaction_type')
    .eq('id', transactionId)
    .single();
  if (!tx || tx.user_id !== userId) return { status: 404, body: { error: 'Transaction not found' } };
  if (!['grade_ai', 'grade_deep'].includes(tx.transaction_type)) return { status: 400, body: { error: 'Transaction is not refundable' } };

  const { data: prior } = await db
    .from('credit_transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('transaction_type', 'refund')
    .like('description', `%${marker(transactionId)}%`)
    .limit(1);
  if (prior && prior.length) {
    const { data: p } = await db.from('profiles').select('credits_balance').eq('id', userId).single();
    return { status: 200, body: { success: true, creditsRefunded: 0, creditsRemaining: p?.credits_balance ?? 0, alreadyRefunded: true } };
  }

  const amount = Math.abs(tx.amount || 0);
  const { data: profile, error: profileError } = await db.from('profiles').select('credits_balance').eq('id', userId).single();
  if (profileError || !profile) return { status: 404, body: { error: 'User not found' } };
  const newBalance = (profile.credits_balance || 0) + amount;
  if (amount > 0) {
    const { error: updateError } = await db.from('profiles').update({ credits_balance: newBalance }).eq('id', userId);
    if (updateError) throw updateError;
  }
  await db.from('credit_transactions').insert({
    user_id: userId, amount, transaction_type: 'refund',
    description: `${reason || 'Refund: AI grading failed'} ${marker(transactionId)}`,
  });
  return { status: 200, body: { success: true, creditsRefunded: amount, creditsRemaining: amount > 0 ? newBalance : 'unlimited' } };
}
