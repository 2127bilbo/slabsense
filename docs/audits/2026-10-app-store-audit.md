# App Store readiness audit — SlabSense, 2026-10-01

Phase 1 of `docs/superpowers/plans/2026-10-01-app-store-readiness.md`. Thirteen read-only passes,
one per section, each written as if an Apple reviewer and a careful engineer read the code
together. The full findings with file:line evidence are in `docs/audits/parts/<section>.md`; this
page is the merged view: counts, the Blockers deduplicated into themes, the Majors grouped by the
fix group that will own them, and what the owner decides before anything changes.

Nothing in the repo was changed by the audit. Severity: **Blocker** = Apple rejects or a user
cannot legitimately pay or sign up; **Major** = must fix before submission; **Minor** = fix in
Phase 3 if cheap; **Note** = recorded.

## Counts

| Section | Blocker | Major | Minor | Note | Part file |
|---|---|---|---|---|---|
| A Apple guideline matrix | 5 | 8 | 4 | 4 | `parts/A-guidelines.md` |
| B Payments and subscriptions | 3 | 12 | 4 | 3 | `parts/B-payments.md` |
| C Grading services | 0 | 7 | 6 | 4 | `parts/C-grading-services.md` |
| D Code inventory | 0 | 6 | 22 | 6 | `parts/D-code-inventory.md` |
| E Warnings and health | 0 | 6 | 12 | 8 | `parts/E-warnings-health.md` |
| F Privacy and data flows | 3 | 9 | 6 | 5 | `parts/F-privacy-data.md` |
| G Security | 2 | 8 | 7 | 9 | `parts/G-security.md` |
| H Intellectual property | 0 | 6 | 11 | 8 | `parts/H-ip.md` |
| I UI and iOS fit | 3 | 11 | 12 | 6 | `parts/I-ui-ios.md` |
| J Performance and stability | 1 | 8 | 11 | 6 | `parts/J-performance-stability.md` |
| K Content, claims, metadata | 3 | 9 | 10 | 5 | `parts/K-content-metadata.md` |
| L Account lifecycle | 2 | 6 | 6 | 6 | `parts/L-account.md` |
| M Housekeeping | — | — | — | — | `parts/M-housekeeping.md` (pending) |
| **Total (A–L)** | **22** | **96** | **111** | **70** | |

The 22 Blockers are 7 distinct problems seen from several sections. Fixing the seven clears all 22.

## The seven Blockers

### 1. Digital goods are sold through Stripe inside the app — 3.1.1, 3.1.3(b)
A-01, A-02, B-01, I-01. Trial, Hobby/Pro/Dealer subscriptions, single credits and the 10/20/30/50
packs all redirect the page to Stripe Checkout (`PricingPage.jsx:41-52`, `credits.js:95-115`,
`create-checkout.js`). The balance pill, the "+ Buy" button and the 402 insufficient-credits path
open the same modal. There is no in-app purchase path at all. **Fix group 3b.**

### 2. Subscriptions are not real — 3.1.2, 2.3.1
A-03, A-08, B-02, I-02. The trial card says "Auto-renews to Hobby ($9.99/mo)" but checkout is a
one-time payment and nothing ever creates a subscription (`subscription_id` is always null). The
renewal handler reads `invoice.subscription`, removed in the Stripe API version `stripe@^22` pins,
so a renewal would 500 forever (B-11). Only `STRIPE_PRICE_SLAB` has ever been configured; the nine
credit and subscription price variables never were (B-07). Every price and term string is
hard-coded USD Stripe copy; no restore, no Apple terms, no management link. **3b.**

### 3. A user can give themselves credits from the browser — payment integrity
B-03, G-01, G-02. The `profiles` "update own" policy has no column restriction and
`updateProfile` forwards arbitrary columns, so a signed-in user can set `credits_balance` and
`subscription_status` with the anon key. Separately, `credit_transactions` INSERT is
`WITH CHECK (true)`: insert a fake `grade_ai` row with a large negative amount, then
`/api/credits/refund` credits `abs(amount)`. Any entitlement system built on this ledger inherits
the hole. **3a (now), then 3b.**

