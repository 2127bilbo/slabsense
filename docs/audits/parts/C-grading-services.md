# C. Grading services inventory

Audited 2026-10-01, read-only, against `main` as checked out on `tag-dataset`. Costs use Anthropic list prices for
`claude-opus-4-5-20251101` ($5 / $25 per MTok, Nov 2025 pricing; assumption stated once here) and the image-token
rule (image pixels / 750, long edge downscaled to 1568 px, ≈1,600 tokens per 2000-px card photo).

**Summary.** Three paths share one engine (`src/lib/gradingEngine.js` v1.1) and, on the two paid paths, one prompt
(`api/_lib/detectionPrompt.js`); the paid paths differ only in image count, a second Claude pass with TAG reference
cards, and a structural-defect floor. AI costs ≈ $0.09 and Deep ≈ $0.24 per grade against $0.50–$1.99 (AI) and
$1.00–$3.98 (Deep) of credit revenue; both are well inside margin, but Deep's distinguishing features either silently
degrade (no references → plain two-pass) or are false in copy ("Full Resolution" is the same 2000-px upload).
Findings: 0 Blocker, 7 Major, 6 Minor, 4 Note. The two highest: the Deep endpoint accepts provider/mode from the request
body (C-01) and a Vercel-killed job is never refunded (C-02).

## C.1 What runs

| | Software (free) | AI Grade | Deep AI Grade |
|---|---|---|---|
| Entry | `src/App.jsx:169 analyzeCardFull` → `analyzePixels` (`detectors.js`) → `withModelDings` (`src/services/cornerEdgeModels.js`) → `computeGrade` (`src/lib/softwareGrade.js:113`) | `src/App.jsx:2290 startGradeJob('ai')` → `claudeGradingAnalysis` (`src/services/api.js:280`) → `POST /api/ai-analyze-unified` | `startGradeJob('deep')` → `deepGradingAnalysisV2` (`api.js:986`) → `POST /api/deep-analyze-v2` |
| Server wrapper | none | `api/_lib/gradeJobs.js runGradeJob` (auth → spend → job row → run → finish/refund) | same |
| Defect finder | `corners-v3-phone` + `edges-v2-phone` ONNX in the browser (54 MB each, fetched from the `models` bucket); `detectors.js` surface heuristics; centering from the user's centering tool | Claude, one call; corners/edges replaced by the browser model table when sent (`api/_lib/cornerEdgeInput.js`) | Claude, pass 1 → engine estimate → `graded_references` query (≤7 rows) → pass 2 with pass-1 list + references; `mergeStructural` keeps pass-1 CREASE/TEAR/DENT/STAIN/PIT at ≥ pass-1 severity (`detectionPrompt.js:395`) |
| Surface severity | detector's own | TAG deduction regressor (`api/_lib/surfaceDeduction.js`) unless `SURFACE_DEDUCTION_MODEL=0` | same |
| Rollup model | not run | reported in `meta.gradeRollup`; grade only with `GRADE_ROLLUP_MODEL=1` (off) | same |
| Images sent | none leave the device | front + back, resized to 2000 px long edge, JPEG 0.9, uploaded to Supabase storage (`api.js:218`), fetched by URL | four: front/back full + front/back cropped, same 2000 px cap (`api.js:351`) |
| Provider / model | none | Anthropic, `claude-opus-4-5-20251101` hard-coded (`ai-analyze-unified.js:35`), `max_tokens 3000`, `temperature 0.1`, no prompt caching | `api/_providers/index.js callProvider` → default `claude` / `claude-opus-4-5-20251101` (`_providers/anthropic.js:21`); `gemini-2.5-pro`, `gpt-4o`, `grok-vision-beta` selectable **from the request body** (`deep-analyze-v2.js:178-181`) |
| Calls per grade | 0 | 1 Claude call + 2 storage uploads | 2 Claude calls (single mode) + 1 Supabase query + 4 uploads; parallel 3, sequential 3, synthesize 4 calls |
| Centering | user tool, required | `frontCentering` required, back optional (front-only allowed) | front + back required (`deep-analyze-v2.js:191`) |
| Server/client limits | n/a | `maxDuration 120` s / client timeout 150 s (`api.js:316`) | `maxDuration 300` s / client 320 s (`api.js:1066`) |
| Credits | 0 | 1 (`src/lib/grade-tiers.js:7`) | 2 (`grade-tiers.js:8`) |

