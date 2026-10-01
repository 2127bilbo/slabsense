# F. Privacy and data flows

Summary: 23 findings — 3 Blocker, 9 Major, 6 Minor, 5 Note. Account deletion does not delete the account (no DELETE policy on `profiles`, `auth.users` untouched, no storage removed, FK on `slabs` blocks the scan delete), and the privacy policy exists only as `docs/PRIVACY_POLICY.md` with "[email TBD]" placeholders, no link from the app, and no mention of the AI providers that receive the photos.
Everything the user uploads (saved scans, crops, grade uploads, "Keep Originals" training photos) lands in the public `card-images` bucket under a `<user_id>/…` path, readable by anyone with the URL, and is never removed on scan or account deletion.
No analytics, crash or ad SDK exists; Anthropic is the only AI provider reached on the live paths today, but the Deep endpoint lets the request body route photos to OpenAI, Google or xAI, and an unauthenticated endpoint forwards images to Anthropic/Replicate.

Read-only audit, 2026-10-01, branch `tag-dataset`. Guidelines quoted are App Store Review 5.1.1 (data collection and storage), 5.1.1(v) (account deletion), 5.1.2 (data use and sharing). RLS = Supabase row-level security as declared in `supabase/migrations/`; bucket visibility as declared in migrations or inferred from `getPublicUrl` use (the dashboard state was not inspected).

## 1. Data inventory

