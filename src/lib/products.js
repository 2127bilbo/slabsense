/**
 * ============================================================================
 * PRODUCT CATALOGUE — products.js (shared by client and API)
 * ============================================================================
 * One paid thing: the AI Grade (decision 2026-10-02: a single paid tier built on
 * the Deep flow; the free tier keeps the software grade). It is sold two ways:
 *
 *   - a monthly subscription with an allowance of AI Grades that renews each period
 *   - a consumable pack of AI Grades that never expires
 *
 * Apple product ids are what App Store Connect must contain (3b); Stripe price keys
 * are what the website keeps using. Credits are "AI Grades": one credit = one grade.
 * Prices here are display defaults for the web; the native app shows the price
 * StoreKit returns, never these numbers.
 *
 * Owner sets the final numbers in Phase 2 (price table); the ids must not change
 * once products exist in App Store Connect.
 * ============================================================================
 */
export const APPLE_BUNDLE_ID = 'com.slabsense.app';

export const PRODUCTS = {
  sub_monthly: {
    kind: 'subscription',           // auto-renewable
    name: 'SlabSense Plus',
    allowance: 15,                  // AI Grades granted each period
    period: 'month',
    appleId: 'com.slabsense.app.plus.monthly',
    stripeKey: 'hobby',             // existing STRIPE_PRICE_HOBBY until the web catalogue is re-cut
    webPrice: 9.99,
    tagline: '15 AI Grades every month',
  },
  pack_5: {
    kind: 'consumable',
    name: '5 AI Grades',
    credits: 5,
    appleId: 'com.slabsense.app.grades.5',
    stripeKey: 'pack_10',           // nearest existing web pack until re-cut
    webPrice: 7.99,
    tagline: 'Never expire',
  },
  pack_20: {
    kind: 'consumable',
    name: '20 AI Grades',
    credits: 20,
    appleId: 'com.slabsense.app.grades.20',
    stripeKey: 'pack_20',
    webPrice: 24.99,
    tagline: 'Never expire · best value',
  },
};

/** Product by Apple product id. */
export function productByAppleId(appleId) {
  return Object.entries(PRODUCTS).find(([, p]) => p.appleId === appleId)?.[1] || null;
}
export function productKeyByAppleId(appleId) {
  return Object.entries(PRODUCTS).find(([, p]) => p.appleId === appleId)?.[0] || null;
}

/** Apple's required subscription disclosure, shown wherever a subscription is offered. */
export const APPLE_SUBSCRIPTION_TERMS =
  'Payment is charged to your Apple ID at confirmation of purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period, and your account is charged for renewal within 24 hours before the end of the period. Manage or cancel in your Apple ID settings. Unused AI Grades from an allowance expire at the end of the period.';