Card identification by Claude (`api/card-info-unified.js`, `claude-sonnet-4-20250514`) is no longer called from the
app (no importer of `analyzeCardWithVision` outside `api.js`); identification is the OCR + card-DB path. Zero extra
AI calls per grade.

## C.2 Cost and latency per grade (estimates)

Token model: system prompt ≈1,500 tok, user prompt ≈1,700 tok (+≈300 with the corner/edge block), each image
≈1,600 tok, output (prose reasoning + JSON) 1,500–3,000 tok (cap 3,000).

| Path | Input tokens | Output tokens | Provider cost | Revenue per grade (credit price × credits) | Latency expectation |
|---|---|---|---|---|---|
| Software | 0 | 0 | $0 (model download 110 MB once, bucket egress) | $0 | 2–10 s on WebGPU, 10–30 s WASM (`cornerEdgeModels.js:16`) |
| AI | ≈6,700 | ≈2,500 | **≈ $0.09** (range $0.07–0.11) | $0.50 (dealer sub) – $1.99 (single credit) | 40–90 s: one Opus call writing ~2.5k tokens plus two uploads |
| Deep (single) | ≈9,900 + ≈11,900 | ≈2,500 × 2 | **≈ $0.24** (range $0.18–0.30) | $1.00 – $3.98 | 90–180 s: two sequential Opus calls + reference query |
| Deep (synthesize, if a caller asks) | +2 extra pass-2 calls + 1 text call | | ≈ $0.45–0.60 across three vendors | $1.00 – $3.98 | 120–240 s |

No measured `elapsedMs` exists in `scripts/harness/results/` (the harness exercises only the software path), so the
latency column is an expectation from token counts, not a measurement. The stale code comment "similar cost
(~$0.04-0.05 per grade)" (`api.js:973`) predates Opus 4.5 and the two-pass design. Apple's cut (15–30 %) still leaves
≥ 4× cost coverage at the lowest credit price for either tier.

## C.3 What the user sees

| Element | Software | AI | Deep | Where |
|---|---|---|---|---|
| Grade + label, per selected company (TAG/PSA/BGS/CGC/SGC) | yes | yes | yes | `App.jsx:2838-2905`; collection `CollectionView.jsx:434-490` |
| TAG 1000-pt score | Pro only | yes | yes | `App.jsx:247`, `2876` |
| 8 TAG subgrades / BGS 4 / CGC 4 | yes | yes | yes | `App.jsx:3121-3200` |
| "Condition (1-10 Scale)" averaged subgrades | no | yes | yes, "DEEP AI" chip | `App.jsx:3236-3286` |
| Defect count + damage report boxes | DINGS | yes | yes | `App.jsx:3041`, `DamageReport/*` |
| Summary positives / concerns / recommendation | tips (`App.jsx:630-655`) | yes | yes | `App.jsx:3288-3310` |
| "N% confident" | not shown | yes | yes | `App.jsx:2858-2860`, `2888-2890`; `CollectionView.jsx:1286-1294` |
| Badge | "Software" | "AI Grade" / `AI ESTIMATE` | "Deep AI" / `DEEP AI` | `App.jsx:2807/2816`; `GradeResultDisplay.jsx:12-13` |
| References used / pass-1 estimate | n/a | n/a | **not shown** (`meta.referencesUsed`, `passes.quickEstimate` dropped by the UI) | `api.js:135-170` |
| Company-styled slab mock-up with logo text and cert prefix | yes | yes | yes | `RealisticSlab.jsx:18-67`, `:354-361` |

The confidence number on both paid paths is `confidenceFromImageQuality` (`detectionPrompt.js:466`): 0.95 minus
glare/blur penalties, +0.02 when references were used. It measures photo quality, not grade accuracy.

## C.4 AI vs Deep: what differs by design

Same `DETECTION_SYSTEM`, same `buildDetectionPrompt`, same engine, same corner/edge replacement, same surface
regressor, same rollup reporting, same confidence math, same output schema and the same renderers. The plan's D1
rationale ("the Deep path already carries the surface model and the corner/edge table") is wrong: **both** paid paths
carry both (`assembleUnifiedOutput`, `detectionPrompt.js:489-497`). What Deep actually adds:

1. **Pass 2 with calibration context**: pass-1 defect list as `priorFindings` and ≤7 `graded_references` rows as
   `referencesText` (`detectionPrompt.js:263-284`). If the table is empty or RLS blocks it, pass 2 runs with no
   references and only a `console.warn` (`deep-analyze-v2.js:117`); the user still pays 2 credits and the UI cannot
   tell.
2. **Structural floor**: pass-1 CREASE/TEAR/DENT/STAIN/PIT can never be dropped or softened (`mergeStructural`).
   Pass 2 may remove cosmetic findings it can explain as glare.
3. **Four images**: Claude sees the full photo (with background) and the crop of each side; AI sees only the crop.
4. **Back required**: AI allows front-only grading; Deep refuses it.
5. **+0.02 confidence** when references were used; `passes.quickEstimate` and `referenceGrades` in the response.
6. **Prompt label**: Deep says "Identify this modern_holo card" (`cardType` default `modern_holo`,
   `deep-analyze-v2.js:168`), AI says "Identify this pokemon card" — an accident of defaults, not design.
7. **Not** higher resolution: both upload at `GRADE_UPLOAD_MAX_PX = 2000` (`api.js:19`), and Anthropic downscales
   to 1568 px anyway. The "Full Resolution" wording is false.

Where they can disagree on the same card: pass 2 can drop corner/edge/scratch findings AI kept (but with the model
table present corners and edges come from the browser models on both paths, so only surface findings differ);
pass-1 structural defects persist into Deep but AI has no equivalent floor (single pass); reference anchoring can
shift surface severities, then the regressor overrides most of them again (every type except PLAY_WEAR), so the
reference pass mostly influences *which* surface defects are listed, not how hard they score. Nothing in the repo
measures either paid path's accuracy (the harness runs the software path only; `docs/GRADING_SYSTEM.md:216` says
the first real paid grades are the check).

**For the one-tier / two-tier decision.** Deep costs ~2.7× AI to run and charges 2×; its only user-visible
difference today is a colour and a chip. Two tiers double IAP products and the explanation burden for a difference
the app cannot show and has not measured. If one tier ships, build it on the Deep flow (two passes, structural
floor, four images, back required) and surface `referencesUsed` and the pass-1 estimate so the price is explained;
if two ship, each must say what the other does not do, and "Full Resolution" must go.

## C.5 Claims and affiliation strings (UI copy)

Promises an outcome or implies affiliation:

| file:line | string | issue |
|---|---|---|
| `src/App.jsx:647` | "this pattern typically grades 6-7 at TAG" | uncited claim about a company's outcome (project rule: no company number without a citation) |
| `src/App.jsx:2971` | title "Deep AI Grade - Full Resolution (2 credits)" | false: same 2000 px cap as AI |
| `src/App.jsx:2858-2860`, `2888-2890`, `CollectionView.jsx:1293` | "N% confident" | implies grade accuracy; number is photo quality |
| `src/App.jsx:3484` | "Pre-grade estimate · DINGS-based · Not affiliated with TAG" | names only TAG; the other four companies are shown with their marks |
| `src/components/Settings/ProfileSettings.jsx:291` | "TAG-trained models" | reads as TAG involvement; they are models trained on TAG's public report images |
| `src/components/CardViewer/RealisticSlab.jsx:27,38,46,55,64` and `:354-358` | logoText `PSA`, `BECKETT`, `CGC`, `SGC`, `TAG`; `PROFESSIONAL SPORTS AUTHENTICATOR`, `BECKETT GRADING SERVICES`, `CERTIFIED GUARANTY COMPANY`, `SPORTSCARD GUARANTY`, `TAG GRADING`; certPrefix `CGC`, `SGC`, `TAG-` | renders a branded slab label with a fake cert line and no "mock-up" or "estimate" text (cross-ref H) |
| `src/components/CardViewer/CardViewer3D.jsx:138` | "PSA Slab" / "BGS Slab" … | same |
| `index.html:10` | "Compare your cards against PSA, BGS, CGC, SGC, and TAG grading standards" | acceptable with the "Not affiliated" clause that follows; keep |
| `src/components/Grading/GradeResultDisplay.jsx:13` | badge `DEEP AI` (AI badge is `AI ESTIMATE`) | estimate framing missing on Deep |