| Datum | Collected / derived at | Stored in | Who can read | Sent to (file:line) | Retention | Deletion path |
|---|---|---|---|---|---|---|
| Email, password | `src/services/auth.js:15` signUp | Supabase `auth.users` | Supabase service role; user via session | Stripe `customers.create({ email })` `api/stripe/create-checkout.js:99-101` (reads `profile.email`, a column no migration declares) | Forever | None: `deleteAccount` never deletes `auth.users` (`src/services/auth.js:131-134` admits it) |
| Display name, preferred company, tier, credits, trial/bonus flags, referral code | signUp metadata `auth.js:20`; trigger `001_initial_schema.sql:28-35`; `ProfileSettings.jsx:43-46` | `profiles` | Owner (SELECT/UPDATE policies `001:21-26`); no DELETE policy | — | Forever | `profiles.delete()` `auth.js:150-153` returns 0 rows under RLS (no DELETE policy), no error |
| Stripe customer id, subscription id/status/renewal | `create-checkout.js:109-111`, `webhook.js:160-164` | `profiles.stripe_customer_id`, `subscription_*` | Owner (SELECT) | Stripe (customer metadata `user_id` `create-checkout.js:101-103`; session metadata `user_id, scan_id` `api/_lib/slabs.js:20`) | Forever | None; Stripe customer never deleted |
| Purchase / credit ledger | `webhook.js:231-250`, `api/_lib/credits.js:86-117,188-190` | `credit_transactions` (user_id, amount, type, description, scan_id), `stripe_events` (raw event JSON) | Owner SELECT `002:93`; `stripe_events` service-role only `002:102` | Stripe (origin) | Forever | `credit_transactions` cascades from `profiles` (`002:28`), but the profile delete never happens (above). `stripe_events` has no user link |
| Front/back photos (camera full frame, 4096x3072 ideal, JPEG q0.92 `src/App.jsx:951,1056-1058`; library photos re-encoded q0.95 `App.jsx:1137`, HEIC converted on device) | Capture | In memory / React state until saved | — | See rows below | Session | Reload |
| Saved scan images: `enhanced_front/back` = crop or **full original** when no crop (`App.jsx:1990-1991`), `user_card_image` = crop or full front (`App.jsx:2097`) | `persistScan` `App.jsx:2066-2070` → `scans.js:17-52` | `card-images/<user_id>/<scan_id>/*.jpg` (public URL via `getPublicUrl` `scans.js:43-47`; `001:165` claims the bucket is private; plan doc `2026-09-12-slab-cert-page-foundation.md:9` says public) | Anyone with the URL; path reveals the user id | Image URL to Anthropic when the slab/cert flows copy it (`api/_lib/slabs.js:44-54`) | Forever | None: no `storage.remove` anywhere in `src/` or `api/`; `deleteScan` `scans.js:236-247` deletes the row only |
| AI-grade uploads (2000 px max, q0.9) | `src/services/api.js:218-224` (standard), `:351-357` (deep: front/back **original** + cropped) | `card-images/<user_id>/standard-analysis/`, `/deep-analysis/` (public URL) | Anyone with the URL | Anthropic fetches the URL `api/ai-analyze-unified.js:129-137`; Deep passes 4 URLs to `callProvider` `api/deep-analyze-v2.js:210-212,231-234` | 7 days (`scripts/storage/cleanup-grade-uploads.mjs`, weekly cron `.github/workflows/card-db-update.yml:8-9,34`) | Cron only; not on account deletion |
| Grades, subgrades, defects (`dings`, AI defect boxes), centering ratios, notes, card name/set/number, TCGdex id and image URL, company grades | Engine on device; AI results | `scans` columns (`scans.js:59-93`) | Owner (`001:91-104`); **anyone** via `slab_public` view + `/api/slab?cert=` once a slab is ordered (`20260913_slab_images.sql:19-25`, `api/_lib/routes/slab-get.js:20`) | — | Forever | User deletes scan (row only) |
| AI grade job: request (image URLs, centering, cardKey = SHA-256 of both photos), full result JSON, error | `api/_lib/gradeJobs.js:19-22,37-41,55-56` | `ai_grade_jobs` | Owner SELECT only (`20260915_ai_grade_jobs.sql:30-31`) | — | Forever | Cascades from `profiles` (never deleted) |
| Card identification outcome: db version, variant, status, top-5 candidate ids + similarity, chosen id, OCR read of set number | `CardIdentifier.jsx:106-112` → `scans.js:319-336` (any signed-in user, every identification) | `card_identifications` | Owner SELECT/INSERT (`20260914_card_identifications.sql:19-24`) | — | Forever | `on delete set null` keeps the row anonymised |
| Missing-image reports (tcgdex id, card name, set, number) | `App.jsx:2121` → `scans.js:270-312` | `missing_images` | **No RLS declared** (`20260414_missing_images.sql`) | — | Forever | None (no user link) |
| Slab order: Stripe session id, **shipping name + postal address** (`session.shipping_details`), status timestamps, label text/settings, cert-keyed image copies | `api/_lib/slabs.js:32,83`; `routes/slabs-status.js:57-62` | `slabs.shipping` jsonb; `slab-images/<cert>/` (public bucket `20260913:8-14`); `slab-labels` (private) | Owner SELECT (`20260912:36`); admin queue returns `shipping` (`api/_lib/slabs.js:95`); images public | Stripe collects the address (`slabs.js:17`) | Forever | None; `slabs.user_id` / `scan_id` have no `ON DELETE` (`20260912:19-20`) so the parent rows cannot be deleted |
| Training capture (opt-in): **full original** front/back photos + normalised corners, image size, rotation, centering ratios | `trainingCapture.js:42-68`, toggle `ProfileSettings.jsx:314-345` | `card-images/<user_id>/<scan_id>/training/{front,back}.jpg, labels.json` (public URL) | Anyone with the URL | — (owner pulls for training) | Forever ("a folder the weekly cleanup never touches" `trainingCapture.js:12-13`) | None |
| Device info | `navigator.hardwareConcurrency` for ONNX threads `cornerEdgeModels.js:199` (not sent) | — | — | — | — | — |
| localStorage (per device): `slabsense_disclaimer_acknowledged`, `slabsense_autoSnap`, `slabsense_aiJobs` (job ids, cardKey hash, type), `slabsense_savedScans` (cardKey→scan id, last 30), `slabsense_measureMode`, `slabsense_lineStyle`, `slabsense_modelGrading`, `slabsense_modelPassActive`, `slabsense_modelPassCrashed`, `slabsense_keepOriginals`; sessionStorage `slabsense_loupePos`; Cache API `slabsense-models-v1`, `slabsense-card-db-v1`; Supabase session token (supabase-js default) | `App.jsx:894,1528,2212-2221`, `PostCaptureCentering.jsx:60-64`, `line-color.js:24`, `cornerEdgeModels.js:24,69-70`, `trainingCapture.js:22`, `Loupe.jsx:21` | Browser | Device only | — | Until cleared | Not cleared on sign-out or deletion |
| Server logs | Vercel function logs: `userId` on checkout (`webhook.js:139,155`), AI defect JSON (`ai-analyze-unified.js:163`), truncated image URLs; Supabase auth logs hold IPs | Vercel / Supabase | Owner | — | Platform default | Platform default |
| Analytics / ads / crash SDK | **None** (no gtag/posthog/sentry/vercel-analytics in `src/`, `api/`, `index.html`, `package.json`) | — | — | — | — | — |