### 4. Account deletion does not delete the account — 5.1.1(v)
A-04, F-01, L-01, L-02, B-15. "Delete Forever" runs in the browser under RLS and only removes
`scans` rows: `profiles` has no DELETE policy (0 rows, silently), `auth.users` is never deleted,
storage objects, credits, jobs and the Stripe customer stay, and the user can sign back in. Anyone
who ever ordered a slab gets a raw foreign-key error instead, because `slabs.scan_id/user_id` have
no `ON DELETE`. **3c.**

### 5. Terms and privacy policy are unreachable and incomplete — 5.1.1(i)
A-05, F-02, I-03, K-01. The sign-up text names Terms and Privacy but links nowhere; both exist
only as repo markdown dated April 2025 with "[email TBD]" placeholders; neither is served by the
app or the site. **3c.**

### 6. The policy does not name the AI providers that receive photos — 5.1.1(i), 5.1.2(i)
F-03 (with A-06, F-08, G-12, C-01 as Majors). Photos go to Anthropic on every paid grade and can be
routed to OpenAI, Google or xAI by a request-body field; the policy names Stripe and nothing else.
**3c, with the provider lock-down in 3a.**

### 7. The product still presents as "TAG Pre-Grader", with false feature claims — 2.3, 5.2.1
K-02, K-03 (with A-07, E-05, H-03, I-10 as Majors). `public/manifest.json` installs the app as
"TAG Pre-Grader … using TAG grading criteria" with a "TG" icon; `App.jsx:2605` claims
"AI-Enhanced with SAM 2 • Perfect edges" and SAM 2 is used nowhere. **3h for the copy, 3e for the
mark.**

### 8 (Blocker by consequence). The on-device model pass reloads the page on phones — 2.1
J-01. 450–600 MB in flight for a 12 MP pair (14 resident data-URL strings, full-width crops, a
160 MB model-load transient, sessions never released). In a WKWebView this is an app crash on a
reviewer's device. The guard only reacts after the first crash and also fires falsely (J-02).
**3f, with the memory work in 3d.**

## Majors, grouped by the fix group that owns them

### 3a Security and secrets (can start now)
- G-06, D-03, A-13-adjacent: TAG `SIGNING_SECRET` / `AES_KEY_STRING` in two tracked files
  (`tagdataset/tagapi.py:12-13`, `docs/superpowers/plans/2026-09-12-tag-dataset-acquisition.md:368-369`)
  and three untracked copies; **rotate** and move to env.
- G-07, D-03: `Slabsense Gemini API-.txt` at the root holds live Google AI and OpenAI keys, untracked
  and **not ignored** (the pattern has no space); **rotate** and fix `.gitignore`.
- G-03, B-06: `create-portal` unauthenticated, body `userId` → anyone's Stripe billing portal.
- G-04, B-06: `create-checkout` unauthenticated for non-slab keys; body `userId`, attacker-controlled
  success/cancel URLs, unbounded quantity.
- G-05, F-07, A-06: `card-info-unified` unauthenticated, CORS `*`, runs Claude vision on any posted
  image, no app caller: delete it.
- G-12, F-08, C-01: Deep endpoint takes `gradeMode` and provider choices from the body (cost and
  data-routing); pin server-side.
- G-09: users can UPDATE their own `scans` grade fields; slab minting then certifies them on a
  public cert page.
- G-10, F-04: `card-images` bucket is public with user photos under `<userId>/<scanId>/`.
- G-15: no rate limiting anywhere; per-route exposure and proposed limits in part G.
- B-05: webhook dedupe is select-then-insert with the error unchecked; grants are read-modify-write.
- B-13: credits granted on `checkout.session.completed` without `payment_status === 'paid'`.

### 3b Payments: Apple IAP
- B-04: `invoice.payment_failed`, `charge.refunded`, disputes unhandled; `past_due`/`trialing`
  collapse to `free`.
