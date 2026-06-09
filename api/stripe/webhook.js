/**
 * Stripe Webhook Handler
 * Processes payment events and updates user credits
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false, // Stripe requires raw body for signature verification
  },
  maxDuration: 30,
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Need service role for writes
);

// Credit amounts for each product
const CREDIT_AMOUNTS = {
  [process.env.STRIPE_PRICE_TRIAL]: { credits: 5, type: 'trial' },
  [process.env.STRIPE_PRICE_HOBBY]: { credits: 10, type: 'hobby' },
  [process.env.STRIPE_PRICE_PRO]: { credits: 30, type: 'pro' },
  [process.env.STRIPE_PRICE_DEALER]: { credits: 100, type: 'dealer' },
  [process.env.STRIPE_PRICE_SINGLE]: { credits: 1, type: 'single' },
  [process.env.STRIPE_PRICE_PACK_10]: { credits: 10, type: 'bundle' },
  [process.env.STRIPE_PRICE_PACK_20]: { credits: 20, type: 'bundle' },
  [process.env.STRIPE_PRICE_PACK_30]: { credits: 30, type: 'bundle' },
  [process.env.STRIPE_PRICE_PACK_50]: { credits: 50, type: 'bundle' },
};

// Subscription tiers that qualify for signup bonus
const BONUS_QUALIFYING_PRICES = [
  process.env.STRIPE_PRICE_HOBBY,
  process.env.STRIPE_PRICE_PRO,
  process.env.STRIPE_PRICE_DEALER,
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Webhook] Missing STRIPE_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let event;
  let rawBody = '';

  try {
    // Read raw body for signature verification
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    rawBody = Buffer.concat(chunks).toString('utf8');

    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Check for duplicate event (idempotency)
  const { data: existingEvent } = await supabase
    .from('stripe_events')
    .select('id')
    .eq('id', event.id)
    .single();

  if (existingEvent) {
    console.log('[Webhook] Duplicate event ignored:', event.id);
    return res.status(200).json({ received: true, duplicate: true });
  }

  // Store event ID for idempotency
  await supabase.from('stripe_events').insert({
    id: event.id,
    type: event.type,
  });

  console.log('[Webhook] Processing event:', event.type, event.id);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      default:
        console.log('[Webhook] Unhandled event type:', event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Webhook] Error processing event:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

/**
 * Handle completed checkout session
 */
async function handleCheckoutComplete(session) {
  const customerId = session.customer;
  const userId = session.metadata?.user_id;
  const priceId = session.metadata?.price_id;
  const mode = session.mode; // 'payment' or 'subscription'

  if (!userId) {
    console.error('[Webhook] No user_id in session metadata');
    return;
  }

  console.log('[Webhook] Checkout complete:', { userId, priceId, mode });

  // Get user profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    console.error('[Webhook] User not found:', userId);
    return;
  }

  // Link Stripe customer to profile
  if (customerId && !profile.stripe_customer_id) {
    await supabase
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', userId);
  }

  const productInfo = CREDIT_AMOUNTS[priceId];
  if (!productInfo) {
    console.error('[Webhook] Unknown price ID:', priceId);
    return;
  }

  // Calculate credits and bonuses
  let creditsToAdd = productInfo.credits;
  let bonusCredits = 0;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Handle different product types
  if (productInfo.type === 'trial') {
    // 7-day trial
    await supabase
      .from('profiles')
      .update({
        used_trial: true,
        subscription_status: 'trial',
        subscription_id: session.subscription,
        subscription_renews_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        credits_balance: (profile.credits_balance || 0) + creditsToAdd,
        credits_expire_at: expiresAt,
      })
      .eq('id', userId);

  } else if (['hobby', 'pro', 'dealer'].includes(productInfo.type)) {
    // Subscription purchase
    // Check for signup bonus
    if (!profile.signup_bonus_awarded && profile.signup_bonus_eligible) {
      if (profile.used_trial) {
        // Coming from trial: +5 bonus
        bonusCredits = 5;
      } else {
        // First purchase directly: +7 bonus
        bonusCredits = 7;
      }
    }

    await supabase
      .from('profiles')
      .update({
        subscription_status: productInfo.type,
        subscription_id: session.subscription,
        subscription_renews_at: expiresAt,
        credits_balance: (profile.credits_balance || 0) + creditsToAdd + bonusCredits,
        credits_expire_at: expiresAt,
        signup_bonus_awarded: bonusCredits > 0 ? true : profile.signup_bonus_awarded,
      })
      .eq('id', userId);

  } else {
    // One-time purchase (bundles/singles)
    await supabase
      .from('profiles')
      .update({
        credits_balance: (profile.credits_balance || 0) + creditsToAdd,
        credits_expire_at: expiresAt, // Resets all credits expiration
      })
      .eq('id', userId);
  }

  // Log transaction
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: creditsToAdd,
    transaction_type: productInfo.type === 'single' ? 'single' :
                      productInfo.type === 'bundle' ? 'bundle' : 'subscription',
    description: `Purchased ${creditsToAdd} credits`,
    stripe_payment_id: session.payment_intent,
  });

  // Log bonus if applicable
  if (bonusCredits > 0) {
    await supabase.from('credit_transactions').insert({
      user_id: userId,
      amount: bonusCredits,
      transaction_type: 'signup_bonus',
      description: `Signup bonus: +${bonusCredits} credits`,
      stripe_payment_id: session.payment_intent,
    });
  }

  // Handle referral credit if applicable
  await checkReferralBonus(userId);

  console.log('[Webhook] Credits added:', creditsToAdd, 'Bonus:', bonusCredits);
}