## 2. Payloads to each AI / third-party provider

| Provider | Endpoint (file:line) | Payload | User identifiers |
|---|---|---|---|
| Anthropic (`claude-opus-4-5-20251101`) | `api/ai-analyze-unified.js:141-147` | `system: DETECTION_SYSTEM`, one user message: 1–2 `image` blocks of type `url` (public `card-images` URLs, 2000 px long edge, q0.9) + detection prompt text containing card type, centering ratios, corner/edge slot table (`api/_lib/detectionPrompt.js:184+`); `max_tokens 3000`, `temperature 0.1` | None in the prompt. The image URL itself contains the Supabase user id (`<user_id>/standard-analysis/…`) and Anthropic must fetch it |
| Anthropic via `callProvider` (Deep, default `single`/`claude` `deep-analyze-v2.js:45-49`) | `deep-analyze-v2.js:231-234,289-299` | Pass 1 + pass 2: 4 image URLs (front full, back full, front crop, back crop) + same prompt, pass 2 adds pass-1 findings; `api/_providers/anthropic.js:69-75` passes `source: {type:'url'}` | As above (user id in URL) |
| OpenAI `gpt-4o` (`detail: 'high'`), Google `gemini-2.5-pro` (images downloaded server-side and inlined as base64 `google.js:82-84,172-174`), xAI `grok-vision-beta` | Reachable: `deep-analyze-v2.js:173-176` reads `primaryProvider`/`secondaryProvider`/`synthesizerProvider` **from the request body**; the client never sends them (`src/services/api.js:1050`) but any authenticated caller can | Same images and prompt; synthesize mode sends the two detections as text (`:383-392`) | As above |
| Anthropic `claude-sonnet-4-20250514` (card identification) | `api/card-info-unified.js:84-100` | Base64 image from the body + card-info prompt. **No `requireUser`**, CORS `*` (`:31-33`); no caller in `src/` (identification is on-device) | None |
| Replicate (LLaVA) | `card-info-unified.js:139-170` when `mode=llava` | Base64 data URI + prompt | None |
| TCGdex | `src/services/tcgdex.js:48,88,254` (`api.tcgdex.net` card name / set-number queries); images via `/tcgdex-img/*` rewrite (`vercel.json`) | Card name or number as read by OCR | None (requester IP) |
| jsDelivr CDN | `src/services/ocr.js:330,373` Tesseract.js default worker/core/lang paths | Script downloads only; the image stays on device | None (requester IP) |
| Stripe | `create-checkout.js:99-103`, `api/_lib/slabs.js:8-22` | Email, `user_id` metadata, price, `scan_id`; Stripe collects card and (slab) US shipping address | user_id, email |
| Supabase | all of `src/services/*.js` | Everything in §1 | user_id, email |

## 3. App Privacy "nutrition label" (what the code supports)

