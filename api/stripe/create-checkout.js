/**
 * Create Stripe Checkout Session
 * Handles subscriptions, trials, and one-time purchases
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { SLAB_PRICE_KEY, slabSessionParams } from '../_lib/slabs.js';
import { requireUser, sendAuthError } from '../_lib/auth.js';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 30,
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Price IDs mapping
const PRICES = {
  trial: process.env.STRIPE_PRICE_TRIAL,
  hobby: process.env.STRIPE_PRICE_HOBBY,
  pro: process.env.STRIPE_PRICE_PRO,
  dealer: process.env.STRIPE_PRICE_DEALER,
  single: process.env.STRIPE_PRICE_SINGLE,
  pack_10: process.env.STRIPE_PRICE_PACK_10,
  pack_20: process.env.STRIPE_PRICE_PACK_20,
  pack_30: process.env.STRIPE_PRICE_PACK_30,
  pack_50: process.env.STRIPE_PRICE_PACK_50,
  slab: process.env.STRIPE_PRICE_SLAB,
};

// Subscription prices (for mode detection)
const SUBSCRIPTION_PRICES = [PRICES.hobby, PRICES.pro, PRICES.dealer];

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
    const { userId, priceKey, quantity = 1, successUrl, cancelUrl, scanId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (!priceKey || !PRICES[priceKey]) {
      return res.status(400).json({ error: 'Invalid price key' });
    }

    const priceId = PRICES[priceKey];

    // Slab orders must come from the signed-in owner; verify before any side effect.
    if (priceKey === SLAB_PRICE_KEY) {
      let payer;
      try { payer = await requireUser({ db: supabase }, req); } catch (e) { return sendAuthError(res, e); }
      if (payer.id !== userId) return res.status(403).json({ error: 'user_mismatch' });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check trial eligibility
    if (priceKey === 'trial' && profile.used_trial) {
      return res.status(400).json({
        error: 'Trial already used',
        message: 'You have already used your 7-day trial.'
      });
    }

    // Get or create Stripe customer
    let customerId = profile.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email,
        metadata: {
          user_id: userId,
        },
      });
      customerId = customer.id;

      // Save customer ID to profile
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    // Slabbing order: one card, shipping collected, cert minted by the webhook.
    if (priceKey === SLAB_PRICE_KEY) {
      if (!scanId) return res.status(400).json({ error: 'scan_required' });
      const { data: scan, error: scanErr } = await supabase
        .from('scans').select('id, user_id, grade_value, user_card_image, enhanced_front_path, front_image_path')
        .eq('id', scanId).maybeSingle();
      if (scanErr || !scan) return res.status(404).json({ error: 'scan_not_found' });
      if (scan.user_id !== userId) return res.status(403).json({ error: 'scan_not_owned' });
      if (scan.grade_value == null) return res.status(400).json({ error: 'scan_not_graded' });
      if (!(scan.user_card_image || scan.enhanced_front_path || scan.front_image_path)) return res.status(400).json({ error: 'scan_has_no_image' });
      const base = process.env.VITE_APP_URL || 'https://slabsenseai.com';
      const session = await stripe.checkout.sessions.create(slabSessionParams({
        customerId, userId, scanId, priceId,
        successUrl: successUrl || `${base}/?slab_ordered=1`,
        cancelUrl: cancelUrl || `${base}/?slab_canceled=1`,
      }));
      return res.status(200).json({ success: true, sessionId: session.id, url: session.url });
    }

    // Determine checkout mode
    const isSubscription = SUBSCRIPTION_PRICES.includes(priceId);
    const isTrial = priceKey === 'trial';

    // Build line items
    const lineItems = [{
      price: priceId,
      quantity: priceKey === 'single' ? quantity : 1,
    }];

    // Build checkout session params
    const sessionParams = {
      customer: customerId,
      line_items: lineItems,
      mode: isSubscription ? 'subscription' : 'payment',
      success_url: successUrl || `${process.env.VITE_APP_URL || 'https://slabsense.com'}/billing?success=true`,
      cancel_url: cancelUrl || `${process.env.VITE_APP_URL || 'https://slabsense.com'}/billing?canceled=true`,
      metadata: {
        user_id: userId,
        price_id: priceId,
        price_key: priceKey,
      },
    };

    // For trial: Set up subscription with 7-day trial that converts to Hobby
    if (isTrial) {
      // Trial is a one-time payment, but we need to set up subscription for auto-renewal
      // Actually, for the trial model described, we do a one-time payment first,
      // then create a subscription that starts in 7 days
      sessionParams.mode = 'payment';
      sessionParams.metadata.is_trial = 'true';

      // We'll handle the subscription creation in the webhook
      // by creating a subscription with trial_end set to 7 days
    }

    // For subscriptions, allow promotion codes
    if (isSubscription) {
      sessionParams.allow_promotion_codes = true;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });

  } catch (error) {
    console.error('[Checkout] Error:', error);
    return res.status(500).json({
      error: 'Failed to create checkout session',
      message: error.message,
    });
  }
}
