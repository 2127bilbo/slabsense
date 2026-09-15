/**
 * Credits Service
 * Balance, purchases, and the read side of AI grade jobs. Every request carries the
 * user's Supabase JWT; the server derives the user from it (a userId in the body must match).
 * Spending and refunding for grades happen SERVER-SIDE inside the grade endpoints now
 * (api/_lib/gradeJobs.js) — the client no longer calls spend/refund for grading.
 */
import { supabase } from './supabase.js';
import { GRADE_TIERS } from '../lib/grade-tiers.js';

const API_BASE = '';

async function authHeaders() {
  if (!supabase) return {};
  const { data: { session } } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

/**
 * Get user's credit balance and subscription info
 */
export async function getCreditsBalance(userId) {
  try {
    const response = await fetch(`${API_BASE}/api/credits/balance?userId=${encodeURIComponent(userId)}`, { headers: await authHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to get balance');
    return data;
  } catch (error) {
    console.error('[Credits] Balance error:', error);
    throw error;
  }
}

/**
 * Spend credits (kept for non-grade uses; grade endpoints spend for themselves)
 * @param {'ai' | 'deep'} gradeType
 */
export async function spendCredits(userId, gradeType, scanId = null) {
  try {
    const response = await fetch(`${API_BASE}/api/credits/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ userId, gradeType, scanId }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error, message: data.message, creditsRequired: data.creditsRequired, creditsRemaining: data.creditsRemaining };
    }
    return { success: true, ...data };
  } catch (error) {
    console.error('[Credits] Spend error:', error);
    return { success: false, error: 'Network error', message: 'Failed to connect to server' };
  }
}

/**
 * Refund one grade transaction (idempotent server-side)
 */
export async function refundCredits(userId, transactionId, reason = null) {
  try {
    const response = await fetch(`${API_BASE}/api/credits/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ userId, transactionId, reason }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to refund');
    return data;
  } catch (error) {
    console.error('[Credits] Refund error:', error);
    throw error;
  }
}

/**
 * Read one AI grade job (own jobs only, via RLS). Returns null when missing or not readable.
 * @returns {Promise<null | { id, status: 'queued'|'running'|'done'|'error', grade_type, card_key, request, result, error, created_at, finished_at }>}
 */
export async function getGradeJob(jobId) {
  if (!supabase || !jobId) return null;
  const { data, error } = await supabase
    .from('ai_grade_jobs')
    .select('id, status, grade_type, card_key, request, result, error, created_at, finished_at')
    .eq('id', jobId)
    .maybeSingle();
  if (error) { console.warn('[Credits] getGradeJob:', error.message); return null; }
  return data || null;
}

/**
 * Create checkout session for purchase
 * @param {string} priceKey - 'trial', 'hobby', 'pro', 'dealer', 'single', 'pack_10', etc.
 * @param {number} quantity - For singles only
 */
export async function createCheckout(userId, priceKey, quantity = 1) {
  try {
    const response = await fetch(`${API_BASE}/api/stripe/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        userId,
        priceKey,
        quantity,
        successUrl: `${window.location.origin}/billing?success=true`,
        cancelUrl: `${window.location.origin}/billing?canceled=true`,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to create checkout');
    return data;
  } catch (error) {
    console.error('[Credits] Checkout error:', error);
    throw error;
  }
}

/**
 * Open Stripe customer portal for subscription management
 */
export async function openCustomerPortal(userId) {
  try {
    const response = await fetch(`${API_BASE}/api/stripe/create-portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ userId, returnUrl: `${window.location.origin}/settings` }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to open portal');
    window.location.href = data.url;
  } catch (error) {
    console.error('[Credits] Portal error:', error);
    throw error;
  }
}

/** Credit costs for display — single source: src/lib/grade-tiers.js */
export const CREDIT_COSTS = { ai: GRADE_TIERS.ai.credits, deep: GRADE_TIERS.deep.credits };

/**
 * Subscription tier info for display
 */
export const SUBSCRIPTION_TIERS = {
  trial: { name: '7-Day Trial', price: 4.99, credits: 5, period: 'once' },
  hobby: { name: 'Hobby Collector', price: 9.99, credits: 10, period: 'month' },
  pro: { name: 'Pro Collector', price: 19.99, credits: 30, period: 'month' },
  dealer: { name: 'Dealer', price: 49.99, credits: 100, period: 'month' },
};

/**
 * Bundle info for display
 */
export const CREDIT_BUNDLES = {
  single: { name: 'Single Credit', price: 1.99, credits: 1 },
  pack_10: { name: '10 Credit Pack', price: 14.99, credits: 10 },
  pack_20: { name: '20 Credit Pack', price: 29.99, credits: 20 },
  pack_30: { name: '30 Credit Pack', price: 39.99, credits: 30 },
  pack_50: { name: '50 Credit Pack', price: 49.99, credits: 50 },
};