| Section | Data type | Collected? | Linked to user | Used for tracking | Why |
|---|---|---|---|---|---|
| Contact Info | Email Address | Yes | Yes | No | `auth.users`, Stripe customer |
| Contact Info | Name | Yes | Yes | No | `profiles.display_name`; shipping name in `slabs.shipping` |
| Contact Info | Physical Address | Yes (slab orders) | Yes | No | `slabs.shipping` from Stripe `shipping_address_collection` |
| Contact Info | Phone Number | No | — | — | `phone_number_collection` not enabled in `api/_lib/slabs.js:8-22` |
| User Content | Photos or Videos | Yes | Yes | No | `card-images/<user_id>/…`, sent to Anthropic |
| User Content | Other User Content | Yes | Yes | No | notes, crops, centering lines, grades, card ids |
| Identifiers | User ID | Yes | Yes | No | Supabase uuid, Stripe customer id, `cardKey` photo hash |
| Identifiers | Device ID | No | — | — | None read |
| Purchases | Purchase History | Yes | Yes | No | `credit_transactions`, `stripe_events`, `slabs` |
| Usage Data | Product Interaction | Yes | Yes | No | `card_identifications` (what the matcher offered vs chosen, OCR read), `ai_grade_jobs`, `missing_images` |
| Usage Data | Advertising Data / Other | No | — | — | No ad or analytics SDK |
| Diagnostics | Crash Data, Performance Data | No | — | — | Crash guard is localStorage only (`cornerEdgeModels.js:66-92`), never sent. Vercel/Supabase request logs hold IPs; owner must confirm they fit Apple's optional-disclosure conditions (not used for tracking/ads, not shared, infrequent) or declare "Other Diagnostic Data" |
| Location, Health, Financial Info, Contacts, Browsing/Search History, Sensitive Info | — | No | — | — | Payment card details never touch the app (Stripe Checkout). Motion data is used live and never stored or sent |
| Tracking (ATT) | — | **No** | — | — | No IDFA, no cross-app/site linking, no data broker; ATT prompt not required |

If the Deep endpoint keeps the body-selectable providers (F-08) or `card-info-unified` stays reachable (F-07), the label's "third parties" for Photos must list OpenAI, Google, xAI and Replicate as well as Anthropic.

## 4. iOS permission purpose strings the native app needs

| Key | Behaviour it enables (file:line) | Suggested string |
|---|---|---|
| `NSCameraUsageDescription` | Live viewfinder with the card-outline model, auto snap, capture of front/back (`src/App.jsx:936-960`, `1056-1058`) | "SlabSense uses the camera to photograph the front and back of your card and show the live card outline." |
| `NSPhotoLibraryUsageDescription` (only if the Capacitor Camera/Photos plugin is used; `PHPickerViewController` needs none) | Picking existing photos incl. HEIC (`App.jsx:1231,1330` `<input type=file accept="image/*,.heic,.heif">`) | "SlabSense lets you choose an existing photo of your card to grade." |
| `NSPhotoLibraryAddUsageDescription` | Saving the shareable grade card PNG (`src/components/Export/ExportCard.jsx:44-54`) if the native build writes to Photos instead of the share sheet | "SlabSense saves your grade card image to your photo library." |
| `NSMotionUsageDescription` | Bubble level in the viewfinder (`App.jsx:1014-1033`, `DeviceOrientationEvent.requestPermission`) and holo-card tilt (`src/lib/gyro-input.js:58-103`) | "SlabSense uses motion data to show a level indicator so your card photo is taken flat." |
| Not needed | Microphone (`audio:false` `App.jsx:951`), Location, Contacts, Bluetooth, ATT | — |

## 5. Privacy policy and terms: existence and gaps against 5.1.1

Exist: `docs/PRIVACY_POLICY.md` and `docs/TERMS_OF_SERVICE.md` (both "Effective Date: April 2025"). Not served: no `/privacy` or `/terms` route in `vercel.json`, no file under `public/`, no route in the SPA; `AuthModal.jsx:240` says "you agree to our Terms of Service and Privacy Policy" as plain text with no link. Contact lines are placeholders (`PRIVACY_POLICY.md:78,121`, `TERMS_OF_SERVICE.md:244`, governing law `:193`).

What 5.1.1(i)/(5.1.2) require the policy to say that it does not:
- Name the third parties that receive photos and what they do with them: Anthropic (every AI / Deep grade), OpenAI / Google / xAI / Replicate (reachable), Supabase (storage, auth), Vercel (hosting, logs), Stripe (payments, shipping address), TCGdex (card lookups), jsDelivr (OCR runtime). Today it says only "Cloud hosting, payment processing" (`:62`).
- That photos are uploaded to a bucket reachable by URL (§1) rather than "stored securely using industry-standard encryption … delete at any time" (`:41-43`), which the code does not support (F-05).
- "Free Users: Analysis data is processed but not stored" (`:46`) is false for signed-in users: `card_identifications` rows and `missing_images` rows are written on every identification; AI-grade uploads persist 7 days; jobs forever.
- The training use: "Keep Originals For Training" (`ProfileSettings.jsx:314`) uploads full photos for model training; the policy's "Improve our grading algorithms" (`:31`) does not say photos are retained for training, that the toggle is per-device, nor how to withdraw them.
- Account deletion: "permanently deleted within 30 days" (`:48`) vs the code (§6). Export: "Download your scan history" (`:75`) has no implementation (no export code in `src/`).
- Shipping name/address for slab orders, the public cert page (grades, card and photos visible to anyone with the cert number), and the retention of `ai_grade_jobs`, `credit_transactions`, `stripe_events`.
- Claims collection of "Device Information … Log Data: IP address" and "optional analytics cookies (if implemented)" (`:19-22,91`): either remove or state the actual source (platform request logs).
- Children: policy says 13+, Terms say 13+ with parental consent under 18; the App Store age rating must match (K section).

