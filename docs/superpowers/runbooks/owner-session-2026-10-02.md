# Owner session checklist — 2026-10-02

Everything that only you can do, in the order that unblocks the most. Each step says where to
click and what to paste. Tick them off here; I update `docs/STATUS.md` from this file.

## A. Supabase (15 min)

1. **Apply three migrations** in the SQL editor (Dashboard → SQL → New query), one file at a
   time, in this order. Each is safe to re-run.
   - [ ] `supabase/migrations/20261001_lockdown.sql` — closes the self-granted-credits hole
   - [ ] `supabase/migrations/20261002_account_deletion.sql` — makes Delete Account work
   - [ ] `supabase/migrations/20261002_apple_iap.sql` — credit ledger (`grant_credits`,
     `spend_credits` v2, `revoke_credits`, `revoke_credits_by_payment`), needed by **every**
     web purchase from now on and by Apple IAP
   Check: `select proname from pg_proc where proname in ('grant_credits','revoke_credits_by_payment','spend_credits');` returns three rows.
2. [ ] **Auth redirect allow-list**: Authentication → URL Configuration → Redirect URLs → add
   `https://www.slabsenseai.com/?recovery=1` (password reset lands there).
3. [ ] **Demo account for App Review**: Authentication → Users → Add user
   `review@slabsenseai.com` with a password you store in the notepad file (never in chat). Then in
   SQL: `select grant_credits('<that user id>', 10, 'pack', 'review:seed', 'App Review demo credits');`

## B. Keys (10 min)

4. [ ] **Rotate** the Google AI key and the OpenAI key that sat in the old root key file (now in
   `../SlabSense-data/`). Create new ones in each console, revoke the old, paste the new values
   into Vercel → Settings → Environment Variables (`GOOGLE_AI_API_KEY`, `OPENAI_API_KEY`) and into
   `.env.local` via the notepad file. Neither is used by a grade today; rotating removes the
   exposure.
5. [ ] **Delete the temp Anthropic key** (7-day key from the accuracy run) in the Anthropic
   console once you are done with it; remove it from `.env.local`.
6. [ ] **History rewrite decision** for the two TAG signing constants in old commits of the public
   repo: yes (I rewrite + force-push both branches, you re-clone) or no (rotate the TAG values
   instead, already done). Tell me which.

## C. Stripe (20 min, test mode first, then live)

7. [ ] Create three products with one price each (Products → Add product):
   | Product | Type | Price | Env var |
   |---|---|---|---|
   | SlabSense Plus | recurring, monthly | your number (code default $9.99) | `STRIPE_PRICE_PLUS_MONTHLY` |
   | 5 AI Grades | one-time | your number (code default $7.99) | `STRIPE_PRICE_GRADES_5` |
   | 20 AI Grades | one-time | your number (code default $24.99) | `STRIPE_PRICE_GRADES_20` |
   Copy each **price** id (`price_…`, not `prod_…`) into Vercel under the env var name. Redeploy.
8. [ ] Webhook endpoint (Developers → Webhooks → the `https://www.slabsenseai.com/api/stripe/webhook`
   endpoint): add the events `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`
   (`checkout.session.completed` is already there).
9. [ ] Tell me the final three prices so `src/lib/products.js` matches (web display uses them).
10. [ ] The old nine `STRIPE_PRICE_*` variables (trial, hobby, pro, dealer, single, pack_10…50)
    can be deleted from Vercel; nothing reads them.
11. [ ] Test: buy the 5-pack in test mode with card `4242 4242 4242 4242`; the balance should rise
    by 5 within a minute. Then repeat the three products in live mode when you flip the keys
    (slab go-live checklist in `docs/superpowers/runbooks/slab-order-setup.md`).

## D. Decisions I need from you (5 min, just answers)

12. [ ] **Header text** for every source file (3e), e.g. `Copyright © 2026 <name>. All rights
    reserved.` plus any line you want. Give me the exact text.
13. [ ] **Copyright line** for the App Store listing (same name or entity).
14. [ ] **Support mailbox**: confirm `support@slabsenseai.com` exists and is read.
15. [ ] **Governing law**: the Terms say Indiana. Confirm or change.
16. [ ] **Mac for the iOS build** (3f): your own Mac, a rented cloud Mac (MacStadium, MacinCloud),
    or a GitHub Actions macOS runner. The native shell cannot be built or submitted without one.
17. [ ] **Models-off fallback** (audit D-06): when the on-device models crash-guard switches them
    off, the old pixel detectors decide the free grade silently. Options: (a) label that grade
    "corners/edges unchecked", (b) keep the fallback and gate it in the harness. Pick one.

## E. App Store Connect (30 min, needs the Apple Developer account)

18. [ ] App record: bundle id `com.slabsense.app`, name SlabSense, primary language English (US).
19. [ ] In-app purchases from `docs/app-store/listing.md` §2 (ids must match exactly), subscription
    group "SlabSense Plus".
20. [ ] App Information → App Store Server Notifications V2 URL (production and sandbox):
    `https://www.slabsenseai.com/api/apple?action=notifications`.
21. [ ] Vercel env: `APPLE_APP_APPLE_ID` (the numeric Apple ID of the app record),
    `APPLE_ENVIRONMENT=Sandbox` until launch.
22. [ ] Sandbox tester account (Users and Access → Sandbox).

## F. Photos (when convenient)

23. [ ] Shoot one card front and back with the app for the review sample pair, and pick the card
    for screenshots (your own card, not a TAG studio photo).

When you are done, tell me which boxes are ticked and I will verify each one from my side
(migration functions present, webhook events, env vars via a redeploy log) and update STATUS.
