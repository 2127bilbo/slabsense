# B. Payments and subscriptions inventory

Audit date 2026-10-01, read-only, branch `tag-dataset`. Paths are repo-relative.

**Summary: 22 findings — 3 Blocker, 12 Major, 4 Minor, 3 Note.**
Blockers: digital goods sold in-app through Stripe (B-01); the $4.99 trial is sold as auto-renewing but is a one-time payment that never renews (B-02); any signed-in user can write their own `credits_balance` / `subscription_status` through the `profiles` RLS policy (B-03).
Only the **slab** price has ever run (Stripe test mode, verified 2026-09-14). The nine credit/subscription prices have no evidence of ever being configured, let alone paid.

---

## 1. Stripe price keys

Price ids come only from env (`api/stripe/create-checkout.js:26-37`, `api/stripe/webhook.js:25-35`). Display prices live in `src/services/credits.js:142-158` and are not read from Stripe.

| Key (env) | Buys (UI price) | Credits granted | Granted where | Ran for real? |
|---|---|---|---|---|
| `STRIPE_PRICE_TRIAL` | "7-Day Trial" $4.99 once, "auto-renews to Hobby" (`PricingPage.jsx:221-224`) | 5 | `webhook.js:180-192` `profiles.update` (status `trial`, `used_trial`, `subscription_id = session.subscription`, renews +7 d); ledger row `webhook.js:231-238` | **No.** Checkout `mode: 'payment'` (`create-checkout.js:162`); comments at `:157-167` say the subscription "will be handled in the webhook" — nothing does. |
| `STRIPE_PRICE_HOBBY` | $9.99/mo | 10 + bonus 7 (or 5 after trial) | `webhook.js:194-217`, bonus rows `:242-249` | **No** evidence (see B-07). |
| `STRIPE_PRICE_PRO` | $19.99/mo | 30 + bonus | same | No. |
| `STRIPE_PRICE_DEALER` | $49.99/mo | 100 + bonus | same | No. |
| `STRIPE_PRICE_SINGLE` | $1.99 × quantity | 1 (quantity ignored on grant) | `webhook.js:219-227`; grant is `productInfo.credits` = 1 regardless of `quantity` (`create-checkout.js:140`) | No. Quantity bug: 10 singles → charged 10 × $1.99, credited **1**. |
| `STRIPE_PRICE_PACK_10/20/30/50` | $14.99 / $29.99 / $39.99 / $49.99 | 10 / 20 / 30 / 50 | `webhook.js:219-227` | No. |
| `STRIPE_PRICE_SLAB` | Physical slab, US shipping | none (mints a `slabs` row) | `webhook.js:141-145` → `api/_lib/slabs.js:71-92` | **Test mode yes** (memory `stripe-go-live-checklist`: full flow verified 2026-09-14); live not yet flipped. |

Evidence the nine credit keys never ran: not in `.env.local` (only Supabase/OpenAI/Google vars); `docs/PAYMENT_PLAN.md:324-332` lists them as `price_...` placeholders; every PAYMENT_PLAN phase box is unchecked (`:238-300`), including "Full flow in Stripe test mode"; `git log` shows `webhook.js`/`create-checkout.js` untouched since the 2026-06-09 "Phase 2-3" commit except the slab edits of 2026-09-12/13; no test covers the webhook (only `scripts/verify-slabs-lib.cjs` and `api/_lib/{credits,gradeJobs}.test.js`). When the env vars are unset, `CREDIT_AMOUNTS` collapses to one key `"undefined"` (`webhook.js:25-35`) and every credit key fails `create-checkout.js:63` with `Invalid price key`.

## 2. Entry points and events

