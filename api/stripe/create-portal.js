/**
 * Create Stripe Customer Portal Session
 * Allows users to manage their subscription, update payment method, etc.
 * Identity from the bearer token only (audit G-03): the portal exposes invoices and card details.
 */

import Stripe from 'stripe';
import { userRoute } from '../_lib/route.js';
import { sameOriginUrl } from '../_lib/urlGuard.js';

export const config = {
  maxDuration: 10,
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default userRoute({ label: 'Portal' }, async ({ req, res, db: supabase, user }) => {
    const userId = user.id;
    const returnUrl = sameOriginUrl(req.body?.returnUrl);

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!profile.stripe_customer_id) {
      return res.status(400).json({
        error: 'No billing account',
        message: 'You need to make a purchase first to access billing management.',
      });
    }

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl || `${process.env.VITE_APP_URL || 'https://slabsense.com'}/settings`,
    });

    return res.status(200).json({
      success: true,
      url: session.url,
    });

});
