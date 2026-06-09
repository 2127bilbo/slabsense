# SlabSense Payment & Subscription System - Game Plan

**Status:** Planning Complete - Ready for Implementation
**Target:** P11-P13 (Token System, Subscriptions, Production)

---

## Cost Basis

| Action | Our Cost | Credits Used |
|--------|----------|--------------|
| AI Grade | $0.02 | 1 credit |
| Deep Grade | $0.03 | 2 credits |

---

## User Tiers

### Free (No Email)
- Software grading only
- No AI grades
- No saving cards
- No collection
- Future: May hide grade explanations (just shows "Grade 8" not why)

### Free (Email Signup)
- Software grading
- **5 card save limit**
- No AI grades
- Can view collection (limited)

### Lifetime (Admin Only)
| User | Status | Credits/Month |
|------|--------|---------------|
| Owner (you) | Lifetime | 100 |
| Friend (tester) | Beta Lifetime | 100 |

*These are the only lifetime accounts - not available for purchase.*

---

## Subscription Tiers

| Tier | Price | Credits | Per Credit | Margin |
|------|-------|---------|------------|--------|
| **7-Day Trial** | $4.99 once | 5 | $1.00 | ~$4.35 |
| **Hobby Collector** | $9.99/mo | 10 | $1.00 | ~$9.20 |
| **Pro Collector** | $19.99/mo | 30 | $0.67 | ~$18.51 |
| **Dealer** | $49.99/mo | 100 | $0.50 | ~$46.24 |

### Signup Bonus Rules

| Scenario | Bonus Credits |
|----------|---------------|
| First purchase is $9.99+ (Hobby/Pro/Dealer) | **+7 credits** |
| 7-Day Trial → Auto-renews to $9.99 | **+5 credits** (after $9.99 payment) |
| 7-Day Trial → Cancels before renewal | **No bonus, permanently ineligible** |

### 7-Day Trial Rules
- One-time purchase only ($4.99)
- Once used, option disappears forever
- Requires payment upfront
- Auto-renews to Hobby ($9.99/mo) after 7 days
- Clear prompt: "By purchasing, you agree to auto-renewal at $9.99/mo on [DATE]. Cancel anytime before [DATE] to avoid charge."
- If cancelled before renewal: No signup bonus ever

### All Subscription Prompts
Every subscription purchase shows:
> "By subscribing, you agree to [PRICE] auto-renewal on [DATE]. You can cancel anytime from your account settings."

---

## Credit Bundles (No Subscription Required)

### Standard Packs
| Pack | Price | Credits | Per Credit |
|------|-------|---------|------------|
| 10 Credits | $14.99 | 10 | $1.50 |
| 20 Credits | $29.99 | 20 | $1.50 |
| 30 Credits | $39.99 | 30 | $1.33 |
| 50 Credits | $49.99 | 50 | $1.00 |

### Single Credits (Incremental Cart)
- **$1.99 per single credit**
- Users can add 1-9 singles to cart
- At **10 singles**, cart auto-converts to 10-Pack ($14.99)
- At **20 singles**, cart auto-converts to 20-Pack ($29.99)
- At **30 singles**, cart auto-converts to 30-Pack ($39.99)
- At **50 singles**, cart auto-converts to 50-Pack ($49.99)
- Users can still add singles after pack conversion for odd totals (e.g., 53 credits = 50-pack + 3 singles = $49.99 + $5.97 = $55.96)

**Example cart scenarios:**
| Cart | Price |
|------|-------|
| 1 single | $1.99 |
| 5 singles | $9.95 |
| 9 singles | $17.91 |
| 10+ singles | $14.99 (auto-converts to pack) |
| 14 credits | $14.99 + 4×$1.99 = $22.95 |
| 43 credits | $39.99 (30-pack) + 13×$1.99 = $65.86 |

---

## Credit Expiration

**All credits expire 30 days from last purchase/renewal.**

- Monthly subscription renewal → Resets expiration to 30 days
- Bundle purchase → Resets ALL credits to 30 days from purchase
- Credits do NOT roll over month-to-month
- Simple implementation: One `credits_expire_at` timestamp per user

---

## Referral System

### Rules
- Referrer gets **5 credits** when referred user completes first $9.99+ payment
- Referred user must actually pay (not just trial)
- Prevents abuse: Can't get credits from trial-only signups or alt emails