| Entry point | Auth | Notes |
|---|---|---|
| `POST /api/stripe/create-checkout` (`create-checkout.js:42`) | **slab only** (`:70-74`); other keys trust `req.body.userId` (`:57-60`) | Creates Stripe customer and writes `profiles.stripe_customer_id` for any profile id (`:98-112`). Default success URL `slabsense.com` (`:148-149`), wrong domain. |
| `POST /api/stripe/create-portal` (`create-portal.js:210`) | **none**; `userId` from body (`:225`) | Returns a Billing Portal URL for any user's Stripe customer. |
| `POST /api/stripe/webhook` (`webhook.js:44`) | Stripe signature (`:68`) | Idempotency on `stripe_events` (`:75-90`), claim released on failure (`:120`). |
| Client: `src/services/credits.js:95-115` (`createCheckout`), `:120-134` (portal), `src/services/slabs.js:13-29` (`orderSlab`) | sends JWT | Server ignores the JWT for non-slab keys. |

Events a subscription lifecycle needs vs handled (`webhook.js:95-114`):

| Event | Handled | Gap |
|---|---|---|
| `checkout.session.completed` | yes `:128-255` | credit path does not check `payment_status === 'paid'` (slab path does, `slabs.js:26`) |
| `invoice.paid` | yes `:260-314` | reads `invoice.subscription` (`:267`), removed in Stripe API 2025-03-31 (`stripe@^22`, `package.json:33`); `slabs.js:32` already handles the same API's `collected_information` rename, the invoice path does not → see B-11 |
| `invoice.payment_failed` | **missing** | no past-due state, no email, credits stay |
| `customer.subscription.updated` | yes `:319-344` | any non-`active` status → `free` (`:338`), including `trialing`/`past_due`; `cancel_at_period_end` ignored; plan change does not adjust credits |
| `customer.subscription.deleted` | yes `:349-377` | credits not reclaimed; `credits_expire_at` untouched |
| `charge.refunded` / `charge.dispute.created` | **missing** | a Stripe refund leaves the credits (and a minted slab) in place |
| `customer.subscription.trial_will_end` | missing | only relevant if a real Stripe trial is ever created |

## 3. Credit ledger

**Tables.** `profiles` balance fields (`002_credits_system.sql:8-20`, re-declared `20260915_credits_atomic.sql:17-26`): `credits_balance`, `credits_expire_at`, `subscription_status`, `subscription_id`, `subscription_renews_at`, `used_trial`, `signup_bonus_*`, `referral_code`, `referred_by`, `cards_saved_count`, `stripe_customer_id`. A second, older model `profiles.tier` + `memberships` (`001_initial_schema.sql:11,113-129`) is still read by `src/hooks/useAuth.js:122` and written by nobody. `credit_transactions` (`20260915_credits_atomic.sql:28-51`): `amount`, `transaction_type`, `stripe_payment_id`, `scan_id`, `refunded_at`, `refund_of`. `ai_grade_jobs` (`20260915_ai_grade_jobs.sql:8-26`) with partial unique index on in-flight jobs. `stripe_events` for idempotency.

**Balance.** The balance is the column `profiles.credits_balance`, not a sum of the ledger. `api/credits/balance.js:44-58` reads it, and on a **GET** zeroes it and logs `expired` when `credits_expire_at` has passed (write side effect in a read, non-atomic). `canUseAI`, `cardLimit`, `canSaveMore` (`:63-80`) are computed but no client code reads them.

**Spend.** `api/_lib/credits.js:22-33` → `spend_credits()` (`20260915_credits_atomic.sql:58-114`): `SELECT … FOR UPDATE`, lifetime check, expiry check, balance check, deduct, log — atomic. Falls back to a read-modify-write `legacySpend` (`credits.js:69-120`) if the function is missing. Only callers: `runGradeJob` (`api/_lib/gradeJobs.js:76-78`), used by `api/ai-analyze-unified.js:238` and `api/deep-analyze-v2.js:518`, plus the standalone `POST /api/credits/spend` (`api/credits/spend.js`) which the client no longer calls (`src/services/credits.js:35-54` kept "for non-grade uses").

**Refund.** `refund_credits()` (`…atomic.sql:120-165`): own transaction only, `grade_ai`/`grade_deep` only, once (`refunded_at`), never extends expiry. Called server-side on failure or duplicate (`gradeJobs.js:81-83,96-98`) and by `POST /api/credits/refund` (any user can refund their own failed grade transaction id; the server has already done so, so the endpoint is now redundant).