"Estimate" framing missing (grade shown with no estimate/pre-grade word on the same screen): Grade tab AI/Deep
header (`App.jsx:2844-2905`, labels fall back to "AI Grade" / "Deep AI"); Condition panel (`App.jsx:3258`);
collection card detail (`CollectionView.jsx:1275-1310`, "AI Analysis" chip); slab viewer (`RealisticSlab.jsx`,
`CardViewer3D.jsx`); pricing page (`PricingPage.jsx:517,521` "= AI Grade", "= Deep AI Grade"). Present and good:
disclaimer modal (`App.jsx:2630-2641`, once, localStorage-gated), export card (`ExportCard.jsx:169,250`), software
header "{company} Estimate" (`App.jsx:244`), `docs/DISCLAIMERS.md`. The disclaimer is never shown in the purchase or
paid-grade flow and is lost on a cleared browser or a new device.

## C.6 Failure and refund behaviour

`runGradeJob` (`api/_lib/gradeJobs.js:71-99`): spend first (`spend_credits` RPC, legacy fallback), insert
`ai_grade_jobs` (unique in-flight index per user + card + tier), run, then `finishJob` or `refundWithDb` + `failJob`.
Any non-200 or `success:false` body refunds (Claude 429, parse failure "No JSON in response", pass-2 failure, image
download failure). 409 duplicate refunds immediately. Client (`App.jsx:2325-2370`): 402 → pricing modal, 401 → auth,
409 → poll the other job, timeout/network → poll the job row for 10 min, else "error" for 3 s with no message text.
Gaps: a function killed by Vercel at `maxDuration` never reaches the refund (job stays `running`, credit kept, and
the in-flight index then rejects every retry for that card + tier with 409); `/api/credits/refund` is a user-callable
endpoint that refunds any own `grade_ai`/`grade_deep` transaction once, including successful ones (`refund.js:27`,
`credits.js:132-149`).

## C.7 Findings

