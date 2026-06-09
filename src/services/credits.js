/**
 * Credits Service
 * Handles credit balance, spending, and purchases
 */

const API_BASE = import.meta.env.PROD ? '' : '';

/**
 * Get user's credit balance and subscription info
 */
export async function getCreditsBalance(userId) {
  try {
    const response = await fetch(`${API_BASE}/api/credits/balance?userId=${userId}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get balance');
    }

    return data;
  } catch (error) {
    console.error('[Credits] Balance error:', error);
    throw error;
  }
}

/**
 * Spend credits for grading
 * @param {string} userId
 * @param {'ai' | 'deep'} gradeType
 * @param {string} scanId - Optional scan ID for tracking
 * @returns {Promise<{success: boolean, creditsSpent: number, creditsRemaining: number, transactionId: string}>}
 */
export async function spendCredits(userId, gradeType, scanId = null) {
  try {
    const response = await fetch(`${API_BASE}/api/credits/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, gradeType, scanId }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Return error info for UI handling
      return {
        success: false,
        error: data.error,
        message: data.message,
        creditsRequired: data.creditsRequired,
        creditsRemaining: data.creditsRemaining,
      };
    }

    return {
      success: true,
      ...data,
    };
  } catch (error) {
    console.error('[Credits] Spend error:', error);
    return {
      success: false,
      error: 'Network error',
      message: 'Failed to connect to server',
    };
  }
}

/**
 * Refund credits (called when AI grading fails)
 */
export async function refundCredits(userId, transactionId, amount = null, reason = null) {
  try {
    const response = await fetch(`${API_BASE}/api/credits/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, transactionId, amount, reason }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to refund');
    }

    return data;
  } catch (error) {
    console.error('[Credits] Refund error:', error);
    throw error;
  }
}

/**
 * Create checkout session for purchase
 * @param {string} userId
 * @param {string} priceKey - 'trial', 'hobby', 'pro', 'dealer', 'single', 'pack_10', etc.
 * @param {number} quantity - For singles only
 */
export async function createCheckout(userId, priceKey, quantity = 1) {
  try {
    const response = await fetch(`${API_BASE}/api/stripe/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        priceKey,
        quantity,
        successUrl: `${window.location.origin}/billing?success=true`,
        cancelUrl: `${window.location.origin}/billing?canceled=true`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create checkout');
    }

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        returnUrl: `${window.location.origin}/settings`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to open portal');
    }

    // Redirect to Stripe portal
    window.location.href = data.url;
  } catch (error) {
    console.error('[Credits] Portal error:', error);
    throw error;
  }
}

/**
 * Credit costs for display
 */
export const CREDIT_COSTS = {
  ai: 1,
  deep: 2,
};

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