**Idempotency / races.**
- Spend/refund: atomic via row lock. Good.
- Grants (webhook) are **not** atomic: `profile.credits_balance + n` read-modify-write at `webhook.js:189,213,224,298,437`; no SQL function for grants exists.
- Webhook dedupe is select-then-insert (`webhook.js:75-90`) and the insert error is not checked: two concurrent deliveries of one event both pass.
- Expired balance: `spend_credits` refuses but does not zero; the webhook then adds to the stale balance and resets `credits_expire_at` (`webhook.js:224-225`), reviving expired credits.
- Jobs: a function timeout leaves `ai_grade_jobs.status='running'` forever; the credit is never refunded and `uq_ai_grade_jobs_inflight` blocks any retry on that card (`gradeJobs.js:36-52`; no sweep exists).

**Client trust.** The client never spends or decides from its own balance: `src/App.jsx:2323-2370` calls the grade endpoint, shows the pricing modal on 402. Display comes from `/api/credits/balance`. But the client **can write** the balance: `profiles` policy `"Users can update own profile" FOR UPDATE USING (auth.uid() = id)` (`001_initial_schema.sql:25-26`) has no column restriction and no later migration revokes column privileges; `updateProfile(userId, updates)` (`src/services/auth.js:103-115`) forwards arbitrary columns. Any user can run `supabase.from('profiles').update({credits_balance: 9999, subscription_status: 'lifetime'})` with the anon key.

**Body `userId`.** `credits/{balance,spend,refund}.js` and both grade endpoints derive the user from the JWT and reject a mismatching body id (`balance.js:25-26`, `spend.js:27-28`, `refund.js:28-29`). `create-checkout.js:57-60` (non-slab keys) and `create-portal.js:225-229` take it from the body with no auth at all. The memory note "non-slab price keys still trust body userId" is accurate and extends to the portal.

## 4. Referrals, trials, free credits, admin grants

- **Referrals**: tables and `system_settings.referrals_enabled` exist (`002_credits_system.sql:57-84`); the webhook awards 5 credits (`webhook.js:382-451`). Nothing generates `referral_code`, writes `referred_by`, or inserts `referrals` rows anywhere in `src/` or `api/` (grep). Dead end-to-end.
- **Signup bonus**: +7 / +5 on first subscription (`webhook.js:197-205`); `signup_bonus_eligible` revoked on cancel after trial (`:367-369`). UI shows "+7 bonus credits (first time)" when `!balance.signup_bonus_awarded` (`PricingPage.jsx:303-313`) but `balance.js` returns `bonusEligible`, never `signup_bonus_awarded` → badge always visible.
- **Trial**: eligibility check `create-checkout.js:88-93`; see B-02.
- **Free credits**: none on signup; `handle_new_user()` (`001:28-35`) sets no balance. Free tier "5 saved cards" is computed from `cards_saved_count` (`balance.js:65`) which nothing increments.
- **Admin / lifetime grants**: only hand SQL in a comment (`002_credits_system.sql:122-132`); no admin endpoint or UI. `ADMIN_USER_IDS` gates slab routes only.
- **Expiry**: all credits 30 days from last grant, including subscription renewals (`webhook.js:177,292`); `PricingPage.jsx:525` states this.

## 5. Mocked or incomplete code paths