| id | Severity | file:line | principle / guideline | evidence | proposed fix |
|---|---|---|---|---|---|
| C-01 | Major | `api/deep-analyze-v2.js:178-181`, `:196-200` | 5.1.2 data sharing; cost control; input validation (G) | `gradeMode`, `primaryProvider`, `secondaryProvider`, `synthesizerProvider` are read from the request body; a crafted request sends the user's photos to OpenAI/Google/xAI (if keys exist) and runs up to 4 model calls for 2 credits | Hard-code `DEFAULT_CONFIG` server-side; ignore body provider fields; delete the three unused providers or gate them behind an admin flag |
| C-02 | Major | `api/_lib/gradeJobs.js:71-99`; `api/ai-analyze-unified.js:37`; `api/deep-analyze-v2.js:38` | 3.1.1 / consumer fairness: paid digital good must be delivered or refunded | A Vercel kill at `maxDuration` (120 s AI, 300 s Deep) skips refund and leaves the job `running`, which blocks retries via the unique index (`20260915_ai_grade_jobs.sql:24-26`) | Add a stale-job reaper (cron or on-next-request) that refunds and marks `error` after `maxDuration` + grace; or move the spend to after a successful run with a reservation |
| C-03 | Major | `src/App.jsx:2971`; `CollectionView.jsx:314` | 2.3 accurate metadata; 3.1.1 paid feature must be as described | "Deep AI Grade - Full Resolution" while both tiers upload at `GRADE_UPLOAD_MAX_PX = 2000` (`api.js:19,218,351`) | Replace with what Deep does ("two-pass, four photos, reference-calibrated") or raise the Deep cap and keep the claim |
| C-04 | Major | `api/deep-analyze-v2.js:117`; `src/services/api.js:135-170` | 3.1.1 paid feature as described; 2.3 | Empty/blocked `graded_references` silently degrades Deep to a plain second pass; `referencesUsed` is never shown | Fail the job (refund) when `references.length === 0` on a Deep grade, or show "calibrated against N TAG-graded cards" in the result and price accordingly |
| C-05 | Major | `src/App.jsx:2858-2860`, `2888-2890`; `CollectionView.jsx:1286-1294`; `detectionPrompt.js:466-485` | 2.3; 5.6 honesty in claims | "95% confident" is 0.95 − glare/blur penalties; it says nothing about grade accuracy, which is unmeasured on paid paths | Rename to "Photo quality: good/fair/poor" with the factors, or drop the percentage |
| C-06 | Major | `src/components/CardViewer/RealisticSlab.jsx:18-67`, `:257-305`, `:354-361`; `CardViewer3D.jsx:138` | 5.2.1 IP, 5.2.5 brand impersonation; 2.3 | Canvas draws PSA/BECKETT/CGC/SGC/TAG-branded labels with full company names, cert prefixes and a cert number; no "mock-up"/"estimate" text on the rendered slab | Draw a neutral SlabSense label that says "{company} estimate" without logos/full names; or watermark "PREVIEW · ESTIMATE" on the canvas (coordinate with H) |
| C-07 | Major | `src/App.jsx:2630-2641` (modal), `:3484` (footer) | 2.3; 5.6; D1 input | The only full disclaimer is a one-time localStorage modal; paid grade screens, pricing and collection show grades without "estimate"; footer names only TAG | Put "Estimate · not an official grade · not affiliated with PSA, BGS, CGC, SGC or TAG" on every grade result and on the credit purchase screen; re-show the modal per device/account, not per browser |
| C-08 | Minor | `src/App.jsx:647` | project rule (grading-company numbers need a citation); 2.3 | "typically grades 6-7 at TAG" has no source in `docs/grading-research/sources/` | Reword to the engine's own band ("scores in the 600s on our scale") or cite |
| C-09 | Minor | `src/components/Billing/PricingPage.jsx:517,521` | 3.1.1 / 3.1.2 clarity of what is purchased | "1 credit = AI Grade · 2 credits = Deep AI Grade" with no description of either | One line per tier: what it does, how long it takes, what the photos are sent to |
| C-10 | Minor | `src/components/Settings/ProfileSettings.jsx:291` | 5.2.1; affiliation wording | "TAG-trained models" | "models trained on public TAG report images" or "SlabSense corner/edge models" |
| C-11 | Minor | `src/components/Grading/GradeResultDisplay.jsx:13` | 2.3 consistency | AI badge is `AI ESTIMATE`, Deep badge is `DEEP AI` | `DEEP AI ESTIMATE` |
| C-12 | Minor | `api/deep-analyze-v2.js:146-153`, `:168`; `api/_lib/detectionPrompt.js:217` | input validation (G); prompt hygiene | `cardType` from the body is interpolated verbatim into the prompt ("Identify this ${cardType} card"); default differs per path (`pokemon` vs `modern_holo`) | Whitelist `cardType` to an enum; use one default |
| C-13 | Minor | `api/credits/refund.js:27`; `api/_lib/credits.js:132-149` | 3.1.1 ledger integrity (B) | Any signed-in user can refund their own successful grade transaction once by id | Restrict the endpoint to failed jobs (`ai_grade_jobs.status = 'error'`) or remove it now that refunds are server-side |
| C-14 | Note | `api/ai-analyze-unified.js:35`; `api/_providers/anthropic.js:19-23` | 2.1 performance / lifecycle | Model ids are dated snapshots (`claude-opus-4-5-20251101`, `claude-sonnet-4-20250514`, `claude-3-5-haiku-20241022`); no prompt caching on a 1.5k-token system prompt that never changes | Pin via one env var; add `cache_control` on the system block (≈ −$0.004 per call, more on Deep) |
| C-15 | Note | `src/services/api.js:973`, `:310`, `:1056`; `CollectionView.jsx:267,322` | housekeeping (M) | Comments: "~$0.04-0.05 per grade", "more accurate than AI estimation" (centering is never AI-estimated now) | Update or delete during the header pass |
| C-16 | Note | `scripts/harness/results/` (software path only); `docs/GRADING_SYSTEM.md:216` | D1 input | No measurement of AI or Deep grade accuracy or latency exists; the two tiers cannot be compared on quality, only on cost | Run the harness cards through both paid endpoints once (≈ $0.33 per card for both tiers) before pricing them |
| C-17 | Note | `api/card-info-unified.js:87,124`; `src/services/api.js:46` | dead code (D) | Claude identification endpoint and `analyzeCardWithVision` have no caller in the app | Remove with section D |
