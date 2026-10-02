/**
 * Stripe Webhook Handler
 * Verifies the signature, claims the event id once, then applies the event through the
 * shared credit ledger (api/_lib/stripeLedger.js) or mints a slab. Credits are granted only
 * by grant_credits (idempotent on external id), never by direct balance arithmetic.
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { SLAB_PRICE_KEY, mintSlab, slabOrderFromSession } from '../_lib/slabs.js';
import {
  decideCheckout, decideInvoicePaid, decideInvoiceFailed, decideSubscriptionUpdated,
  decideSubscriptionDeleted, decideChargeRefunded, userForCustomer, applyToDb,
} from '../_lib/stripeLedger.js';

export const config = {
  api: {
    bodyParser: false, // Stripe requires raw body for signature verification
  },
  maxDuration: 30,
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  let rawBody;

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

  // Idempotency: claim the event id FIRST; a concurrent duplicate delivery then fails the insert
  // on the primary key instead of both passing a select-then-insert race (audit B-05).
  const { error: claimError } = await supabase.from('stripe_events').insert({ id: event.id, type: event.type });
  if (claimError) {
    if (claimError.code === '23505') {
      console.log('[Webhook] Duplicate event ignored:', event.id);
      return res.status(200).json({ received: true, duplicate: true });
    }
    console.error('[Webhook] Could not record event:', claimError.message);
    return res.status(500).json({ error: 'Webhook storage failed' });
  }

  console.log('[Webhook] Processing event:', event.type, event.id);

  try {
    const obj = event.data.object;
    let outcome = null;
    switch (event.type) {
      case 'checkout.session.completed':
        outcome = await handleCheckoutComplete(obj);
        break;
      case 'invoice.paid':
        outcome = await applyForCustomer(obj.customer, decideInvoicePaid(obj));
        break;
      case 'invoice.payment_failed':
        outcome = await applyForCustomer(obj.customer, decideInvoiceFailed(obj));
        break;
      case 'customer.subscription.updated':
        outcome = await applyForCustomer(obj.customer, decideSubscriptionUpdated(obj));
        break;
      case 'customer.subscription.deleted':
        outcome = await applyForCustomer(obj.customer, decideSubscriptionDeleted(obj));
        break;
      case 'charge.refunded':
        outcome = await applyForCustomer(obj.customer, decideChargeRefunded(obj));
        break;
      default:
        console.log('[Webhook] Unhandled event type:', event.type);
    }
    if (outcome) console.log('[Webhook]', event.type, outcome.applied ? 'applied' : 'skipped', '-', outcome.reason);

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Webhook] Error processing event:', err);
    // Release the idempotency claim so Stripe's retry is processed instead of dropped as a duplicate.
    await supabase.from('stripe_events').delete().eq('id', event.id);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

/** Resolve the profile behind a Stripe customer and apply the decision to it. */
async function applyForCustomer(customerId, decision) {
  const userId = await userForCustomer(supabase, customerId);
  if (!userId) console.warn('[Webhook] No profile for customer:', customerId);
  return applyToDb(supabase, { decision, userId });
}

/**
 * Completed checkout session: a slab order, a pack, or the start of a plan.
 */
async function handleCheckoutComplete(session) {
  const userId = session.metadata?.user_id;

  if (!userId) {
    console.error('[Webhook] No user_id in session metadata');
    return null;
  }

  if (session.metadata?.price_key === SLAB_PRICE_KEY) {
    const { slab, created } = await mintSlab({ db: supabase, storage: supabase.storage, fetchImpl: fetch }, slabOrderFromSession(session));
    console.log(`[Webhook] Slab ${created ? 'minted' : 'already existed'}: ${slab.cert} for scan ${slab.scan_id}`);
    return { applied: true, reason: 'slab' };
  }

  // The checkout was created for this user, so trust the metadata over the customer lookup
  // (the customer id may be new); applyToDb stores the link.
  const outcome = await applyToDb(supabase, { decision: decideCheckout(session), userId });
  if (outcome.applied && outcome.ops.length) await checkReferralBonus(userId);
  return outcome;
}

/**
 * Referral bonus: when a referred user makes their first purchase, the referrer gets 5 AI Grades,
 * once per referral (idempotent on the referral id through the ledger).
 */
async function checkReferralBonus(userId) {
  const { data: settings } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'referrals_enabled')
    .single();

  if (settings?.value !== 'true' && settings?.value !== true) return;

  const { data: profile } = await supabase.from('profiles').select('referred_by').eq('id', userId).single();
  if (!profile?.referred_by) return;

  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referred_id', userId)
    .eq('status', 'pending')
    .single();
  if (!referral) return;

  await supabase
    .from('referrals')
    .update({ status: 'credited', qualified_at: new Date(), credited_at: new Date() })
    .eq('id', referral.id);

  const { error } = await supabase.rpc('grant_credits', {
    p_user_id: referral.referrer_id, p_amount: 5, p_bucket: 'pack',
    p_external_id: `referral:${referral.id}`, p_description: 'Referral bonus: friend purchased',
  });
  if (error) console.error('[Webhook] Referral bonus failed:', error.message);
  else console.log('[Webhook] Referral bonus awarded to:', referral.referrer_id);
}