| Path | Why mocked |
|---|---|
| `create-checkout.js:26-35` nine price keys | env vars never set anywhere (no `.env`, no runbook, placeholders only in `PAYMENT_PLAN.md:324-332`). |
| `create-checkout.js:157-167` trial | comment-only design; `mode:'payment'`, no subscription, no `trial_end`. |
| `webhook.js:187` `subscription_id: session.subscription` for trial | always `null` in payment mode. |
| `webhook.js:260-314` renewals | field removed in the pinned Stripe API; never exercised. |
| `webhook.js:382-451` referral bonus | no writer for `referred_by`/`referrals`. |
| `PricingPage.jsx:59-73` singles "auto-pack" pricing | UI math only; server sends `single × qty` (`create-checkout.js:140`). |
| `PricingPage.jsx:303-313` bonus badge | reads a field the API does not return. |
| `balance.js:63-80` `canUseAI`/`cardLimit`/`canSaveMore` | backend without UI; `cards_saved_count` never written. |
| `src/hooks/useAuth.js:122` `isPro` from `profiles.tier` | reads the pre-credits model; `tier` never written; `GradeDisplay` defaults `isPro = true` (`App.jsx:224`). |
| `api/credits/spend.js`, `api/credits/refund.js` | backend without a caller after 1536f32; both still count against the Vercel 12-function cap. |
| `memberships` table (`001:113-129`) | never read or written. |
| `/billing?success=true` return URL (`credits.js:104`) | SPA has no route handling; nothing reads `location.search` (grep). Works by accident: `CreditBalance` refetches on mount. |
| `src/components/Billing/CreditBalance.jsx:40` `window.refreshCreditBalance` | global side effect; fine for web, fragile in a native shell. |

## 6. Slab order (physical goods, stays on Stripe)

Flow: `CollectionView.jsx:246-256` "Get it slabbed" (graded cards with an image only, `:815-818`) → `src/services/slabs.js:13-29` POST with JWT → `create-checkout.js:70-74` verifies the JWT user equals `userId`, `:115-131` verifies scan ownership, grade, image → `slabSessionParams` (`api/_lib/slabs.js:8-22`: card only, US shipping, metadata `price_key:'slab'`) → `webhook.js:141-145` → `slabOrderFromSession` (`slabs.js:25-34`, throws unless `payment_status==='paid'`) → `mintSlab` (`slabs.js:71-92`, select-before-insert idempotent on `stripe_session_id`, cert from `next_cert()` sequence) → images copied to `slab-images/<cert>/` → status `paid → engraved → shipped` via admin routes (`api/_lib/routes/slabs-status.js`, `assertTransition` `slabs.js:99-101`). RLS: owner reads own slabs; only service role writes (`20260912_slabs.sql:34-37`). Tested with fakes (`scripts/verify-slabs-lib.cjs`).

This is the one well-built payment path and is Apple-compatible under 3.1.3(e) (physical goods may use non-IAP payment). For the native app it must open Checkout in an in-app browser / external Safari, and the success URL must deep-link back. Gaps: no `charge.refunded` handling (a refunded order keeps its cert), and `slabs.user_id` FK has no `ON DELETE` (`20260912_slabs.sql:19`), so account deletion fails while an order exists (B-15).

## 7. Entitlement model for Apple

Product mapping (D2 default: subscriptions + one consumable; keep packs if the owner wants parity):

| Apple product | Type | Ledger effect | Reuse | New |
|---|---|---|---|---|
| `credits.pack10/20/30/50` | consumable | `credit_transactions` row `type='purchase_apple'`, `external_id = transactionId` unique; `credits_balance += n` | `spend_credits`, `refund_credits`, `runGradeJob`, `balance.js` unchanged | `grant_credits(p_user, p_amount, p_source, p_external_id, p_expires)` SQL function, atomic and idempotent on `external_id` — replaces every inline grant in `webhook.js` for Stripe too |
| `sub.hobby/pro/dealer` (one subscription group, monthly) | auto-renewable | `profiles.subscription_status`, new `subscription_source` (`stripe`/`apple`), `apple_original_transaction_id`, `subscription_expires_at` from Apple; allowance granted per period via `grant_credits` keyed on the renewal `transactionId` | `LIFETIME_STATUSES`, status gating in `balance.js` | `POST /api/apple/verify` (client sends the JWS transaction; server verifies with Apple root certs or the App Store Server API `getTransactionInfo`, then grants); `POST /api/apple/notifications` (ASSN v2, JWS verified, idempotent on `notificationUUID`) |
| trial | introductory offer on `sub.hobby` (free or pay-up-front), not a product | `used_trial` ← Apple `offerType`; bonus rules re-derived from Apple's `isUpgraded`/first renewal | — | drop `STRIPE_PRICE_TRIAL` entirely |
| single credit | drop, or `credits.single` consumable | — | — | — |
| slab | **not** an Apple product | unchanged | all of §6 | native hand-off to Checkout URL |