### Toggle Feature
- Admin can enable/disable referral system globally
- Use for promos, holidays, or if abuse detected
- When disabled, existing referral links still track but don't award credits

### Implementation Options (Choose One)
1. **Referral Codes**: User shares code like `SLABREF-ABC123`, friend enters at signup
2. **Referral Links**: User shares link like `slabsense.com/signup?ref=ABC123`, auto-applied

*Referral links are easier for users, codes are simpler to implement. Either works.*

---

## Database Schema

```sql
-- Update profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free';
  -- Values: 'free', 'trial', 'hobby', 'pro', 'dealer', 'lifetime', 'beta_lifetime'
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_renews_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits_balance INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits_expire_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS used_trial BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS signup_bonus_awarded BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS signup_bonus_eligible BOOLEAN DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cards_saved_count INTEGER DEFAULT 0;

-- Credit transactions log
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
    -- 'subscription', 'bundle', 'single', 'signup_bonus', 'referral_bonus',
    -- 'grade_ai', 'grade_deep', 'refund', 'expired'
  description TEXT,
  stripe_payment_id TEXT,
  scan_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stripe webhook idempotency
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Referral tracking
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES profiles(id),
  referred_id UUID REFERENCES profiles(id),
  referral_code TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- 'pending', 'qualified', 'credited'
  qualified_at TIMESTAMPTZ,       -- When referred user paid $9.99+
  credited_at TIMESTAMPTZ,        -- When referrer got credits
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System settings (for referral toggle, etc.)
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO system_settings (key, value) VALUES ('referrals_enabled', 'true');
```

---

## Stripe Products to Create

### Subscriptions (Recurring)
| Product Name | Price ID Name | Amount | Interval |
|--------------|---------------|--------|----------|
| SlabSense Hobby | price_hobby_monthly | $9.99 | monthly |
| SlabSense Pro | price_pro_monthly | $19.99 | monthly |
| SlabSense Dealer | price_dealer_monthly | $49.99 | monthly |

### One-Time Purchases
| Product Name | Price ID Name | Amount |
|--------------|---------------|--------|
| 7-Day Trial | price_trial | $4.99 |
| Single Credit | price_single | $1.99 |
| 10 Credit Pack | price_pack_10 | $14.99 |
| 20 Credit Pack | price_pack_20 | $29.99 |
| 30 Credit Pack | price_pack_30 | $39.99 |
| 50 Credit Pack | price_pack_50 | $49.99 |

---

## API Endpoints

```
api/
├── stripe/
│   ├── create-checkout.js    # Create Stripe checkout session
│   ├── create-portal.js      # Customer portal for subscription management
│   ├── webhook.js            # Handle all Stripe events
│   └── prices.js             # Get current prices for UI
├── credits/
│   ├── balance.js            # Get user's credit balance + expiration
│   ├── spend.js              # Deduct credits for grading
│   └── history.js            # Get transaction history
├── referrals/
│   ├── code.js               # Get/generate user's referral code
│   └── status.js             # Check referral stats
└── admin/
    └── settings.js           # Toggle referral system, etc.
```

---

## Implementation Phases

### Phase 1: Stripe Setup
- [ ] Create Stripe account (or use existing)
- [ ] Create all products and prices in Stripe Dashboard
- [ ] Get API keys (test mode first)
- [ ] Set up webhook endpoint
- [ ] Document all price IDs in env vars

### Phase 2: Database
- [ ] Run schema migrations
- [ ] Set up RLS policies
- [ ] Mark your account as `lifetime`
- [ ] Mark friend's account as `beta_lifetime`
- [ ] Initialize both with 100 credits

### Phase 3: Core Backend
- [ ] `/api/stripe/webhook.js` - Process payments
- [ ] `/api/credits/balance.js` - Check balance
- [ ] `/api/credits/spend.js` - Deduct on grade
- [ ] Credit expiration check on balance fetch

### Phase 4: Checkout Flow
- [ ] `/api/stripe/create-checkout.js` - Subscriptions + bundles
- [ ] Handle trial logic (one-time only)
- [ ] Signup bonus logic
- [ ] `/api/stripe/create-portal.js` - Manage subscription

### Phase 5: Frontend - Credits Display
- [ ] Credit balance in header/nav
- [ ] Expiration warning (< 7 days)
- [ ] "Low credits" prompt

