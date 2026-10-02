/**
 * GET/POST /api/credits/balance
 * Returns the authenticated user's credits, expiration, and subscription status.
 * The user comes from the Supabase JWT; a userId in the query/body must match it.
 */
import { userRoute } from '../_lib/route.js';

export const config = { maxDuration: 10 };

export default userRoute({ methods: ['GET', 'POST'], label: 'Balance' }, async ({ res, db: supabase, user }) => {
    const userId = user.id;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*') // the Apple ledger columns (migration 20261002_apple_iap.sql) are read with defaults until applied
      .eq('id', userId)
      .single();
    if (error || !profile) return res.status(404).json({ error: 'User not found' });

    let balance = profile.credits_balance || 0;
    const expiresAt = profile.credits_expire_at ? new Date(profile.credits_expire_at) : null;
    const now = new Date();

    if (expiresAt && expiresAt < now && balance > 0) {
      // Credits expired: zero the balance once and log it
      balance = 0;
      await supabase.from('profiles').update({ credits_balance: 0 }).eq('id', userId);
      await supabase.from('credit_transactions').insert({
        user_id: userId,
        amount: -(profile.credits_balance || 0),
        transaction_type: 'expired',
        description: 'Credits expired',
      });
    }

    let daysUntilExpiry = null;
    if (expiresAt && expiresAt > now) daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

    // Subscription allowance bucket (Apple or web plan): counts only until its period ends.
    const subExpires = profile.sub_credits_expire_at ? new Date(profile.sub_credits_expire_at) : null;
    const subCredits = subExpires && subExpires < now ? 0 : (profile.sub_credits_balance || 0);

    const isLifetime = ['lifetime', 'beta_lifetime'].includes(profile.subscription_status);
    const isFree = profile.subscription_status === 'free';
    const cardLimit = isFree ? 5 : null; // null = unlimited

    return res.status(200).json({
      success: true,
      credits: balance + subCredits,            // what the user can spend now
      packCredits: balance,                     // never expire
      subCredits,                               // this period's allowance
      subCreditsExpireAt: subExpires?.toISOString() || null,
      subscriptionSource: profile.subscription_source || (profile.stripe_customer_id ? 'stripe' : null),
      expiresAt: expiresAt?.toISOString() || null,
      daysUntilExpiry,
      subscription: profile.subscription_status,
      renewsAt: profile.subscription_renews_at,
      trialUsed: profile.used_trial,
      bonusEligible: profile.signup_bonus_eligible,
      cardsSaved: profile.cards_saved_count || 0,
      cardLimit,
      canSaveMore: cardLimit === null || (profile.cards_saved_count || 0) < cardLimit,
      isLifetime,
      canUseAI: !isFree || isLifetime,
    });
});