App Store Server Notifications V2 the API must handle: `SUBSCRIBED` (INITIAL_BUY, RESUBSCRIBE), `DID_RENEW`, `DID_CHANGE_RENEWAL_PREF` (plan change at next period), `DID_CHANGE_RENEWAL_STATUS` (auto-renew off → "ends on"), `DID_FAIL_TO_RENEW` (+`GRACE_PERIOD`), `GRACE_PERIOD_EXPIRED`, `EXPIRED`, `REFUND` (claw back the granted credits; clamp at 0 and record a negative ledger row), `REFUND_DECLINED`, `REVOKE` (family sharing), `CONSUMPTION_REQUEST` (must answer with `sendConsumptionInformation` within 12 h for consumable refund decisions — needs "credits consumed" from the ledger), `ONE_TIME_CHARGE` (consumables), `RENEWAL_EXTENDED`, `PRICE_INCREASE`, `TEST`. Restore: subscriptions re-derived from the latest transaction for the `appAccountToken` (set `appAccountToken = profile.id` on purchase so Apple ties receipts to our user); consumables are not restorable, so the ledger is the record. Multiplatform (3.1.3(b)): web Stripe purchases must show in the app — they already land in the same ledger; the native build must hide `PricingPage`'s Stripe buttons and the portal link and show Apple's subscription management link instead. Vercel Hobby cap is 12 functions; today 10 (`api/*.js`, `credits/*`, `stripe/*`); the two Apple endpoints hit the cap — fold `credits/*` into one function like `api/slabs.js` first.

## Findings

B-01 | Blocker | `src/components/Billing/PricingPage.jsx:41-52,228,319`; `src/services/credits.js:95-115` | Apple 3.1.1 | Credits and subscriptions (digital goods consumed in-app) are sold through Stripe Checkout from inside the app UI; no IAP path exists, no Capacitor/StoreKit dependency in `package.json`. | Build the §7 model; in the native build render only Apple purchase buttons; keep Stripe Checkout for web and slabs.

B-02 | Blocker | `api/stripe/create-checkout.js:157-167`; `api/stripe/webhook.js:180-192`; `PricingPage.jsx:221-224` | Apple 3.1.2 / 2.3.1 accurate terms; user cannot legitimately buy what is described | UI promises "Auto-renews to Hobby ($9.99/mo)"; checkout is `mode:'payment'`, `session.subscription` is null, nothing schedules a renewal; the user is charged $4.99 for 5 credits that expire in 30 days and `subscription_status='trial'` is never cleared. | Replace with an Apple introductory offer on the Hobby subscription (and a real Stripe `trial_end` subscription on web); remove `STRIPE_PRICE_TRIAL`.

