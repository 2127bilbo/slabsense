/**
 * Create Stripe Checkout Session
 * Plans and packs (src/lib/products.js) and the physical slab. Identity comes from the bearer
 * token, never from the body (audit G-04 / B-06).
 */

import Stripe from 'stripe';
import { SLAB_PRICE_KEY, slabSessionParams } from '../_lib/slabs.js';
import { userRoute } from '../_lib/route.js';
import { sameOriginUrl } from '../_lib/urlGuard.js';
import { priceMap } from '../_lib/stripeLedger.js';
import { PRODUCTS } from '../../src/lib/products.js';

export const config = {
  api: {
    bodyParser: true,
  },
  maxDuration: 30,
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Price ids by product key: the same three products as the iOS app (src/lib/products.js) plus the
// physical slab. The old nine price variables (trial, hobby/pro/dealer, single, four packs) are gone;
// they were never configured and the trial was never a real subscription (audit B-02, B-07, B-12).
const PRICES = priceMap(process.env);
const isSubscriptionKey = (key) => PRODUCTS[key]?.kind === 'subscription';

export default userRoute({ label: 'Checkout' }, async ({ req, res, db: supabase, user }) => {
    const { priceKey, scanId } = req.body;
    const userId = user.id;
    // Client-supplied redirect targets are used only on our own origins (open redirect).
    const successUrl = sameOriginUrl(req.body.successUrl);
    const cancelUrl = sameOriginUrl(req.body.cancelUrl);
    const quantity = 1; // packs and plans are fixed-size; quantity is no longer accepted

    if (!priceKey || !PRICES[priceKey]) {
      return res.status(400).json({ error: 'Invalid price key' });
    }

    const priceId = PRICES[priceKey];

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
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

    const isSubscription = isSubscriptionKey(priceKey);
    const lineItems = [{ price: priceId, quantity }];

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

});
