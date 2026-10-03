/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
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
    allowance: 5,                   // AI Grades granted each paid period (owner decision 2026-10-02)
    trial: { days: 5, grades: 2 },  // introductory free trial: unlimited on-device grades + 2 AI Grades
    period: 'month',
    appleId: 'com.slabsense.app.plus.monthly',
    stripeKey: 'sub_monthly', stripeEnv: 'STRIPE_PRICE_PLUS_MONTHLY',
    webPrice: 9.99,
    tagline: 'Unlimited grades, 5 AI Grades a month',
  },
  pack_5: {
    kind: 'consumable',
    name: '5 AI Grades',
    credits: 5,
    appleId: 'com.slabsense.app.grades.5',
    stripeKey: 'pack_5', stripeEnv: 'STRIPE_PRICE_GRADES_5',
    webPrice: 4.99,
    tagline: 'Never expire',
  },
  pack_20: {
    kind: 'consumable',
    name: '20 AI Grades',
    credits: 20,
    appleId: 'com.slabsense.app.grades.20',
    stripeKey: 'pack_20', stripeEnv: 'STRIPE_PRICE_GRADES_20',
    webPrice: 14.99,
    tagline: 'Never expire · best value',
  },
};

/** Free accounts: on-device grades per calendar month (UTC); no AI Grades. Signed-out users get capture + centering only. */
export const FREE_TIER = { gradesPerMonth: 10, aiGrades: 0 };
/** Statuses with unlimited on-device grades. */
export const UNLIMITED_STATUSES = ['sub_monthly', 'trialing', 'lifetime', 'beta_lifetime'];
export function isUnlimited(subscriptionStatus) { return UNLIMITED_STATUSES.includes(subscriptionStatus); }
/** Where the welcome prompt sends suggestions and bug reports. */
export const FEEDBACK_EMAIL = 'support@slabsenseai.com';

/** Product by Apple product id. */
export function productByAppleId(appleId) {
  return Object.entries(PRODUCTS).find(([, p]) => p.appleId === appleId)?.[1] || null;
}
export function productKeyByAppleId(appleId) {
  return Object.entries(PRODUCTS).find(([, p]) => p.appleId === appleId)?.[0] || null;
}

/** Apple's required subscription disclosure, shown wherever a subscription is offered. */
export const APPLE_SUBSCRIPTION_TERMS =
  'SlabSense Plus starts with a 5-day free trial that includes 2 AI Grades; after the trial, payment is charged to your Apple ID and the plan includes 5 AI Grades each month. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period, and your account is charged for renewal within 24 hours before the end of the period. Manage or cancel in your Apple ID settings. Unused AI Grades from an allowance expire at the end of the period.';