B-03 | Blocker | `supabase/migrations/001_initial_schema.sql:25-26`; `src/services/auth.js:103-115` | Payment integrity (an entitlement the client can forge is not a legitimate purchase system; Apple's ledger-following requirement in the plan's Review Focus #2) | `profiles` UPDATE policy has no column restriction; the anon-key client can set `credits_balance`, `subscription_status`, `used_trial`, `signup_bonus_*`. | `REVOKE UPDATE ON profiles FROM authenticated; GRANT UPDATE (display_name, username, preferred_company) ON profiles TO authenticated;` (or a trigger that rejects changes to billing columns unless `current_setting('role')='service_role'`); add a test.

B-04 | Major | `api/stripe/webhook.js:95-114` | Subscription lifecycle completeness | `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created` unhandled; `cancel_at_period_end` ignored; `past_due`/`trialing` collapse to `free`. A Stripe refund keeps the credits and the slab cert. | Handle the three events (past_due state, credit claw-back, slab `refunded` status); map Stripe statuses explicitly.

B-05 | Major | `api/stripe/webhook.js:75-90,189,213,224,298,437` | Idempotency / atomicity | Dedupe is select-then-insert with the insert error unchecked, so concurrent deliveries both credit; every grant is a read-modify-write on `profiles`. | Insert into `stripe_events` first and treat a `23505` as duplicate; move all grants to an atomic `grant_credits(external_id)` function (shared with Apple).

B-06 | Major | `api/stripe/create-checkout.js:57-60,98-112`; `api/stripe/create-portal.js:225-253` | Auth: body-supplied identity | Non-slab checkout never calls `requireUser`; the portal never authenticates at all, so any caller with a profile id gets a Billing Portal URL for that user's Stripe customer (cancel their plan, see invoices, change card). Also creates Stripe customers for arbitrary ids. | Apply `requireUser` + `payer.id === userId` (as the slab branch does, `:70-74`) to every key and to the portal; drop `userId` from both bodies.

B-07 | Major | `api/stripe/create-checkout.js:26-35`; `api/stripe/webhook.js:25-35`; `docs/PAYMENT_PLAN.md:238-300` | "Mostly mocked" confirmed | Nine price env vars have never been configured (no env file, no runbook, placeholders only; all PAYMENT_PLAN phases unchecked; code untouched since 2026-06-09). With them unset `CREDIT_AMOUNTS` keys collide on `"undefined"`. | Treat the whole credits/subscription Stripe path as unshipped; rebuild for web after the Apple model is designed, with prices fetched from Stripe (`prices.list`) not duplicated in `credits.js:142-158`.

B-08 | Major | `PricingPage.jsx:303-313`; `api/credits/balance.js:67-81`; `webhook.js:382-451` | 2.3.1 accurate offers | "+7 bonus credits (first time)" is shown to everyone because the API returns `bonusEligible`, not `signup_bonus_awarded`; referral bonus code has no producer of `referred_by`/`referrals`. | Return `bonusAwarded`/`bonusEligible` and gate the badge on both; delete the referral code or implement the signup side; either way remove the dead `system_settings` toggle from scope.

B-09 | Major | `PricingPage.jsx:206-330` | Apple 3.1.2 (price, period, renewal and cancellation terms; management link; restore) | No renewal/cancel terms, no privacy/terms links, no "Restore purchases"; the PAYMENT_PLAN disclosure text (`PAYMENT_PLAN.md:62-68`) was never implemented. | Native pricing screen must show Apple's required terms and `showManageSubscriptions`; web screen gets the Stripe equivalent.

B-10 | Major | `api/credits/balance.js:44-58`; `api/stripe/webhook.js:224-225,298-300` | Ledger correctness | Expiry is enforced only when `/balance` happens to be read; a purchase before that read adds to the stale expired balance and resets `credits_expire_at`, reviving expired credits; the GET also writes. | Expire inside `grant_credits` (zero + `expired` row before adding) and in `spend_credits`; make `/balance` read-only.

B-11 | Major | `api/stripe/webhook.js:267,282`; `package.json:33` | Renewal path cannot run | `invoice.subscription` was removed in Stripe API 2025-03-31 (basil), which `stripe@^22` pins; `subscriptionId` is undefined and `subscriptions.retrieve` throws → 500 on every renewal, forever retried. The slab code already handles the same API's rename (`slabs.js:32`), the invoice code does not. | Read `invoice.parent.subscription_details.subscription` (fallback to `invoice.subscription`); use `invoice.lines.data[0].pricing.price_details.price` instead of a second API call; add a webhook test with fixture events.

B-12 | Major | `PricingPage.jsx:59-73`; `api/stripe/create-checkout.js:138-141`; `webhook.js:30,219-227` | Price shown ≠ price charged ≠ credits granted | UI shows 10 singles as "$14.99 (10-Pack)"; server bills `single × 10` at $1.99 = $19.90; webhook grants 1 credit regardless of quantity. | Remove the singles cart (Apple has no quantity for consumables); if kept on web, map quantity to the pack price id server-side and multiply the grant by `quantity`.

B-13 | Major | `api/stripe/webhook.js:128-145,167-228` | Pay-before-deliver | Credit grants run on `checkout.session.completed` without checking `payment_status === 'paid'`; delayed payment methods would be credited before funds arrive (the slab path guards this at `slabs.js:26`). | Reuse the slab guard for every key; handle `checkout.session.async_payment_succeeded/failed`.

B-14 | Major | `api/_lib/gradeJobs.js:36-52,76-98`; `supabase/migrations/20260915_ai_grade_jobs.sql:17-19` | Entitlement correctness, Review Focus #2 | A Vercel timeout or crash mid-`run()` leaves the job `running`; the credit is never refunded and the partial unique index blocks every retry on that card. No sweep or `started_at` TTL exists. | On `createJob` conflict, treat a `running` job older than `maxDuration` as failed: refund its `transaction_id`, mark `error`, proceed; add a scheduled sweep.

B-15 | Major | `src/services/auth.js:131-157`; `supabase/migrations/20260912_slabs.sql:19`; `002_credits_system.sql:28` | Apple 5.1.1(v) account deletion; Review Focus #5 | Client-side delete removes scans then the profile: `slabs.user_id` has no `ON DELETE`, so deletion fails with an open order; `credit_transactions` cascade-delete destroys the financial record; the Stripe customer/subscription is never cancelled; `auth.users` survives. | Server-side `POST /api/account/delete`: cancel Stripe/Apple subscription, anonymise (not delete) ledger and slab rows, delete `auth.users` with the service role, and tell the user what happens to the order and balance. (Cross-ref A, F.)

B-16 | Minor | `supabase/migrations/001_initial_schema.sql:11,113-129`; `src/hooks/useAuth.js:122`; `src/App.jsx:224` | Two entitlement models | `profiles.tier` + `memberships` (pre-credits) vs `subscription_status`; `isPro` reads `tier`, which nothing writes; `GradeDisplay` defaults `isPro=true`. | Drop `tier`/`memberships` and `isPro`; derive gating from `/balance` only.

B-17 | Minor | `api/credits/balance.js:63-80`; `src/services/credits.js:35-54,59-78`; `api/credits/spend.js`, `refund.js` | Backend without UI / callers | `canUseAI`, `cardLimit`, `canSaveMore` are never read; `cards_saved_count` never incremented; `spendCredits`/`refundCredits` and their endpoints have no callers after 1536f32. | Delete the two endpoints and client functions (frees two Vercel function slots); decide the free-tier card limit or remove it.

B-18 | Minor | `api/stripe/webhook.js:177,188,292,300,330-341` | Subscription state accuracy | `subscription_renews_at` is `now + 30 d`, not Stripe's `current_period_end`; a plan change does not adjust the allowance; status mapping lossy. | Store Stripe/Apple period end verbatim; model `status` with the provider's enum plus `source`.

B-19 | Minor | `api/stripe/create-checkout.js:148-149`; `api/stripe/create-portal.js:252`; `src/services/credits.js:104-105` | Correctness | Server fallback domain is `slabsense.com` (live site is `slabsenseai.com`); `/billing?success=true` is not handled by the SPA. | Use `VITE_APP_URL` from env only (fail if unset); add a `?purchase=` handler that refreshes the balance and thanks the user (native: deep link).

B-20 | Note | `api/_lib/credits.js:21-26,69-120,161-195` | Legacy fallbacks | If `20260915_credits_atomic.sql` is not applied in production, spend/refund silently use the racy read-modify-write path (warning only). | Confirm the functions exist in prod (`select proname from pg_proc where proname in ('spend_credits','refund_credits')`), then delete the legacy paths.

B-21 | Note | `src/components/Billing/CreditBalance.jsx:40`; all `api/credits/*`, `api/stripe/*` `Access-Control-Allow-Origin: *` | Hygiene (cross-ref G) | Global `window.refreshCreditBalance`; wildcard CORS on authenticated money endpoints. | Replace the global with a context/event; restrict CORS to the app origins and the Capacitor scheme.

B-22 | Note | `api/` (10 functions), memory `stripe-go-live-checklist` | Vercel Hobby 12-function cap | Apple `verify` + `notifications` endpoints bring the count to 12; any further route breaks deploys. | Fold `credits/*` into one function (B-17 removes two anyway) and `stripe/*` into one with an `action` query, as `api/slabs.js` does.