- B-08: "+7 bonus credits (first time)" shown to everyone (`bonusEligible` ≠ `signup_bonus_awarded`).
- B-09, I-12: no renewal/cancel terms, no restore, no management link outside the modal.
- B-10: credit expiry only enforced when `/balance` is read.
- B-12: 10 singles shown as "$14.99 (10-Pack)", billed $19.90, 1 credit granted.
- B-14, C-02, J-03: a Vercel `maxDuration` kill skips the refund; no provider timeout; no stale-job
  sweep; the client polls 10 min then goes silent.
- K-09: "Upgrade to Pro" is a dead TODO button; tier labels do not match the plans sold.
- K-12: Stripe USD copy must not appear in screenshots or the listing until replaced.
- Part B §7 has the proposed Apple product → ledger mapping (reuse `spend_credits`,
  `refund_credits`, `runGradeJob`, `balance.js`; new `grant_credits`, `/api/apple/verify`,
  `/api/apple/notifications`) and the App Store Server Notification event list.

### 3c Account and privacy
- A-11: no `Info.plist` purpose strings yet (camera, motion, photo library, photo-library-add;
  texts drafted in part F §4).
- F-05, L-08: no `storage.remove` anywhere; scan and account deletes leave every image.
- F-06: slab FK policy for shipped orders; shipping address retained forever (F-11).
- F-09: full uncropped originals sent on Deep grades and stored when the user did not crop.
- F-10: "Keep Originals For Training" has no consent copy, withdrawal or policy mention.
- F-12, L-05: policy promises data export and 30-day deletion that do not exist.
- L-03: no password reset or resend-confirmation (lockout is permanent). L-04: no email or
  password change. L-06: Supabase auth settings undocumented. L-07: deletion copy ignores
  subscription, credits, open orders; no Stripe cancel.
- Part F §3 has the App Privacy label answers (Contact Info, User Content, Identifiers,
  Purchases, Usage Data; no tracking; no analytics SDK).

### 3d Code cleanup
- D-01, E-02: `@xenova/transformers` (a devDependency) ships an 828 kB client chunk with a second,
  old onnxruntime and most of the `npm audit` findings; the CLIP matcher it serves pulls 88 MB from
  Hugging Face at runtime (J-04).
- D-02: `public/card-images/` (18 GB, untracked) is copied into `dist/` on every build.
- D-04: the export manifests and parity records of the two live models are untracked.
- D-05: `App.jsx` 3,487 lines, 81 states, `resetGradingState` calls 35 setters; split plan in part
  D §4. `CollectionView.jsx` 2,125, `PostCaptureCentering.jsx` 1,355, `services/api.js` 1,089 with a
  640-line dead SAM/perspective chain.
- D-06: the pixel detectors always run and are discarded when the models are on; when the guard
  flips the flag the untested path silently takes over.
- E-01: no ErrorBoundary; a render exception blanks the app.
- E-03: 12 audit vulnerabilities (1 critical, 9 high); the tooling ones clear with `npm update vite`
  and `npm audit fix` without `--force`.
- E-04: 355 `console.*` calls ship to production, some with payloads and user ids.
- E-06: no ESLint config has ever existed; the flat config to adopt is in part E §2.
- J-06: "Start a new scan" leaves the previous crop in state; the next card can be graded on it.
- J-07: full-res image duplicated 10+ times per side; J-08: a rejected ONNX session promise is
  cached forever; J-09: nothing persists the capture pair, a reload loses the scan.
- ~1,700 lines dead with high confidence (part D §1); 14 components in `App.jsx` defined but never
  rendered (I-27).

### 3e Headers and IP
- H-01: public GitHub repo, no LICENSE, `package.json` has no `license`, README says MIT while the
  Terms say proprietary. H-02: zero headers on any source file.
- H-04, K-04, C-06: `RealisticSlab.jsx` draws PSA/BECKETT/CGC/SGC/TAG brand-coloured slab labels
  with fake cert prefixes (unreachable but shipped).
- H-05: the TAG terms-of-use check from the 2026-09-12 spec was never closed; the dataset was pulled
  through TAG's key-encrypted app API. Record the position in `docs/IP.md`.
- H-08, A-13: full-resolution Pokémon artwork from TCGdex used as the 3D slab front and persisted
  on scans; no rights or attribution. One TAG image is committed as a test fixture (H-06).