## 6. Account deletion trace (Settings → Delete Account)

`ProfileSettings.jsx:418` button → type DELETE → `handleDelete` `:55-66` → `deleteAccount(user.id)` `src/services/auth.js:136-159`:
1. `scans.delete().eq('user_id')` — allowed by RLS (`001:103-104`). **Fails with an FK error for any user who ordered a slab** (`slabs.scan_id references scans(id)` with no `ON DELETE`, `20260912_slabs.sql:19`), which throws at `auth.js:147` and aborts the whole flow.
2. `profiles.delete().eq('id')` — **no DELETE policy on `profiles`** (`001:21-26` only SELECT/UPDATE), so RLS filters every row: 0 rows deleted, no error, the profile with credits, Stripe ids and referral code survives.
3. `supabase.auth.signOut()` — the `auth.users` row is untouched (admin API required, comment `:131-134`); the user can sign back in and the profile trigger does not even need to re-run.
No API route performs deletion; nothing touches storage, Stripe, or the device caches.

| Store | On "Delete Account" | On "Delete scan" (`CollectionView.jsx:150`) |
|---|---|---|
| `auth.users` | not deleted | — |
| `profiles` | not deleted (RLS) | — |
| `scans` | deleted unless a slab exists (FK) | row deleted |
| `credit_transactions`, `ai_grade_jobs`, `referrals`, `memberships` | would cascade from `profiles` — which is never deleted | `ai_grade_jobs` keep the job incl. image URLs |
| `card_identifications` | `set null` only if `auth.users` were deleted — it is not | — |
| `slabs` (+ shipping address) | not deleted; blocks the scan delete | not deleted; blocks the row delete |
| `stripe_events`, Stripe customer / sessions | not deleted | — |
| `card-images/<user_id>/**` (saved, crops, grade uploads, `training/`) | nothing removed | nothing removed (orphan on a public URL) |
| `slab-images/<cert>/`, `slab-labels/<cert>.svg` | nothing removed | nothing removed |
| localStorage / Cache API | not cleared | — |

## 7. Data minimisation issues

- Full uncropped originals go to the AI provider on Deep grades (`src/services/api.js:1029-1033` → `deep-analyze-v2.js:210-212`): the background (desk, hands, room) is not needed for the grade.
- Full originals are **stored by default** when the user did not crop: `enhancedFront = frontCroppedImage || fI` (`App.jsx:1990-1991`), `userCardImage: … (frontCroppedImage || fI)` (`App.jsx:2097`); and always when "Keep Originals" is on.
- `card-images` is public; `slab-images` is public by design (cert page); `card-db` and `models` are public and hold no user data. The public `card-images` tree includes every user's saved photos, grade uploads and training originals, keyed by user id.
- `card-info-unified` forwards images to Anthropic/Replicate with no auth and no caller in the app.
- Deep endpoint accepts provider selection from the body; three extra providers' adapters and keys are wired for a feature the client never uses.
- `ai_grade_jobs.request` keeps image URLs and the full result forever; `stripe_events` keeps raw event JSON forever; neither is read back by the app after the "resume" window.
- `card_identifications` logs every identification (top-5 ids, OCR text) per user forever; measured for a model that does not exist yet (`20260914_card_identifications.sql:1-3`).
- `cardKey` (SHA-256 of both photo data URLs) is stored in `ai_grade_jobs` and localStorage: harmless, but it is a stable fingerprint of the user's photos.
- Email is sent to Stripe from a `profiles.email` column that no migration declares (`create-checkout.js:100`): either the column exists only in the dashboard or Stripe customers are created with `email: undefined`.

