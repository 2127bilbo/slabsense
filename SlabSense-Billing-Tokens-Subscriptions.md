# SlabSense — Billing, Tokens & Subscriptions (Deferred Until Post-Beta)

Handoff doc for the monetization layer. **Do not build this until Bob gives the explicit go-ahead.** SlabSense is currently in free beta to gather user feedback and polish the product. This system flips on when grading quality is proven, feedback is incorporated, and Bob is ready to monetize.

## Philosophy

- Beta users get grandfathered with a one-time token grant as thanks for testing (Bob's call on amount — suggested 100 tokens = ~3 months of casual use)
- No surcharges, ever. Fees are baked into pricing from day one.
- Push users toward larger packs and subscriptions via natural incentives (better per-token value), not by punishing small purchases
- Premium features (Express grade, bulk submission, graded price comps) gated behind paid tiers
- Free tier is genuine, not crippled — users can get real value without paying

## The Token System

### Why tokens instead of direct pricing

- Decouples user-facing pricing from underlying API costs (easier to adjust)
- Lets you offer "bonus tokens" for subscriptions without breaking price psychology
- Simplifies the UX: "Grade costs 1 token" is clearer than "Grade costs $0.20"
- Enables a single currency across different grade types (standard vs express, single vs bulk)

### Token costs by action

| Action | Token Cost | Your Underlying Cost | Notes |
|---|---|---|---|
| Standard grade | 1 token | ~$0.009 | Batched via Anthropic Batch API, results 1-3 hours |
| Express grade | 2 tokens | ~$0.017 | Real-time API, results in ~30 seconds |
| Deep grade (ensemble) | 4 tokens | ~$0.05 | 3x ensemble for high-value cards, real-time |
| Bulk submission (50+ cards) | 0.8 tokens each | Lower per-card via structural batching | Incentivizes users to scan collections at once |

Token pricing baseline: **$0.20 per token**, which means Standard grades are ~$0.20, Express ~$0.40. All well above cost.

### Standard vs Express — the user-facing pitch

Don't expose "batch API" or "off-peak" to users. Frame it as value:

- **Standard grade** — "Results ready within a few hours" (1 token)
- **Express grade** — "Results in 30 seconds" (2 tokens)

Bulk collection scanning → Standard is better UX anyway (queue 200 cards, review in morning). Just-pulled-a-hit moment → Express is worth the extra token.

## Pricing Structure

### Free Tier (always free, genuine value)

- 3 Standard grades per month (resets monthly on account creation date)
- Algorithmic grade (existing pixel math) available unlimited — no token cost, fully client-side
- pHash card identification unlimited — runs client-side
- Collection view unlimited
- No access to Express grades, Deep grades, or graded price comps

**Purpose:** Lets users see real value and share with friends without paywalls. Conversion lever comes when they hit the 3-grade limit and want more.

### Credit Packs (one-time purchases)

| Pack | Price | Tokens | Effective Per-Token | Savings |
|---|---|---|---|---|
| Starter | $5 | 25 | $0.20 | baseline |
| Standard | $15 | 85 | $0.18 | 10% off |
| Collector | $40 | 250 | $0.16 | 20% off |
| Pro | $100 | 700 | $0.14 | 30% off |

**Key: minimum $5 pack.** Smaller packs get murdered by the $0.30-0.49 fixed payment processor fee. At $5 even worst-case PayPal fees (3.49% + $0.49 = $0.67) are 13% — survivable. At $2 they'd be 28% — death.

### Subscriptions (recurring, best value)

| Tier | Price/Month | Tokens/Month | Features | Effective Per-Token |
|---|---|---|---|---|
| Hobbyist | $5 | 30 | Express access | $0.17 |
| Collector | $15 | 120 | Express + graded price comps | $0.13 |
| Pro | $40 | 400 | Express + comps + bulk submission + priority support | $0.10 |

Subscribers always get better per-token value than one-off buyers. Unused tokens roll over for 1 month (cap rollover at 2x monthly allotment to prevent hoarding).

### Native App Pricing (when launched)

Apple/Google take 15-30% via IAP. Don't absorb that — charge slightly more in-app.

Example structure:
- Web (Stripe): $5 Hobbyist
- iOS/Android IAP: $6.99 Hobbyist

This is standard practice (Spotify, Netflix, YouTube all do it) and legal. Users who care about saving will subscribe on the web; users who don't care pay the convenience premium. Mention it in-app where Apple/Google rules allow.

## Payment Processing

### Stripe Checkout with PayPal enabled

Single integration, both payment methods. Users see both options at checkout, pick what they trust. Money flows:

- Credit card → Stripe rails → your bank (2-3 days)
- PayPal → PayPal rails (still through Stripe's orchestration) → your bank

Why this over pure PayPal:
- Stripe's subscription management is dramatically cleaner
- Unified dashboard and webhook system
- Better merchant protections on disputes
- Lower account-freeze risk (PayPal's reputation for freezing new accounts is real)
- Credit card option for users who prefer it

### Fee math (baked into pricing, NO surcharges)

Assume worst-case fees to ensure margin:
- Stripe CC: 2.9% + $0.30
- PayPal via Stripe: ~3.49% + $0.49

All pricing in this doc assumes ~5% + $0.50 worst-case fees and still delivers >80% margin on token costs.

### No surcharges — ever

PayPal's User Agreement explicitly prohibits surcharges. Credit card network rules are also restrictive and several US states ban card surcharges outright. Don't do it — it's illegal in places, violates merchant agreements, and tanks conversion by 20-30%.

If incentivizing a payment method, structure it as a **discount on the cheaper option** ("Save $0.50 paying by card") rather than a penalty on the expensive one. Same math, much better user psychology.

## Architecture

### Data model (Supabase)

```sql
-- users table (extends Supabase auth.users)
user_profiles:
  id (uuid, references auth.users)
  email
  created_at
  subscription_tier: enum('free', 'hobbyist', 'collector', 'pro')
  subscription_status: enum('active', 'cancelled', 'past_due', null)
  subscription_renews_at: timestamp
  free_grades_used_this_month: int (resets monthly)
  free_grades_reset_date: date

-- token balance
user_tokens:
  user_id (uuid, FK)
  balance: int
  last_updated: timestamp

-- transaction ledger (append-only for auditing)
token_transactions:
  id
  user_id
  amount: int (positive = credit, negative = debit)
  type: enum('purchase', 'subscription_grant', 'grade_used', 'refund', 'bonus', 'beta_grant')
  reference: string (stripe_session_id, grade_id, etc.)
  created_at: timestamp
  balance_after: int

-- grade history
grades:
  id
  user_id
  card_id (from pHash identification)
  grade_type: enum('standard', 'express', 'deep')
  tokens_spent: int
  status: enum('queued', 'processing', 'complete', 'failed')
  submitted_at: timestamp
  completed_at: timestamp
  result_json: jsonb
```

### Stripe webhook handler (Vercel serverless)

```javascript
// api/stripe-webhook.js
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionChange(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionCancelled(event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await handleSubscriptionRenewal(event.data.object);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailure(event.data.object);
      break;
  }
  
  res.json({ received: true });
}

async function handleCheckoutComplete(session) {
  const { user_id, pack_id } = session.metadata;
  const tokens = TOKEN_PACKS[pack_id].tokens;
  
  // Credit user's token balance
  await supabase.rpc('credit_tokens', {
    p_user_id: user_id,
    p_amount: tokens,
    p_type: 'purchase',
    p_reference: session.id
  });
}
```

### Grade request flow

```javascript
// api/grade-card.js
export default async function handler(req, res) {
  const { user_id, card_image, grade_type } = req.body;
  
  // 1. Check auth
  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  
  // 2. Determine token cost
  const tokenCost = {
    'standard': 1,
    'express': 2,
    'deep': 4
  }[grade_type];
  
  // 3. Check and deduct tokens (atomic via stored procedure)
  const deductResult = await supabase.rpc('deduct_tokens_or_use_free', {
    p_user_id: user_id,
    p_amount: tokenCost,
    p_grade_type: grade_type
  });
  
  if (!deductResult.success) {
    return res.status(402).json({ 
      error: 'insufficient_tokens',
      balance: deductResult.balance 
    });
  }
  
  // 4. Check daily/monthly abuse caps
  const usageCheck = await checkUsageCaps(user_id);
  if (usageCheck.exceeded) {
    // Refund token and block
    await supabase.rpc('credit_tokens', { ... });
    return res.status(429).json({ error: 'daily_cap_exceeded' });
  }
  
  // 5. Route to batch or real-time based on grade_type
  if (grade_type === 'standard') {
    const gradeId = await queueForBatch(card_image, user_id);
    return res.json({ status: 'queued', grade_id: gradeId, eta: '1-3 hours' });
  } else {
    const result = await gradeRealtime(card_image, grade_type);
    return res.json({ status: 'complete', result });
  }
}
```

### Batch processing worker

Runs on a schedule (Vercel cron or external worker):

```javascript
// cron/process-batch.js (runs every 15 minutes)
export default async function handler(req, res) {
  // 1. Pull queued grades
  const { data: queuedGrades } = await supabase
    .from('grades')
    .select('*')
    .eq('status', 'queued')
    .limit(100);
  
  if (queuedGrades.length === 0) return res.json({ processed: 0 });
  
  // 2. Submit to Anthropic Batch API
  const batchId = await anthropic.batches.create({
    requests: queuedGrades.map(g => ({
      custom_id: g.id,
      params: buildGradeRequest(g)
    }))
  });
  
  // 3. Mark as processing
  await supabase
    .from('grades')
    .update({ status: 'processing', batch_id: batchId })
    .in('id', queuedGrades.map(g => g.id));
  
  res.json({ processed: queuedGrades.length, batch_id: batchId });
}

// cron/check-batches.js (runs every 30 minutes)
// Polls Anthropic for completed batches, updates grades, notifies users
```

### Notification system for batch results

For PWA (current):
- Email via Resend/SendGrid when batch completes
- In-app notification indicator on next open

For native app (future):
- Push notifications (real-time, expected UX)

## Fraud / Abuse Protection

### Daily usage caps

Per-user limits to prevent runaway costs from bugs, scripts, or abuse:

- **Free tier:** 3 grades/month (hard cap)
- **Hobbyist:** 50 grades/day soft cap (warn at 45)
- **Collector:** 150 grades/day soft cap
- **Pro:** 500 grades/day soft cap

Soft cap = warn user, require confirmation for additional grades. Hard cap at 2x soft = block and require support contact.

### Payment fraud detection

Stripe Radar (free with Stripe Checkout) handles card fraud. For PayPal transactions, rely on PayPal's built-in fraud tools. Additional:

- Block multiple accounts from same IP creating free tier accounts (simple Supabase RLS rule)
- Require email verification before free tier grades usable
- Flag accounts that generate chargebacks for manual review

### Subscription abuse

- New subscriptions: 7-day delay before first batch of tokens granted (prevents "sign up, use 100 tokens, cancel" pattern)
- Or: tokens granted immediately but cancellation means loss of unused tokens (clearer contract, more user-friendly)
- Bob's call which model to use

## Free Tier Considerations

### Monthly reset mechanic

Free grades reset on the user's account anniversary date, not calendar month. Avoids the "everyone at midnight on the 1st" spike. Simple cron:

```sql
UPDATE user_profiles
SET free_grades_used_this_month = 0,
    free_grades_reset_date = free_grades_reset_date + INTERVAL '1 month'
WHERE free_grades_reset_date <= CURRENT_DATE;
```

### What free users can still do

- Algorithmic grade (existing pixel math, zero API cost) — unlimited
- pHash card identification — unlimited
- Collection tracking — unlimited
- View previously graded cards — unlimited
- Basic features of the app

This is critical. Free users who can only try the app 3 times a month won't build habits. Free users who can use the app daily but only get AI grades 3x/month will understand the value and upgrade naturally.

## Beta User Grandfather

When monetization flips on, existing beta users should be thanked:

- One-time grant of 100 tokens (enough for ~3 months of casual use)
- Mark `beta_tester: true` in profile for special badge/recognition
- Optional: 30-day free trial of Hobbyist tier for beta users who want to try Express
- Email announcement explaining the new pricing with sincere thanks

Cost to Bob: 100 tokens × $0.017 worst case × (# beta users) = minimal. Goodwill: high.

## Implementation Order (When Bob Gives Green Light)

1. Set up Stripe account + test mode; enable PayPal as payment method in Stripe
2. Supabase schema migrations for user_profiles, user_tokens, token_transactions, grades
3. Auth flow (Supabase Auth handles most of this)
4. Token balance display in app UI
5. Stripe Checkout integration for credit packs (simpler than subscriptions, build first)
6. Stripe webhook handler for pack purchases
7. Grade endpoint with token deduction logic
8. Batch vs real-time routing (requires batch API setup from grading handoff doc)
9. Subscription tier integration (monthly token grants)
10. Subscription webhook handlers (renewal, cancellation, failed payment)
11. Usage caps and abuse protection
12. Email notifications for batch completions
13. Beta user grandfather script
14. Admin dashboard for Bob (view users, manually credit tokens, refund, etc.)
15. Native app IAP integration (deferred until native app exists)

## File Manifest (New)

- `api/stripe-webhook.js` — handles all Stripe/PayPal payment events
- `api/grade-card.js` — grade request with token deduction
- `api/purchase-pack.js` — initiates Stripe Checkout session
- `api/subscribe.js` — initiates Stripe subscription checkout
- `api/user-profile.js` — fetch user's tokens, subscription, usage
- `cron/process-batch.js` — submits queued grades to Anthropic Batch API
- `cron/check-batches.js` — polls for batch completion, notifies users
- `cron/reset-free-tier.js` — monthly free-grade resets
- `src/components/TokenBalance.jsx` — UI showing current token count
- `src/components/PricingPage.jsx` — credit packs + subscription tiers
- `src/components/GradeHistory.jsx` — shows user's past grades with status
- `src/lib/billing.js` — client-side billing utilities
- `supabase/migrations/` — database schema

## Environment Variables Needed

```
STRIPE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY  
STRIPE_WEBHOOK_SECRET
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY  (server-side only)
ANTHROPIC_API_KEY     (already exists from grading doc)
RESEND_API_KEY        (or SendGrid/similar for email notifications)
```

## Cost Projections (For Sanity Checking)

### Assumption: 1,000 active users/month after launch

- 40% Free tier (400 users × 3 grades × $0.009 = $10.80/mo API cost, $0 revenue)
- 40% Hobbyist tier (400 × $5 = $2,000/mo revenue, ~30 grades avg × $0.012 mixed batch/express = $144/mo API cost)
- 15% Collector tier (150 × $15 = $2,250/mo, 120 grades avg × $0.013 = $234/mo)
- 5% Pro tier (50 × $40 = $2,000/mo, 250 grades avg × $0.015 = $187/mo)

**Monthly revenue: ~$6,250**
**Monthly API cost: ~$576**
**Payment processing fees (~4%): ~$250**
**Supabase/Vercel/misc infra: ~$50**
**Gross margin: ~$5,374 (86%)**

These are healthy unit economics. Real numbers will vary, but the structure holds: API costs stay a small fraction of revenue because of prompt caching + batch API discounts.

## Open Questions for Bob (Before Building)

1. **Token pricing:** $0.20 baseline feels right but worth A/B testing. Start here?
2. **Subscription rollover:** Unused tokens roll 1 month then expire? Or no rollover? Or unlimited rollover with cap?
3. **Beta grandfather amount:** 100 tokens suggested — adjust up or down?
4. **Free tier monthly allowance:** 3 standard grades/month — enough to hook users without being abusable?
5. **Bulk submission discount threshold:** 50+ cards for 0.8 tokens each? Or different tier?
6. **Refund policy:** Lax (any reason, 7 days) or strict (technical issues only)?
7. **Admin dashboard scope:** What does Bob need visibility into — user list, revenue chart, grade volume, anything else?
8. **Native app timing:** Build IAP into v1 of this billing system, or wait until native app is actually ready?

## Deferred / Out of Scope

- Team accounts (multiple users, shared token pool) — future consideration
- Gift cards / token gifting between users — future consideration  
- Referral program (earn tokens for inviting friends) — future consideration, powerful growth lever
- Affiliate program — future, when volume justifies
- B2B API for card shops — very future, different pricing model entirely