- K-06, K-07: "TAG Score … / 1000" and "DINGS" present our score and TAG's report vocabulary as ours.
- All 201 npm packages are permissive; the only copyleft (libheif, LGPL) sits in an unimported module.

### 3f Native shell and capture
- A-12: everything that makes the app more than the website runs in the web layer; native capture
  and Core ML are what satisfy 4.2.
- J-01, J-02, A-09: the memory pass and the guard's false positive.
- J-04: ~205 MB of models and runtime download silently on first use; add a size notice and a
  Wi-Fi gate.
- J-05, A-10: no offline handling anywhere; AI grade offline shows "Still working…" for 10 minutes.
- I-11: slab order and cert page leave the WebView.
- I-14: Google Fonts fetched at runtime from inside the React tree.
- Only `CameraViewfinder` is replaced by native capture; `PostCaptureCentering`, `validateCap`,
  the model suggestions and the image handlers stay (part I §2); the native path hands back an
  EXIF-normalised JPEG data URL.

### 3g UI for iOS
- I-04: zero `env(safe-area-inset-*)` with `viewport-fit=cover`; the header and 14 fixed overlays
  sit under the notch and home indicator.
- I-05: 45 buttons under 44 pt. I-06: 11 ARIA attributes in the whole app; close, back, shutter,
  delete and the grade action row unlabeled; two primary targets are clickable `<div>`s.
- I-07: an analysis error leaves the spinner forever; the only reset renders at step 2.
- I-08: 480 px centred column, portrait manifest, no media queries; recommend iPhone-only v1.
- I-09: 148 font sizes at 7–9 px; `user-scalable=no`.
- I-13: the 402 path opens pricing with no "you need N credits" message.
- C-05, C-07, K-11: "95 % confident" is an image-quality number, not accuracy; the only full
  disclaimer is a one-time localStorage modal, never re-openable.
- C-03, C-04: "Deep AI Grade — Full Resolution" is false (same 2,000 px cap); an empty
  `graded_references` table silently degrades Deep with no refund or signal.

### 3h Metadata and assets
- K-05: "potential Gem Mint candidate". K-08: cert page and engraved label carry no estimate or
  not-affiliated statement. K-10: `v0.1.0-beta` in the shipping header (beta labels are rejected).
- Part K carries the string table with rewrites, the disclaimer map, the age-rating inputs, a draft
  listing (name, subtitle, description, keywords without company names), the seven-frame screenshot
  plan and the review-notes draft, including the gap that no sample card photo exists for Apple
  beyond a scraped TAG fixture.

## Facts for the owner's decisions (Phase 0 / Phase 2)

- **D1 one tier or two.** Both paid paths already share the surface regressor and the corner/edge
  slot table; Deep adds the reference-card second pass, the structural-defect floor, four images
  and a required back. Provider cost ≈ $0.09 (AI) vs ≈ $0.24 (Deep) per grade at list prices
  against $0.50–1.99 and $1.00–3.98 of credit revenue (part C, assumptions stated). Deep's "Full
  Resolution" claim is false. A single tier built on the Deep path with the references gate made
  honest is the simplest thing that passes review.
- **D2 purchase model.** The current ledger has credits, expiry, packs, singles, a trial and four
  subscription tiers, and none of the subscription half has ever run. Part B §7 maps one consumable
  pack plus auto-renewing tiers onto the existing `spend/refund` functions.
- **D3 StoreKit vs RevenueCat.** Either; part B lists the server notification events the API must
  handle in both cases.
- **D4 header text.** Part H §4 has placement rules per file type and the NOTICE structure.
- **D6 native capture.** Required for 4.2 (A-12); it also removes the viewfinder memory loop.

## Order of work (proposed)

1. **3a now**: rotate the two key sets, fix the two RLS policies, authenticate the two Stripe
   routes, delete `card-info-unified`, pin the Deep providers server-side. None of this changes
   what the audit measures elsewhere, and three of them are live exposures today.
2. Phase 2 review sitting on this page; close D1–D6; price table.
3. 3b and 3c in parallel (different files), then 3d, 3f, 3g, 3e, 3h.
4. Re-audit (Phase 4) with the same thirteen sections.