### Phase 6: Frontend - Purchase UI
- [ ] Pricing page with all tiers
- [ ] Bundle selection with cart
- [ ] Single credit incremental cart logic
- [ ] Trial option (if eligible)
- [ ] Checkout redirect to Stripe

### Phase 7: Grade Flow Integration
- [ ] Check credits before grading
- [ ] Block if insufficient (show upgrade prompt)
- [ ] Deduct credits on grade start
- [ ] Refund on API failure
- [ ] Transaction logging

### Phase 8: Referral System
- [ ] Generate referral codes
- [ ] Track referral signups
- [ ] Credit referrer on $9.99+ payment
- [ ] Admin toggle for system

### Phase 9: Free Tier Limits
- [ ] 5 card save limit for free email users
- [ ] Block AI grades for free users
- [ ] Upgrade prompts

### Phase 10: Testing
- [ ] Full flow in Stripe test mode
- [ ] Test all subscription scenarios
- [ ] Test trial → renewal → bonus
- [ ] Test trial → cancel → no bonus
- [ ] Test bundle purchases
- [ ] Test credit expiration
- [ ] Test referral flow

### Phase 11: Go Live
- [ ] Switch to Stripe live mode
- [ ] Update environment variables
- [ ] Monitor first transactions
- [ ] Set up Stripe alerts

---

## Environment Variables

```env
# Stripe Keys
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe Price IDs
STRIPE_PRICE_TRIAL=price_...
STRIPE_PRICE_HOBBY=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_DEALER=price_...
STRIPE_PRICE_SINGLE=price_...
STRIPE_PRICE_PACK_10=price_...
STRIPE_PRICE_PACK_20=price_...
STRIPE_PRICE_PACK_30=price_...
STRIPE_PRICE_PACK_50=price_...
```

---

## User State Tracking

```javascript
// Profile state for subscription logic
{
  subscription_status: 'free' | 'trial' | 'hobby' | 'pro' | 'dealer' | 'lifetime' | 'beta_lifetime',
  credits_balance: 0,
  credits_expire_at: null,
  used_trial: false,              // Has user ever used 7-day trial?
  signup_bonus_awarded: false,    // Has user received signup bonus?
  signup_bonus_eligible: true,    // Can user still get signup bonus? (false if trial cancelled)
}
```

### State Transitions

```
New User (no email) → free, no credits

New User (email) → free, no credits, 5 card limit

User buys Trial ($4.99):
  → used_trial = true
  → credits += 5
  → subscription_status = 'trial'
  → subscription_renews_at = now + 7 days

Trial auto-renews ($9.99):
  → credits += 10 (hobby credits)
  → credits += 5 (signup bonus)
  → signup_bonus_awarded = true
  → subscription_status = 'hobby'

Trial cancelled before renewal:
  → signup_bonus_eligible = false
  → subscription_status = 'free' (after trial expires)
  → Can never get signup bonus

User buys Hobby directly ($9.99):
  → credits += 10
  → credits += 7 (signup bonus, first time)
  → signup_bonus_awarded = true
  → subscription_status = 'hobby'

User buys bundle:
  → credits += bundle amount
  → credits_expire_at = now + 30 days (resets all credits)
```

---

## Security Notes

1. **Webhook signature verification** - Always verify Stripe signatures
2. **Idempotency** - Store processed event IDs, ignore duplicates
3. **Server-side credit checks** - Never trust client
4. **Deduct before API call** - Prevents abuse, refund on failure
5. **Rate limiting** - Prevent balance check spam

---

## Summary

| What | Details |
|------|---------|
| **Credit cost** | 1 = AI grade, 2 = Deep grade |
| **Expiration** | 30 days from any purchase (resets all) |
| **Free (no email)** | Software grade only |
| **Free (email)** | 5 card limit, no AI |
| **Trial** | $4.99, 5 credits, one-time only |
| **Subscriptions** | $9.99/10cr, $19.99/30cr, $49.99/100cr |
| **Bundles** | $14.99-$49.99 for 10-50 credits |
| **Singles** | $1.99 each, auto-converts to packs |
| **Signup bonus** | +7 first purchase, +5 after trial renewal |
| **Referral** | +5 when friend pays $9.99+ (toggleable) |
| **Lifetime** | You + friend only, 100 credits/month |

---

*Finalized: June 9, 2026*
*Ready for Phase 1: Stripe Setup*