## Findings

| Id | Severity | file:line | Guideline | Evidence | Proposed fix |
|---|---|---|---|---|---|
| F-01 | Blocker | `src/services/auth.js:136-159`; `supabase/migrations/001_initial_schema.sql:21-26` | 5.1.1(v) | "Delete Account" deletes 0 profile rows (no DELETE policy), leaves `auth.users`, credits, Stripe ids; user can sign back in | Add `POST /api/account/delete` with `requireUser` + service role: delete storage prefixes, slabs/scans/jobs/ledger, Stripe customer, then `auth.admin.deleteUser`; confirm in-app |
| F-02 | Blocker | `docs/PRIVACY_POLICY.md:78,121`; `src/components/Auth/AuthModal.jsx:240`; `vercel.json` | 5.1.1(i) | Policy and Terms are repo markdown with "[email TBD]" placeholders; no route, no link in the app, nothing under `public/` | Publish `/privacy` and `/terms` pages (static HTML in `public/`), link them from AuthModal, Settings and App Store Connect; fill the contacts |
| F-03 | Blocker | `docs/PRIVACY_POLICY.md:57-65`; `api/ai-analyze-unified.js:129-147` | 5.1.1(i), 5.1.2(i) | Policy names no AI provider; photos are sent to Anthropic on every paid grade (and can reach OpenAI/Google/xAI/Replicate) | Rewrite "Data Sharing" to name each recipient and purpose (§5 list), state retention per store, and the training use |
| F-04 | Major | `src/services/scans.js:43-47`; `src/services/api.js:243-249`; `001_initial_schema.sql:165` | 5.1.1(i) "handle data securely" | `card-images` is used as a public bucket (public URLs; Anthropic fetches them unauthenticated) though the migration says private; every saved photo and training original is URL-readable with the user id in the path | Make the bucket private; serve the app via signed URLs; hand Anthropic short-lived signed URLs or base64; copy cert images to `slab-images` only |
| F-05 | Major | `src/services/scans.js:236-247`; `src/components/Collection/CollectionView.jsx:150`; (no `storage.remove` in `src/` or `api/`) | 5.1.1(v), 5.1.1(i) | Deleting a scan or the account never removes storage objects; only 7-day grade uploads are reaped (`scripts/storage/cleanup-grade-uploads.mjs`) | Remove `<user>/<scan>/**` on scan delete (client, RLS on storage) and `<user>/**` on account delete (service role) |
| F-06 | Major | `supabase/migrations/20260912_slabs.sql:19-20` | 5.1.1(v) | `slabs.scan_id`/`user_id` have no `ON DELETE`, so scan and profile deletes fail for anyone who ordered a slab; shipping address retained forever | Decide the policy for shipped orders (keep anonymised cert row, null `user_id`, drop `shipping` after delivery + N days); migration with `on delete set null`/cascade accordingly |
| F-07 | Major | `api/card-info-unified.js:31-33,84-100,139-170` | 5.1.1(iii) minimisation; 5.1.2 | Unauthenticated endpoint forwards any posted image to Anthropic (and Replicate with `mode=llava`); no app caller | Delete the route and `api/_lib/replicate-utils.js`, or gate with `requireUser` and drop the LLaVA branch |
| F-08 | Major | `api/deep-analyze-v2.js:173-176`; `api/_providers/{openai,google,xai}.js` | 5.1.2(i) | Provider choice comes from the request body: an authenticated caller can route photos to OpenAI, Google or xAI; the label and policy would have to list them | Hard-code the provider server-side (drop the body params) or list all four providers in policy + label |
| F-09 | Major | `src/services/api.js:1029-1033`; `api/deep-analyze-v2.js:210-212`; `src/App.jsx:1990-1991,2097` | 5.1.1(iii) | Full uncropped originals are sent on Deep grades and stored as the saved image whenever the user did not crop | Send/store the card crop only (the detector already produces one); keep the original on device unless "Keep Originals" is on |
| F-10 | Major | `src/components/Settings/ProfileSettings.jsx:314-345`; `src/services/trainingCapture.js:42-68` | 5.1.2(i) consent for secondary use | "Keep Originals For Training" uploads full photos + labels to a public path for model training with no explanation, no withdrawal path, no mention in the policy | Add consent copy on the toggle (what, where, how long, how to withdraw), a "delete my training photos" action, and the policy section |
| F-11 | Major | `api/_lib/slabs.js:17,32,83,95` | 5.1.1(i) | Shipping name + address stored in `slabs.shipping` forever, returned by the admin queue, not mentioned in the policy or the order UI | Declare in policy + label (Physical Address, Name); purge `shipping` N days after `shipped_at`; keep only the cert |
| F-12 | Major | `docs/PRIVACY_POLICY.md:72-75`; (no export code in `src/`) | 5.1.1(i) accuracy | Policy promises data access/export ("Download your scan history"); nothing implements it | Add a JSON export of scans + images (signed URLs) or remove the promise |
| F-13 | Minor | `docs/PRIVACY_POLICY.md:19-22,46,91` | 5.1.1(i) accuracy | Claims device info/IP/usage collection and optional analytics cookies; none exist in code, while real collection (`card_identifications`, `ai_grade_jobs`) is not mentioned | Rewrite "Information Collected Automatically" to the actual stores (§1) |
| F-14 | Minor | `src/components/Collection/CollectionView.jsx:806`; `20260913_slab_images.sql:19-25` | 5.1.1(i) | Ordering a slab makes grades, subgrades, dings, card info and both photos public on `/v/<cert>`; the user is not told before paying | Add a line to the order dialog and the policy; consider a per-slab "hide photos" flag |
| F-15 | Minor | `supabase/migrations/20260414_missing_images.sql` | 5.1.1(i) | Table has no RLS at all; anon key can read/write (card metadata only, no user data) | Enable RLS: insert/update for authenticated, no select; or write via API |
| F-16 | Minor | `api/_lib/gradeJobs.js:37-41,55-56`; `api/stripe/webhook.js:87` | 5.1.1(i) retention | `ai_grade_jobs` (image URLs + full result) and `stripe_events` (raw JSON) kept forever with no reader after the resume window | Purge jobs after 30 days (keep id, status, transaction_id); trim `stripe_events` to id/type/created |
| F-17 | Minor | `src/services/scans.js:319-336` | 5.1.1(iii) | Every identification is logged per user (top-5 ids, OCR read) for a future model; no opt-out, not in policy | Mention in policy; add a retention cap or aggregate server-side |
| F-18 | Minor | `src/services/auth.js:49-56`; localStorage keys in §1 | 5.1.1(v) | Sign-out / deletion leave `slabsense_aiJobs`, `slabsense_savedScans` (scan ids) and the session caches on the device | Clear app keys on sign-out and deletion |
| F-19 | Note | `api/stripe/create-checkout.js:100` | — | `profile.email` read from `profiles`, which has no `email` column in any migration | Confirm the live schema; otherwise take the email from `requireUser` |
| F-20 | Note | `src/services/ocr.js:330,373`; `src/services/tcgdex.js:48,88`; `vercel.json` | 5.1.1(i) | Runtime requests to jsDelivr (Tesseract assets) and TCGdex (card name/number) carry the user's IP; no identifiers | List both as third parties in the policy; optionally self-host the Tesseract assets |
| F-21 | Note | `api/stripe/webhook.js:139,155`; `api/ai-analyze-unified.js:163` | 5.1.1(i) | Vercel function logs hold user ids and AI defect JSON; Supabase auth logs hold IPs | Mention platform logs and their retention in the policy; keep log lines to ids |
| F-22 | Note | `src/App.jsx:1014-1033`; `src/lib/gyro-input.js:72-103` | 5.1.1(ii) permission strings | Motion permission is requested for the bubble level and holo tilt; data never leaves the device | Add `NSMotionUsageDescription` (§4); request it only when the viewfinder opens |
| F-23 | Note | `src/App.jsx:936-960,1231,1330`; `src/components/Export/ExportCard.jsx:44-54` | 5.1.1(ii) | Camera, photo picker and PNG download map to `NSCameraUsageDescription`, (`NSPhotoLibraryUsageDescription`), `NSPhotoLibraryAddUsageDescription` | Add the strings in §4; prefer `PHPicker`/share sheet to avoid two of them |