/**
 * Handle recurring subscription payment
 */
async function handleInvoicePaid(invoice) {
  // Skip first invoice (handled by checkout.session.completed)
  if (invoice.billing_reason === 'subscription_create') {
    return;
  }

  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  // Find user by Stripe customer ID
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) {
    console.error('[Webhook] No profile for customer:', customerId);
    return;
  }

  // Get subscription to find price
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price.id;
  const productInfo = CREDIT_AMOUNTS[priceId];

  if (!productInfo) {
    console.error('[Webhook] Unknown price on renewal:', priceId);
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Add monthly credits
  await supabase
    .from('profiles')
    .update({
      credits_balance: (profile.credits_balance || 0) + productInfo.credits,
      credits_expire_at: expiresAt,
      subscription_renews_at: expiresAt,
    })
    .eq('id', profile.id);

  // Log transaction
  await supabase.from('credit_transactions').insert({
    user_id: profile.id,
    amount: productInfo.credits,
    transaction_type: 'subscription',
    description: `Monthly renewal: +${productInfo.credits} credits`,
    stripe_payment_id: invoice.payment_intent,
  });

  console.log('[Webhook] Renewal credits added:', productInfo.credits);
}

/**
 * Handle subscription updates (plan changes)
 */
async function handleSubscriptionUpdated(subscription) {
  const customerId = subscription.customer;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) return;

  const priceId = subscription.items.data[0]?.price.id;
  const productInfo = CREDIT_AMOUNTS[priceId];
  const status = productInfo?.type || 'free';

  // Update subscription status
  await supabase
    .from('profiles')
    .update({
      subscription_status: subscription.status === 'active' ? status : 'free',
      subscription_id: subscription.id,
    })
    .eq('id', profile.id);

  console.log('[Webhook] Subscription updated:', status);
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionDeleted(subscription) {
  const customerId = subscription.customer;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, used_trial, signup_bonus_awarded')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) return;

  const updates = {
    subscription_status: 'free',
    subscription_id: null,
    subscription_renews_at: null,
  };

  // If they used trial but never paid, mark bonus ineligible
  if (profile.used_trial && !profile.signup_bonus_awarded) {
    updates.signup_bonus_eligible = false;
  }

  await supabase
    .from('profiles')
    .update(updates)
    .eq('id', profile.id);

  console.log('[Webhook] Subscription cancelled');
}

/**
 * Check and award referral bonus
 */
async function checkReferralBonus(userId) {
  // Check if system settings allow referrals
  const { data: settings } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'referrals_enabled')
    .single();

  if (settings?.value !== 'true' && settings?.value !== true) {
    return;
  }

  // Check if this user was referred
  const { data: profile } = await supabase
    .from('profiles')
    .select('referred_by')
    .eq('id', userId)
    .single();

  if (!profile?.referred_by) return;

  // Find the referral record
  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referred_id', userId)
    .eq('status', 'pending')
    .single();

  if (!referral) return;

  // Mark as qualified and credit referrer
  await supabase
    .from('referrals')
    .update({
      status: 'credited',
      qualified_at: new Date(),
      credited_at: new Date(),
    })
    .eq('id', referral.id);

  // Add 5 credits to referrer
  const { data: referrer } = await supabase
    .from('profiles')
    .select('credits_balance, credits_expire_at')
    .eq('id', referral.referrer_id)
    .single();

  if (referrer) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await supabase
      .from('profiles')
      .update({
        credits_balance: (referrer.credits_balance || 0) + 5,
        credits_expire_at: expiresAt,
      })
      .eq('id', referral.referrer_id);

    await supabase.from('credit_transactions').insert({
      user_id: referral.referrer_id,
      amount: 5,
      transaction_type: 'referral_bonus',
      description: 'Referral bonus: friend subscribed',
    });

    console.log('[Webhook] Referral bonus awarded to:', referral.referrer_id);
  }
}
