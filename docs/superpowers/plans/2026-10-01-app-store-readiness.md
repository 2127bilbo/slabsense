# App Store Readiness Program

> **For agentic workers:** this is a program plan: audit → review → fix → re-audit → submit. The
> audit phase produces findings, not code, and is run by read-only agents against the checklist in
> Phase 1. Each fix group in Phase 3 gets its own implementation plan in the
> `superpowers:writing-plans` task format once the audit has fixed its scope; execute those with
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]`.

**Goal:** Ship SlabSense as a native iOS app that passes App Store review on the first submission,
with real, Apple-compliant subscriptions and credits, no payment, privacy, IP or stability flags,
and a codebase clean enough that the review itself finds nothing we did not already know.

**Architecture:** The existing React app ships inside a Capacitor shell with native camera capture;
the Vercel API stays the backend; digital purchases move to Apple in-app purchase (StoreKit 2 on
the device, App Store Server API verification on our API), Stripe stays for the web and for the
physical slab order; grading, models and the engine are unchanged by this program.

**Tech Stack:** React 18 / Vite, Capacitor 6 (iOS), StoreKit 2 via `@capacitor-community/in-app-purchases`
or RevenueCat (decision in Phase 2), Supabase (auth, DB, storage), Vercel serverless API, Node test
runner (`npm run test:lib`), Playwright drivers for headless checks, Xcode 16 + TestFlight.

**Spec:** this document is its own spec; the owner's requirements are quoted in "Owner's
requirements". The audit output (`docs/audits/2026-10-app-store-audit.md`) becomes the spec for
every Phase 3 plan.

## Owner's requirements (verbatim intent, 2026-10-01)

- Audit the whole system first, "as if we were Apple", before any change. Document everything:
  unused code, code that can be cleaner, all payment code, the grading service tiers, every current
  warning. Then review and fix systematically, then run the same audit again.
- Payments are known-flawed: subscriptions are "mostly mocked up" and must be migrated to Apple's
  system so people can legitimately sign up.
- Every program and sub-program file gets our header (text to be specified by the owner).
- No copyright exposure in either direction: nothing of ours that infringes, nothing of ours left
  unprotected.
- UI will change for the migration; plan for it.
- Decide whether to keep one AI grade tier or both.
- Submit only when 100 % comfortable with the price points.

## Global Constraints

- No code changes until the Phase 1 audit is complete and reviewed (Phase 2). Bug fixes to the
  live web app are the one exception and are noted in the audit.
- The grading engine (`src/lib/gradingEngine.js` v1.1), the models and `docs/GRADING_SYSTEM.md`
  are not in scope for change; the native app consumes them as they are.
- The web app at slabsenseai.com keeps working throughout; the native app is an additional target
  built from the same `main`.
- Apple App Review Guidelines in force at submission time are the authority; cite the guideline
  number on every finding and fix (3.1.1 in-app purchase, 3.1.3 physical goods, 4.2 minimum
  functionality, 4.8 Sign in with Apple, 5.1.1 data collection, 5.1.1(v) account deletion, 5.2
  intellectual property, 1.2 user-generated content, 2.1 performance, 2.3 accurate metadata).
- Never commit secrets; the two already in the tree are rotated and removed in Phase 3a.
- All pushes to `main` deploy the web app; native-only changes must not break the web build.

## Review Focus

Five things this program implies that no checklist line tests, most likely to bite first:

1. A user on the web who bought credits with Stripe opens the native app: their credits must be
   there, and the native app must never show them a Stripe checkout. Test: one account, a web
   purchase, then a native sign-in shows the balance and only Apple purchase buttons.
2. A subscription renews, lapses or is refunded on Apple's side while the user is offline: our
   credit ledger must follow Apple's server notifications, not the device. Test: simulate
   `DID_RENEW`, `EXPIRED`, `REFUND` notifications against the API and check the ledger.
3. Reviewer taps every button with no network: nothing crashes, every failure has a message.
   Test: Playwright run with network blocked after load.
4. A card image that is not a Pokémon card, or a photo of a person, goes through grading: the
   app must say "no card found" and not send it to a third-party AI. Test: the capture check
   path with the card model returning no card.
5. Account deletion while a slab order is open or credits remain: deletion must still complete
   and tell the user what happens to the order and balance. Test: delete with an open order.

---

## Phase 0: Decisions the owner makes before the audit starts (30 minutes)

- [ ] **D1. Grading tiers in the native app:** one AI grade, or AI + Deep AI. Default proposal:
  ship **one** paid tier ("AI Grade") built on the Deep path's quality, with the standard AI path
  kept server-side for the web only. Reason: two tiers double the IAP products, the pricing
  questions, the review surface and the explanation burden, and the Deep path already carries the
  surface model and the corner/edge table. Decide in Phase 2 after the audit prices both.
- [ ] **D2. Purchase model:** consumable credits, auto-renewing subscriptions, or both. Current
  Stripe setup has both (packs + trial/hobby/pro/dealer). Default proposal: subscriptions with a
  monthly grade allowance plus one consumable pack, which maps to Apple's product types cleanly.
- [ ] **D3. IAP implementation:** direct StoreKit 2 through a Capacitor plugin, or RevenueCat.
  Default proposal: RevenueCat (handles receipts, server notifications, entitlements, restores,
  sandbox; free under $2.5k MTR) unless the owner objects to a third party in the payment path.
- [ ] **D4. Header text** for source files (company name, year, rights statement, license line).
- [ ] **D5. App name and bundle id** (e.g. `com.slabsense.app`), Apple Developer account owner.
- [ ] **D6. Native capture in v1:** Capacitor camera plugin with native 48 MP photo, yes/no.
  Default proposal: yes, it is also what makes the app "not a web wrapper" (4.2).

## Phase 1: The audit (read-only, 1–2 days of agent time)

Output: `docs/audits/2026-10-app-store-audit.md` with one section per area below. Every finding
has: id, severity (**Blocker** = Apple rejects, **Major** = must fix before submission, **Minor** =
fix in Phase 3 if cheap, **Note** = record only), file:line, the guideline or principle it
violates, the evidence, and the proposed fix in one line. Findings are deduplicated across
sections and numbered `A-01`, `B-01`, … so Phase 3 plans can cite them.

Method: one read-only agent per section (fan-out), each with the section's checklist and the
severity rubric, writing to its own file under `docs/audits/parts/`; then one pass by the app
session to merge, dedupe, cross-reference and write the summary. Agents do not fix anything.

- [ ] **A. Apple guideline compliance matrix.** For each guideline below: status (pass / fail /
  unknown), evidence, fix. 1.2 UGC (collection sharing? none today), 2.1 performance (crash guard,
  memory reload, offline), 2.3 metadata accuracy, 2.5.x software requirements (web views, private
  APIs, background), 3.1.1 IAP for every digital good (credits, subscriptions, AI grades), 3.1.2
  subscription rules (terms shown, restore, management link), 3.1.3(e) physical goods (slab order
  on Stripe is allowed), 3.1.3(b) multiplatform (web purchases usable in app, no in-app upsell to
  web), 3.2.2 unacceptable business, 4.0 design (HIG basics), 4.2 minimum functionality (what
  makes it more than the website), 4.8 Sign in with Apple (only if third-party login exists), 5.1.1
  privacy policy, permission strings, data minimisation, 5.1.1(v) account deletion, 5.1.2 data use
  and sharing (photos to Anthropic/OpenAI/Google/xAI), 5.2.1–5.2.5 IP, 5.3 gaming (none), 5.6
  developer code of conduct.
- [ ] **B. Payments and subscriptions inventory.** Every Stripe price key (`STRIPE_PRICE_*`), every
  checkout and portal call, the webhook handlers and the events they handle, the credit ledger
  (`credit_transactions`, `api/credits/*`), `ai_grade_jobs` refund path, the referral system, trial
  logic, what is mocked (mark exactly which code paths never ran against real money), what the
  web keeps, what moves to Apple, and the entitlement model that must result. Include the slab
  order as the one physical-goods flow.
- [ ] **C. Grading services inventory.** Software grade, AI grade, Deep AI grade: what each does
  (prompt, providers, models, cost per call, latency, credits charged, what the user sees), the
  claims made in copy and UI, where "estimate" wording is missing, confidence display, company
  conversions shown. Input to D1.
- [ ] **D. Code inventory.** Dead code (exports with no importers, components not rendered, legacy
  detectors once the models are default, `ManualBoundaryEditor` remnants, unused services),
  duplicated code, `TODO/FIXME/HACK/legacy/deprecated` markers (24 known), files over 1,000 lines
  (`src/App.jsx` 3,487, `PostCaptureCentering.jsx` 1,355), the untracked root and `scripts/`
  scratch files, `staging/`, `public/` leftovers, dependencies unused or duplicated, bundle size
  by chunk (`vite build` report). Propose the module split for `App.jsx`.
- [ ] **E. Warnings and health.** `vite build` warnings, `eslint` (configure a flat config first if
  absent, record the rule set), `npm audit`, deprecated dependencies, React runtime warnings in the
  headless drivers (console capture), Lighthouse on the web build (performance, accessibility,
  best practices), the service worker / caching behaviour, console noise in production.
- [ ] **F. Privacy and data flows.** Every datum collected (account, photos, scans, grades,
  identifications, training captures when "Keep Originals" is on, analytics if any), where it is
  stored, who receives it (Supabase, Vercel, Anthropic, OpenAI, Google, xAI, Replicate, Stripe,
  TCGdex image proxy), retention, deletion path, what the privacy policy must list, the App
  Privacy "nutrition label" answers, permission usage strings needed (camera, photos, motion).
- [ ] **G. Security.** Secrets in the tree (two known), env var handling, auth (`api/_lib/auth.js`),
  admin allow-list, RLS on every table the app reads, rate limits (none app-side), input
  validation on each API route, CORS, the public buckets (`models`, `card-db`, `slab-images`), the
  TCGdex proxy, token handling in the client, dependency CVEs.
- [ ] **H. Intellectual property.** Third-party assets and their licences (fonts, icons, libraries,
  onnxruntime-web, timm-derived weights, TCGdex card images and the proxy, Pokémon names and
  images, grading-company names and rubric text in `docs/grading-research/sources/`), where the
  app shows any company logo or trademark, the disclaimer text needed ("not affiliated"), what of
  ours needs the header and a LICENSE file, the TAG data's terms of use as they apply to a shipped
  model (models trained on TAG's public report images: record the position and the risk).
- [ ] **I. UI and iOS fit.** Every screen listed with: navigation pattern, safe-area handling,
  touch target sizes, gestures that conflict with iOS edges, dark mode, Dynamic Type, VoiceOver
  labels, landscape, iPad, the camera screen's replacement by native capture, the "I understand"
  gate, pricing screens that must change for IAP (no prices from Stripe, Apple's terms text).
  Produce the list of screens that change for the migration.
- [ ] **J. Performance and stability.** Memory during the model pass on phones (known), the crash
  guard, bundle size on first load, model download sizes and caching, offline behaviour, slow
  network behaviour, error states on every API call, retry paths.
- [ ] **K. Content, claims and metadata.** Every string that promises a grade outcome or implies
  affiliation; age rating inputs; App Store description, keywords, screenshots plan, review notes
  and the demo account Apple will need; support URL, marketing URL.
- [ ] **L. Account lifecycle.** Sign-up, verification, sign-in, password reset, session expiry,
  account deletion (exists; verify it cascades through scans, credits, slabs, storage), data
  export, what happens to open slab orders on deletion.
- [ ] **M. Housekeeping ledger.** Everything from `docs/STATUS.md` "Housekeeping owed" and anything
  the agents trip over that is not in scope (e.g. training scripts) but should be noted.

Each agent's prompt includes: the section checklist above, the severity rubric, the finding
format, "read only, cite file:line, do not fix, do not guess at Apple's rules — quote the
guideline", and the repo facts in `docs/STATUS.md`.

- [ ] **Merge.** App session merges the parts into `docs/audits/2026-10-app-store-audit.md`:
  summary table (counts by severity and section), the Blocker list on page one, then the
  sections. Commit the audit before any review discussion.

## Phase 2: Review and decide (one sitting with the owner)

- [ ] Walk the Blockers and Majors together; confirm severity; assign each to a fix group below.
- [ ] Close D1–D6 with the audit's numbers (cost per grade, what each tier does, what the UI
  shows).
- [ ] Price points: from the audit's per-grade provider cost, Apple's 15 %/30 % cut, and the
  credit allowance per tier, produce a price table; the owner picks. Record the decision and the
  reasoning in `docs/PRICING.md`.
- [ ] Agree the header text (D4) and the LICENSE.
- [ ] Order the fix groups; each gets a dated plan file.

## Phase 3: Fix groups (each a `writing-plans` implementation plan, executed with tests and commits)

- [ ] **3a Security and secrets.** Rotate the TAG proxy secrets and the Gemini key, move them out of
  the tree, add the ignore patterns, add API input validation and a basic rate limit where the audit
  says, confirm RLS. (Can start during Phase 1; it changes nothing the audit measures.)
- [ ] **3b Payments: Apple IAP.** Products in App Store Connect (per D1/D2), RevenueCat or StoreKit
  plugin in the Capacitor app, entitlement → credit ledger mapping on the API (`api/credits/*`
  grows an `apple` source beside `stripe`), App Store Server Notifications v2 handler (renew,
  expire, refund, grace), restore purchases, receipt-less web/native parity (Review Focus 1–2),
  subscription terms screen (3.1.2), removal of every Stripe checkout from the native build; Stripe
  stays for web and the slab order. Sandbox test matrix documented.
- [ ] **3c Account and privacy.** Permission strings, privacy policy page, data-flow disclosure
  in-app before a paid grade ("your photos are sent to…"), account deletion cascade (Review Focus
  5), Sign in with Apple only if a social login is added, data export if the audit says.
- [x] **3d Code cleanup** — first pass DONE 2026-10-02 (commits e741bfb, + part 2). Done: dead
  code out (api.js SAM/perspective chain, ocr/card-matcher/phash/image-converter, 11 unused
  App.jsx components → 3,025 lines, dead barrels, backup-api/, backend/, June scripts, root
  leftovers; D-07/08/09/10/14/28, M-17); 18 GB `public/card-images` + `card-hashes.json` moved to
  `../SlabSense-data` (dist 18 GB → 5.8 MB; D-02, E-09) + `.vercelignore`; ESLint flat config with
  `npm run lint` / `npm run check`, 0 errors (E-06); ErrorBoundary + unhandledrejection (E-01);
  prod bundles drop console.log/info/debug (E-04); leak/stale-state fixes (E-15/16/17); manifest,
  viewport, theme-color (E-05/14/22); alt text, labels, aria-labels (E-13); scans import (E-07);
  vite 6.4.3 + audit fix: 12 → 5 advisories, all inside `@xenova/transformers` (E-03).
  DEFERRED: `App.jsx` split by screen → with 3f when the capture screen is replaced (D-05, E-08);
  `@xenova/transformers` → `@huggingface/transformers` v4 (E-02, D-01): a node parity check could
  not run (v4's onnxruntime-node DirectML binding fails to load on the owner's PC; the web build
  cannot fetch models under node) — redo the parity in the browser (Playwright, port 5175) during
  3f, or move CLIP server-side; API route wrapper DONE (D-15, `api/_lib/route.js`, commit 17394e4); legacy result shapes
  (D-18) → after 3f; `legacySpend` fallback (D-19) → delete once the owner confirms the credits RPC
  migration is live; tesseract worker/lang paths bundled (E-18) → 3f; D-06 (pixel corner/edge
  detectors decide the free grade when the crash guard flips models off) → owner decision.
- [ ] **3e Headers and IP.** Script that adds the owner's header to every source file (`src/`,
  `api/`, `scripts/`, `training/*.py`, `rig/`), LICENSE file, NOTICE file listing third-party
  licences, "not affiliated" disclaimer on the grade screens and the store listing, remove any
  logo use the audit flags, record the TAG-data position in `docs/IP.md`.
- [ ] **3f Native shell and capture.** Capacitor project under `ios/`, Vite build target, native
  camera plugin for capture (48 MP where available, RAW optional), file handling, deep links for
  cert pages, splash and icons, Core ML export of the four models (optional for v1; WebGPU/WASM
  path remains the fallback), offline states (Review Focus 3), no-card path (Review Focus 4).
- [ ] **3g UI for iOS** — part 1 DONE 2026-10-02 (commit after 3daf5e3): safe-area insets on
  the sticky header and tab bar, `color-scheme: dark`, analysis-failure Try again (I-07), credit
  shortfall explained on the store screen (I-13), first-run notice with legal links (I-25),
  aria-labels on every icon button (I-06), company slab look-alikes removed (K-04). REMAINING
  (needs the native shell or a design pass): Dynamic Type / 11 pt minimum across the 148 small
  labels DONE (I-09, 128 sizes → 11 px, commit 8c7d5f3), bottom tab bar (I-15), alert() → in-app banners DONE (I-19), iPad layout (I-08),
  bundled fonts (I-14), haptics (I-22), model-download gate (I-24), capture-path cancel (I-16).
- [x] **3h Metadata and assets** — drafts DONE 2026-10-02 in `docs/app-store/listing.md`:
  product page (name, subtitle, promo, description, keywords, category, URLs), IAP table with the
  ids from `products.js`, privacy labels, age rating (4+), App Review notes, screenshot plan,
  owner checklist. `/support` page live from `docs/legal/SUPPORT.md`. OWNER: prices, copyright
  line, demo account, sample card pair, screenshots (need the native build).

Each plan ends with its own verification: tests green, the relevant Playwright driver green, and
the audit item ids it closes listed in the commit message.

## Phase 4: Re-audit

- [ ] Run Phase 1 again with fresh agents against the same checklist; diff the findings against
  the first audit (`docs/audits/2026-11-app-store-reaudit.md`); every first-audit id is either
  closed with a commit, deferred with a reason, or still open.
- [ ] Fix residuals; repeat the sections that changed until Blockers and Majors are zero.

## Phase 5: Submission

- [ ] Pricing final sign-off by the owner (Phase 2 table, revisited).
- [ ] App Store Connect: app record, products live, agreements signed, tax and banking.
- [ ] TestFlight build to the owner's phone and two other devices (old and new iPhone); one week of
  real use; crash-free.
- [ ] Review notes written for Apple: demo account, a sample card to photograph (or a provided
  photo), what each paid tier does, why the camera and motion permissions exist.
- [ ] Submit. Track the review; if rejected, the guideline cited maps back to an audit id.

## Rough calendar

| Phase | Effort | Calendar |
|---|---|---|
| 0 Decisions | owner, 30 min | day 1 |
| 1 Audit | agents, then a merge pass | days 1–3 |
| 2 Review | one sitting | day 4 |
| 3a–3h Fixes | 3a 1 day · 3b 5–7 days · 3c 2 days · 3d 3–4 days · 3e 1 day · 3f 4–6 days · 3g 3–4 days · 3h 2 days | weeks 2–5 |
| 4 Re-audit | agents + fixes | week 6 |
| 5 Submission | TestFlight week + review (Apple: typically 1–3 days, longer on first submission) | weeks 7–8 |

## Self-review notes

- Spec coverage: every owner requirement maps to a phase or a decision (D1–D6, A–M, 3a–3h).
- The audit is deliberately read-only so the owner reviews a complete picture before any change,
  as asked; 3a is the only group allowed to start early because it is pure hygiene.
- Open risk not in any checklist: Apple's rules on external purchase links in the US changed in
  2025 and may change again; 3b assumes IAP for every digital good regardless, which passes in
  every region.
