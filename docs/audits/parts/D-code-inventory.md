# D. Code inventory

Audited 2026-10-01 on branch `tag-dataset` (read-only; `vite build` run to a scratch outDir). Method: export/import cross-reference script over `src/`, `api/`, `scripts/`, `public/` (word-match on every `export`, importer map per file), plus targeted greps; every "dead" claim below was re-checked by hand with a second grep.

**Summary.** 128 files under `src/`+`api/` (23,581 non-test source lines); ~1,700 lines are dead with high confidence (3 whole modules, a 640-line SAM/perspective chain in `services/api.js`, 3 barrel files, ~95 unused exports, 1 unused dependency), four files exceed 800 lines (`App.jsx` 3,487 / `CollectionView.jsx` 2,125 / `PostCaptureCentering.jsx` 1,355 / `services/api.js` 1,089), and the client first load is one 718 kB (208 kB gz) chunk with a devDependency (`@xenova/transformers`, 828 kB, second ONNX runtime) shipped lazily. 36 untracked paths triaged; two contain live secrets that `.gitignore` does not cover. Findings: 6 Major, 22 Minor, 6 Note, 0 Blocker.

## 1. Dead code

### 1a. Modules with no importer (delete; confidence High unless noted)

| File | Lines | Evidence | Last touched |
|---|---|---|---|
| `src/services/ocr.js` | 391 | no importer in src/api/scripts; superseded by `src/lib/id-rerank.js` (tesseract via `clip-matcher`) | 2026-04-12 |
| `src/lib/card-matcher.js` | 295 | pHash matcher; no importer; its only consumer `src/lib/phash.js` (291) is then app-dead (kept only by `scripts/build-hash-db.cjs`) | 2026-04-14 |
| `src/lib/image-converter.js` | 151 | no importer; sole user of `heic2any` dependency | 2026-06-07 |
| `src/components/HoloCard/index.js`, `HoloLogo/index.js`, `CardIdentifier/index.js` | 2 each | barrels never imported (App.jsx and CollectionView import the `.jsx` directly) | — |
| `api/_lib/replicate-utils.js` (untracked) | 66 | `pollForResult` duplicate of the local one at `api/card-info-unified.js:240`; nothing imports it | — |
| `config/grading-calibration.json` (tracked) | — | no reference anywhere in src/api/scripts | — |
| `public/card-hashes.json` (1.98 MB, tracked, deployed) | — | fetched only by dead `card-matcher.js:102` and by the `clip-matcher.js:136-160` fallback that returns early once the bucket card DB (v9, always loaded) is present; memory says the JSON fallback was removed, the code and the file remain. Medium confidence (fallback reachable only if `loadEmbeddings()` fails) | 2026-04-14 |

### 1b. Dead exports inside live modules (High unless noted)

- `src/services/api.js` — 640 of 1,089 lines are a dead SAM-mask/perspective crop chain: `analyzeCardWithVision` :46 (only caller is the `@deprecated` `extractCardInfo` :90, itself uncalled), `cropAndRotateCard` :398, `perspectiveTransformFromCorners` :473, `stitchImages` :540, `splitMask` :580, `loadImageFromUrl` :635 (callers 399/542 are dead), `findCardCornersFromMask` :663, `findCornersFromPoints` :710, `perspectiveTransform` :774, `bilinearInterp` :845, `cropCardFromBbox` :854, `processCardFromMask` :886. Live: `shapeAiResult`, `shapeDeepResult`, `claudeGradingAnalysis`, `deepGradingAnalysisV2`, the two upload helpers, `postGrade`.
- `src/services/scans.js` — `uploadCardImage` :17, `scanRowFromSaveData` :59, `saveScan` :171, `getScan` :199, `getScanCount` :252 (app uses `upsertScan`/`getUserScans`/`logMissingImage`/`logIdentification`).
- `src/services/credits.js` — `spendCredits` :38, `refundCredits` :59, `CREDIT_COSTS` :137 (spend/refund moved server-side on 2026-09-15; `GRADE_TIERS` is the source of truth).
- `src/services/cornerEdgeModels.js` — `modelsAvailable` :36 (internal use only), `getRunner` :218, `preloadModels` :238, `modelDingsForSide` :252, `applyModelDings` :291 (app path is `modelSlotsForSide` + `mergeModelDings`).
- `src/services/cardModels.js` — `getCardRunner` :24, `cardModelReady` :53. `src/services/tcgdex.js` — `getAllSets` :21, `searchCardsByName` :42, `searchBySetNumber` :76, `getCard` :108, `getCardImageUrl` :124, `getImageUrlFromCard` :160 (app uses `smartSearch`, `getFullCardData`).
- `src/lib/softwareGrade.js` — `calculateSoftwareConfidence` :18, `getGradesForCompany` :43 (internal only), `companyGradeObject` :114; `src/lib/identify-card.js` — `preloadHashDb` :22, `STATUS_MESSAGES` :138; `src/lib/clip-matcher.js` — `statusFromScores` :307, `isModelLoaded` :423, `areEmbeddingsLoaded` :430, `getEmbeddingsMeta` :437, `DEFAULT_RERANK`/`PIXEL_WEIGHT`/`OCR_WEIGHT` :48-53; `src/lib/card-detector.js` — `getCroppedDataUrl` :281, `visualizeDetection` :294 (only `detectAndCropCard` is used).
- `src/lib/tag-coordinates.js` — 14 of 15 exports unused by the app (`DamageReportModal` imports only `processTagDefects`; `tagToImage`/`imageToTag` used by an untracked HTML tool under `scripts/Tag scraper/`).
- `src/lib/corner-measurement.js` — `lerp` :15, `perpendicularDistance` :29, `medianOf` :43, `stdevOf` :55, `SAMPLE_POSITIONS` :65, `calculateBorderMeasurement` :75; `src/lib/centering-utils.js:191 validateCorners`; `src/lib/gyro-input.js:8 createGyroInput`; `src/lib/image-utils.js:69 canvasToDataUrl`; `src/lib/sparkle-engine.js:174 renderContinuous`; `src/components/CornerHandles.jsx:25 offsetQuad`; `src/lib/card-mask.js:267 refineByLogits`; `src/lib/card-model-runner.js:23-24 CENTERING_INPUT, DEFAULT_FILES`; `src/utils/gradingScales.js:91 COMPANY_IDS` (internal only).
- API: `api/_providers/index.js` — `checkProviderEnv` :169, `getConfiguredProviders` :207, `parseJsonFromResponse` :222, `urlToBase64` :250, `PROVIDER_CAPS` :46; `api/_lib/detectionPrompt.js` — `confidenceFromImageQuality` :456, `DEFECT_TYPES` :30, `SEVERITIES` :34; `api/_lib/credits.js:15 LIFETIME_STATUSES`; `api/_lib/slabs.js:6 SLAB_IMAGE_BUCKET`; `api/_lib/gradeJobs.js` `createJob`/`finishJob`/`failJob` :35-60 (internal to `runGradeJob`, exported needlessly).
- Exported only for tests (keep, Note): `gradingEngine.js` internals (`calculateDeduction`, `diminishFactor`, `centeringScore`, `snapDown`, `centeringSubgrade`, label tables), `card-mask.js` geometry helpers, `tag-crops.js` box helpers, `corner-edge-model.js` `severityFromDeduction`/`sigmoid`/`withoutDetectorCornerEdge`, `grade-rollup.js` `rollupFeatures`/`predictGradeIndex`/`checkTestVectors`, `surfaceDeduction.js` `surfaceFeatures`/`predictPoints`, `credits.js isMissingFunction`, `auth.js bearerToken`, `slabs.js pickImages`/`copySlabImages`.
- Exported only for `scripts/` (keep, Note): `card-mask.quadStats`, `clip-matcher.computeEmbedding`, `corner-edge-model.decodeLogits`, `f16.encodeF16`, `gradingEngine.mergeSubgrades`, `phash.computePHash`, `softwareGrade.mapDingType`, `tag-crops.boxesForTask`/`drawBox`, `surfaceDeduction.surfaceDeductionPoints`/`severityFromPoints`/`SURFACE_SEVERITY_CUTS`.

### 1c. Components never rendered / unreachable server modes

- `src/components/CardViewer/SlabSenseSlab.jsx` (225 lines): imported by `CardViewer3D.jsx:16`, both render sites (:180, :276) are inside the commented "TODO: Re-enable slab view" block; `RealisticSlab` is the only live branch.
- `api/card-info-unified.js` `mode=llava` (Replicate, lines 26, 139-200, local `pollForResult` :240): the client only calls `?mode=claude` (`src/services/api.js:9,28`); the Replicate path and `REPLICATE_API_TOKEN` are unreachable.
- `api/_lib/credits.js` `legacySpend` :75 / `legacyRefund` :159: run only if the `spend_credits`/`refund_credits` RPCs are missing (`20260915_credits_atomic.sql` not applied). Tested (`credits.test.js`) but a second accounting path.

### 1d. Legacy pixel detectors: what still runs, under which flag

- `src/lib/detectors.js` (651 lines) runs on every grade, both sides, regardless of the flag: `App.jsx:169 analyzeCardFull` → `analyzePixels` (`detectors.js:639`) → `findBounds`, `analyzeCentering`, `checkCenteringDings`, `detectCornerDings`, `detectEdgeDings`, `detectSurfaceDings`. With `slabsense_modelGrading` on (default via `VITE_MODEL_GRADING`; `cornerEdgeModels.js:46`) `withModelDings` (`App.jsx:183`) then calls `mergeModelDings` (`corner-edge-model.js:155`) which **discards** the detector's corner/edge dings and keeps its surface and centering dings. So the legacy corner/edge detectors are computed and thrown away on the default path (wasted main-thread time on the 1400 px copy, two sides).
- Flag off (Settings toggle, `VITE_MODEL_GRADING=0`, or the crash guard `detectModelPassCrash()` `cornerEdgeModels.js:75-81` writing `FLAG_KEY='0'` after a page reload): the legacy corner/edge dings decide the free grade. Same for any model failure (`modelUsed:false`). The viewfinder (`App.jsx:866 detectCardLive`, :1373 `validateCap`) and `scripts/models/label-card-val.mjs` still use `findBounds` for the no-model fallback.
- `ManualBoundaryEditor`: no remnant anywhere in `src/` (0 grep hits for `ManualBoundaryEditor|BoundaryEditor`). The manual path is now `PostCaptureCentering` + `CornerHandles`; `App.jsx:1515 manualMode` and the centering tab (:3324-3454) are its replacement, both live.

## 2. Duplicated code

| Logic | Locations |
|---|---|
| Promise-wrapped `new Image()` loader | `src/lib/image-utils.js:52 loadImageElement` (canonical), `src/lib/centering-utils.js:13 loadImage`, `src/lib/id-rerank.js:24 loadImage`, `src/services/cardModels.js:42 loadImage`, `src/lib/card-detector.js:104 loadImage`, `src/services/api.js:635 loadImageFromUrl` (dead), `src/App.jsx:153 cropReg` inline |
| Downscale-to-canvas + dataURL | `src/lib/image-utils.js:13 loadImg` / :81 `resizeImage`, `src/App.jsx:153 cropReg`, `src/components/CardCropModal.jsx` (2× `new Image()`), `src/lib/phash.js` |
| FileReader → dataURL | `src/App.jsx:1149`, `src/App.jsx:2388`, `src/lib/image-converter.js:99,111` (dead) |
| Upload image to `card-images` bucket | `src/services/api.js:206 uploadImageForStandardAnalysis` vs :339 `uploadImageForDeepAnalysis` (identical bodies, different strings) vs `src/services/scans.js:17 uploadCardImage` (dead) |
| Supabase service-role client | created separately in 10 API files: `ai-analyze-unified.js:221`, `deep-analyze-v2.js:54,501` (twice in one file), `credits/{balance,refund,spend}.js`, `slabs.js:36`, `stripe/{create-checkout,create-portal,webhook}.js` |
| Replicate polling | `api/_lib/replicate-utils.js:pollForResult` (untracked) vs `api/card-info-unified.js:240` |
| Company name/colour tables | `src/utils/gradingScales.js:94 GRADING_COMPANIES` (canonical), `src/components/Collection/CollectionView.jsx:23 GRADING_COMPANIES` (local copy with different colours, while also importing the canonical one as `GRADE_SCALES`), `src/components/CardViewer/RealisticSlab.jsx:21 COMPANY_STYLES`, `src/lib/gradingEngine.js:389-398 *_LABELS` (engine source, fine) |
| TAG score → band/label | `src/lib/softwareGrade.js:50 getGrade` vs `src/utils/gradingScales.js:115 getGradeFromScore` (same band walk over the same table) |
| localStorage JSON get/set with try/catch | `src/App.jsx:2213-2222 readJobs/writeJobs/savedScanFor/rememberSavedScan`, `src/lib/line-color.js loadLineStyle/saveLineStyle`, `src/services/cornerEdgeModels.js:46-91` (five keys), `App.jsx:895 autoSnapEnabled` |
| 4-image / 2-image request shaping | `src/services/api.js:1011` "legacy 2-image" and `api/deep-analyze-v2.js:206 hasLegacy` both carry the old shape |
| Reset of grade state | `src/App.jsx:1893 resetGradingState` (35 setters in one line) and :1894 `reset` — the 13 `ai*`/`deepAi*` useStates are one object in `shapeAiResult`/`shapeDeepResult` already |
| Grade display | `App.jsx:224 GradeDisplay`, :311 `GradeDisplaySimple`, `components/Grading/GradeResultDisplay.jsx`, `CollectionView.jsx:2002-2125 SubgradeBox/CenteringBox/ConditionBox` all render the same subgrade/centering boxes |

## 3. TODO / FIXME / HACK / legacy / deprecated markers (code only; test files and docstrings that merely describe the adapter are listed once)

| file:line | marker | disposition |
|---|---|---|
| `src/components/Auth/UserMenu.jsx:156` | `TODO: Upgrade` (button does nothing but close) | fix — open the pricing modal (`setShowPricing`) or remove the item |
| `src/components/CardViewer/CardViewer3D.jsx:10-11,123` | `TODO: Re-enable slab view` | delete — drop `SlabSenseSlab.jsx` and the import, or finish it; not before submission |
| `src/components/Collection/CollectionView.jsx:350` | `TODO: detect from card info` (hard-coded `modern_holo`) | fix — use `isHoloCard(scan)` defined in the same file :71 |
| `src/lib/softwareGrade.js:42,61,71,89,112,128,144,158,169-179` | "Legacy GRADES / legacy fields (keep until UI migrates; see ENGINE_WIRING.md)" | fix — the referenced doc is untracked scratch (`staging/unified prompting/ENGINE_WIRING.md`); migrate the UI to the unified fields and drop the legacy block |
| `src/lib/corner-edge-model.js:5,107,138`, `corner-edge-runner.js:137`, `services/cornerEdgeModels.js:8,250` | "legacy dings" vocabulary | keep — "ding" is the engine's input contract; rename to "detector dings" when the detectors go |
| `src/services/api.js:87-92` | `@deprecated extractCardInfo` | delete (dead, §1b) |
| `src/services/api.js:1011` | "Support legacy 2-image calls" | delete — the only caller (`App.jsx:2339` path) always sends 4 images |
| `api/card-info-unified.js:10,26,139` | LLaVA/Replicate "(legacy)" | delete the mode and the env var (§1c) |
| `api/credits/spend.js:5`, `api/_lib/credits.js:7,38,75,140,159` | "legacy fallback pre-migration" | fix — confirm the RPC migration is applied in prod, then delete `legacySpend`/`legacyRefund` and their tests |
| `api/deep-analyze-v2.js:206-207` | `hasLegacy` 2-image acceptance | delete once the client's 2-image shape is gone (same change as api.js:1011) |
| `api/deep-analyze-v2.js:454,468` | "legacy top-level keys" duplicated beside `analysis.*` | fix — `shapeDeepResult` (`api.js:138`) already reads `analysis.*` with top-level fallback; drop the copies |
| `src/lib/grade-records.test.js:31`, `api/_lib/credits.test.js:*`, `src/lib/softwareGrade.test.js:2` | tests of legacy rows/paths | keep while the paths exist |

No `FIXME`, `HACK` or `XXX` markers exist. Count: 24 marker lines in non-test code, 12 distinct items.

## 4. Files over 800 lines and proposed splits

`src/App.jsx` 3,487 (81 `useState`, 14 refs, 15 effects, 9 callbacks, 426 inline `style={{}}`), `CollectionView.jsx` 2,125 (24 states), `PostCaptureCentering.jsx` 1,355 (29 states, 17 refs), `services/api.js` 1,089 (640 dead).

### App.jsx → feature modules (line ranges are today's)

| Module | Moves there | State it owns | Props crossing the boundary |
|---|---|---|---|
| `src/lib/photo-quality.js` | `analyzePhotoQuality` 53-152 (Laplacian/brightness) | none (pure) | `(imageSrc) → quality` |
| `src/features/grading/analyze.js` | `cropReg` 153, `formatCaps` 159, `analyzeCardFull` 169, `withModelDings` 183, `calcConfidence` 588, `getNextGradeInfo` 621 | none (pure/async) | `(src, side, bounds?, centering?, onProgress) → sideResult` |
| `src/features/capture/CameraViewfinder.jsx` | 866-1376: `detectCardLive`, `LIVE_*`/`AUTO_SNAP_*` consts, `coverToScreen`, `CameraViewfinder`, `validateCap` | active, tilt, orientPerm, captured, validating, validation, camError, cardOutline, cardStable, autoSnap, autoProgress, isUploading, uploadError, hasCamera + videoRef/streamRef/captureRef/fileRef/detectRef | in: `side`; out: `onCapture(dataUrl)`, `onClose()` (unchanged) |
| `src/features/capture/CaptureCards.jsx` | `PhotoQualityBadge` 479, `CaptureCard` 1377, `CaptureCardVertical` 1394 | none | `label, side, image, quality, onImage, onOpenCamera` |
| `src/features/grading/GradeDisplays.jsx` | `ScoreRing` 217, `GradeDisplay` 224, `GradeDisplaySimple` 311, `SubScoreBar` 340 (merge with `components/Grading/GradeResultDisplay.jsx`) | none | `gradeResult, companyId, isPro` |
| `src/features/grading/DingsViews.jsx` | `SurfaceVision` 505, `MeasurementOverlay` 518, `DingsMap` 658, `DingLocationOverlay` 769, `DingsPreview` 819 | showAnnotations, imgDims, side | `frontResult, backResult, maps, images` |
| `src/features/home/HomeTab.jsx` | `HomeTab` 345-478 | none | `auth, collectionStats, onOpenCollection, onStartScan` |
| `src/features/grading/useGradeJobs.js` (hook) | 2205-2425: `JOBS_KEY`/`SAVED_KEY` helpers, `cardKeyFor`, `applyGradeResult`, `pollJob`, `startGradeJob`, `restoreJob`, the restore effects 1810-1842 | `paid` reducer `{ ai: {subgrades, overall, grades, confidence, summary, notes, defects, status}, deep: {...} }` replacing the 13 `ai*`/`deepAi*` states + `resumeJob`, `insufficientCredits`, `cardKeyRef`, `gradeRunRef`, `pendingApplyRef` | in: `auth, fR, bR, fI, bI, gradingCompany, frontCenteringData, backCenteringData`; out: `paid, startGradeJob(type), restoreJob, dismissResume` |
| `src/features/save/useScanSave.js` (hook) | 1985-2201: `buildSaveData`, `persistScan`, `handleSaveScan`, `handleCropComplete`, `handleCropSkip`, autosave effect 2091 | savedScanId(+ref), savedImagesRef, saveChainRef, autosaveArmedRef, savingStatus, pendingSaveData, showCropModal | in: the session + `paid` + `cardInfo/tcgdex`; out: `save(), savingStatus, cropModalProps` |
| `src/features/centering/useCentering.js` + `CenteringTab.jsx` | `applyManualCorrection` 1657, `handleTabCenteringConfirm` 1737, `handleCenteringConfirm/Skip` 1939-1966; JSX 3324-3454 | frontCenteringData, backCenteringData, frontCroppedImage, backCroppedImage, centeringConfirmed, ignoreCentering, manualMode, showPostCaptureCentering | in: `fI, bI, fR, bR, setSideResult(side, r)`; out: handlers + `centering` slice |
| `src/features/scan/useScanSession.js` (reducer) | step, fI/bI, fR/bR, fM/bM, gradeResult, prog, frontQuality/backQuality, `run` 1745, `reset*` 1893-1894, `handleSetFront/BackImage` 1897-1937, recompute effect 1860 | all of the above | out: `session, dispatch, run()` |
| `src/features/scan/ScanTab.jsx`, `GradeTab.jsx` | JSX 2716-2758; 2759-3323 (card header, mode toggle, score block, vision slider/buttons, action icons, 4 score boxes, dings, notes, TAG/BGS/CGC subgrade panels, centering block, AI summary) | visionMode, visionIntensity, gradeMode, useAiCentering, showAnnotations | in: `session, paid, gradeMode, company, cardInfo, tcgdex, centering`; out: `onIdentify, onExport, onDamageReport, on3D, onSave, onStartGradeJob` |
| `src/app/AppShell.jsx` | header 2647-2681, tab bar 2426-2438 + 2682-2715, disclaimer 2630, modal mounts 2439-2645 | tab, show* flags (auth, collection, export, damage, settings, 3D, identifier, pricing, disclaimer) | children + the modal props |
| `src/App.jsx` (remaining ~350 lines) | composes the hooks, owns `gradingCompany`, `cardInfo`, `tcgdexData/Image`, `collectionStats`, `gyroInputRef`, `auth` | | |

Rule for the cut: pure functions first (no behaviour change, testable with `node`), then the three hooks, then the JSX tabs; `useScanSession` last because every other module reads it.

### PostCaptureCentering.jsx → 
`lib/centering-geometry.js` (pure: `edgeHandlePoint` 331, `moveOuterHandle` 386, `moveInnerHandle` 400, `cornerPoint` 223, handle-size/line-weight maths 676-737), `useStageGestures.js` (view, activeCorner, dragPoint/dragAnchor, `getCoords` 204, `viewportSize` 217, `zoomToCorner` 234, `resetView` 241, pointer handlers 248-304), `useUndoHistory.js` (305-318, undoCount), `useModelSuggestions.js` (suggestion, touchedRef, suggestTokenRef, the `suggestOuter`/`suggestInner` effects), `centering-confirm.js` (pure builders for the `handleNext` 414-523 and `handleConfirm` 576-639 payloads → `buildCenteringData(mode, outer, inner, corners, rotation, tilt, source)`), `CenteringControls.jsx` (header/step 750-791, measure-mode toggle 792-827, rotation/tilt 828-932, readout 933-958, legend 959-975, zoom bar 976-1003, line settings 1004-1027, vision views 1028-1044), `CenteringStage.jsx` (viewport/stage/image/overlay 1045-1261 with four layer components `OuterEdgeLayer` 1089, `OuterCornerLayer` 1143, `InnerEdgeLayer` 1163, `InnerCornerLayer` 1228, plus `Loupe`), `CenteringActions.jsx` (1269-1340). The orchestrator keeps step, outer/inner, outerCorners/innerCorners, croppedPreview, imgSize, measureMode, rotation/tilt, maps, lineStyle (~350 lines). Props in/out are unchanged (`image, side, initial*, suggestOuter/Inner, onConfirm/onSkip/onCancel`).

### CollectionView.jsx →
`lib/card-price.js` (`getCardPrice` 42, `formatPrice` 62, `EUR_TO_USD`), `CollectionGrid.jsx` (list/filter/sort + `HoloCard` tiles), `CardDetail.jsx` (the selected-card panel: 3D viewer, damage report, slab order, delete), `CollectionDetailBoxes.jsx` (`SubgradeBox`/`CenteringBox`/`ConditionBox`/`InfoRow` 2002-2125, which duplicate `GradeResultDisplay`), and delete the local `GRADING_COMPANIES` (:23) in favour of `utils/gradingScales`.

## 5. Untracked and scratch files (`git status --short`)

| Path | What it is | Proposal |
|---|---|---|
| ` M scripts/tag-dataset/tagdataset/{cli,download}.py` | owner's proxy changes the foil pull ran on | commit (STATUS "Housekeeping owed") |
| `CODEBASE_DOCUMENTATION.md` (959 lines), `CROSS_REFERENCE.md` (833) | generated 2026-06-16 descriptions of the June codebase; stale (pre-models, pre-card-DB) | delete; this audit and `docs/STATUS.md` replace them |
| `Mapping Defects/` (2 md, June 11) | variants of `staging/damage-report/tag-data/TAG_COORDINATE_MAPPING.md`/`TAG_GRADING_MATRIX.md` (differ) | delete after confirming `docs/grading-research/` holds the TAG coordinate notes |
| `SlabSense Slab Engraving Studio/SlabSense-Engraving-Studio.html` (562 KB) | source the live `public/studio.html` + `public/slab/*.js` were carved from (`scripts/split-studio.cjs`) | keep-and-track (it is the editable original of a shipped page) |
| `…/SlabSense-Engraving-Studio.pre-settings-backup.html` (433 KB) | backup copy | delete |
| `…/SLABBING-PIPELINE.md`, `…/docs/` (5 design docs, Sept 12-14; `slab-order-setup.md` differs from the runbook copy) | engraving design notes | move to `docs/superpowers/specs/` (dedupe with `docs/superpowers/runbooks/slab-order-setup.md`), track |
| `…/Referances/` (4 jpg, 386 KB) | label/slab reference photos | move to `docs/engraving/refs/` and track, or scratch dir |
| `Slabsense Gemini API-.txt` | **live Gemini and OpenAI keys** in plain text; `.gitignore` has `*-API-.txt` which does not match this name (space before `API`); never committed (no history) | rotate both keys, delete the file, add `*API-.txt` to `.gitignore` (D-03) |
| `api/_lib/replicate-utils.js` | dead duplicate (§1a) | delete |
| `docs/audits/` | this audit | keep-and-track |
| `scripts/Tag scraper/` (10 MB: `tag_cache.json` 8.3 MB, `training.json` 1.85 MB, June `.cjs` scrapers, `tag_proxy.py` with signing secret + AES key, `__pycache__`) | the June scraper, superseded by `scripts/tag-dataset/` | rotate the secrets, move the folder out of the repo (data to R2), add `scripts/Tag scraper/` to `.gitignore` meanwhile |
| `scripts/tag_scraper.py` | byte-identical to `scripts/Tag scraper/tag_scraper.py` | delete |
| `scripts/analyze_tag_calibration.cjs` | June 9 v1; tracked `_v2.cjs` exists | delete |
| `scripts/check_card_types.cjs`, `check_centering_format.cjs`, `get_references.cjs` | June one-offs reading `.env.local` against `graded_references` | delete |
| `scripts/certs.txt` (98 cert ids) | input list for the June scraper | delete |
| `scripts/deep_analyze_v3_test_results.json`, `scripts/test_deep_analyze_v3.js` | tests of `backup-api/deep-analyze-v3.js` (dead endpoint); tracked twin `test-deep-analyze-v3.js` | delete both twins with `backup-api/` |
| `scripts/upload_graded_references.js` | ESM twin of tracked `upload_graded_references.cjs` (one-off, June 8) | delete |
| `scripts/harness/results/2026-09-17-model.json` | harness result like its tracked siblings | keep-and-track |
| `scripts/tag-dataset/test_proxy_{single,speed}.py`, `test_quick.py` | proxy-rate debugging scripts | move to scratch dir (or `scripts/tag-dataset/tools/` if the proxy work continues) |
| `staging/damage-report/mockup/coordinate-test.html`, `staging/unified prompting/` | June mockup; June engine-wiring docs + old api copies (`ENGINE_WIRING.md` is cited by `softwareGrade.js:171`) | move the 5 `.md` to `docs/grading-research/archive/`, delete the `.js`/`.jsx`/`.json` copies; then delete all of `staging/` (31 tracked June backups) |
| `training/eval_logs/task4/` (`.out.log`, `.pid`) | run logs | delete; add `training/eval_logs/` to `.gitignore` |
| `training/tools_make_backgrounds.py` (385 lines) | background generator for the card compositor (not referenced by any doc) | keep-and-track, add a line to `training/README.md` |
| `training/weights/card/v1/{args.json,eval_real.csv,eval_synth.csv,log.csv}`, `training/weights/centering_rgb/v1/eval_val*.csv`, `training/weights/centering_rgb/v2b/{args.json,eval_*.csv,log.csv}` | run records of the live card and centering models (`.pt` ignored) | keep-and-track (same convention as the tracked corners/edges dirs) |
| `training/weights/onnx/card-v1.json`, `card-v1.parity.json`, `centering_rgb-v2b.json`, `centering_rgb-v2b.parity.json` | export manifests + parity records of the two models **live in production**; every older manifest is tracked | keep-and-track now (D-04) |
| `training/weights/surface/smoke/deduction_val.csv` | rejected surface smoke run | delete |

Tracked leftovers worth the same triage (Note): `backend/` (Python FastAPI prototype, last touched 2026-04-14), `backup-api/` (3 old deep-analyze versions), `staging/` (31 files), `CODEBASE_AUDIT.md` (544) and `HANDOFF.md` (812) at the root, `todo/`, `logo stuff/`, June one-offs `scripts/{analyze_tag_calibration_v2,build-hash-db,check_supabase,upload_graded_references}.cjs`, `scripts/generate-transformers-embeddings.mjs`, `scripts/split-embeddings.cjs`, `config/grading-calibration.json`, `public/card-hashes.json`.

## 6. Dependencies

- **Unused:** `heic2any` (only importer is dead `src/lib/image-converter.js`).
- **devDependencies shipped to the client:** `@xenova/transformers` (dynamic import `src/lib/clip-matcher.js:93` → 828 kB chunk; it carries its own `onnxruntime-web@1.14.0` under `node_modules/@xenova/transformers/node_modules/`, flagged by the build for `eval`).
- **devDependencies used only by scripts (fine):** `canvas`, `heic-convert`, `jsqr`, `pngjs`, `onnxruntime-web@1.30.0` (harness); the client never imports `onnxruntime-web` — it fetches `${MODELS_BASE}/ort/ort.min.mjs` from the models bucket (`cornerEdgeModels.js:193`).
- **Duplicated in purpose:** three ONNX runtimes (bucket ORT for corner/edge/card/centering, transformers' ORT 1.14 for CLIP, top-level 1.30 for scripts); `heic2any` (client, dead) vs `heic-convert` (scripts); `tesseract.js` imported by dead `ocr.js` and live `id-rerank.js`; `openai` SDK serves both OpenAI and xAI providers (intended).
- All other runtime deps have importers (`@anthropic-ai/sdk`, `@google/generative-ai`, `@supabase/supabase-js`, `@tcgdex/sdk`, `html2canvas`, `openai`, `react`, `react-dom`, `stripe`, `tesseract.js`).

## 7. Bundle (`vite build`, 197 modules, 30.6 s)

| Chunk | Raw | Gzip | Loaded | Contents |
|---|---|---|---|---|
| `index-BpROA30R.js` | 718.0 kB | 207.5 kB | first load (only `<script>` in `dist/index.html`) | React + ReactDOM, `@supabase/supabase-js`, `@tcgdex/sdk`, all of `src/` reachable from `App.jsx` (every tab, modal, `CollectionView`, `PostCaptureCentering`, `PricingPage`, `DamageReport`, `CardViewer3D`, engine, detectors), `config/holo-config.json` (3.4 kB) |
| `transformers-DH2twgIt.js` | 828.1 kB | 200.9 kB | lazy, card identify | `@xenova/transformers` + its ORT 1.14 |
| `html2canvas.esm-QH1iLAAe.js` | 202.4 kB | 48.0 kB | lazy, export | `html2canvas` |
| `index-qEfrVXE3.js` | 15.8 kB | 6.8 kB | lazy | `tesseract.js` entry (worker fetched at runtime) |
| `id-rerank-BZv3VOak.js` | 3.9 kB | 1.9 kB | lazy | `src/lib/id-rerank.js` |

First load: 719 kB raw / 208 kB gzip (+ `manifest.json`, icons). Not bundled, fetched at runtime: ORT from the models bucket, card model 6 MB, corner+edge 54 MB, centering ~56 MB, CLIP ViT-B/32 from Hugging Face on identify, card-DB shards from the bucket. Not leaking into the client: `api/_lib/models/grade-rollup-v1.json` (1.9 MB) and `surface-deduction-v1.json` (383 kB) are reached only from `api/_lib/*.js` (static `import … with { type: 'json' }`), so every paid-grade function cold start parses 2.3 MB of trees even with `GRADE_ROLLUP_MODEL` off. Deployed but not bundled: `public/card-hashes.json` 1.98 MB (§1a), `public/slab/vendor/*` (opentype, polygon-clipping, qrcode, a second supabase-js copy) for the studio pages. Build warnings: `scans.js` both static and dynamic imported from `App.jsx:1614`; chunk > 500 kB; `eval` in transformers' ORT. `public/card-images/` (18 GB, gitignored) is copied into `dist/` on every build (a concurrent build hit `ENOTEMPTY` on `dist/card-images` during this audit).

## 8. Structural notes

- **Styling:** zero `.css` files; 1,088 inline `style={{}}` across 24 components (`App.jsx` 426, `CollectionView` 152, `PostCaptureCentering` 96, `PricingPage` 61, `GradeResultDisplay` 57) plus six `<style>` tags (`App.jsx` ×3, `CardIdentifier`, `CollectionView`, `VisionModeControls`); one `className` in the codebase (`HoloCard`). Font stacks `mono`/`sans` are re-declared per file (`CollectionView.jsx:20-21`, `App.jsx`).
- **Naming:** `src/lib` is kebab-case except `gradingEngine.js`/`softwareGrade.js`; `src/services` is camelCase; components are PascalCase folders with and without barrels; API routes kebab-case, `api/_lib` camelCase. State in `App.jsx` mixes `fI/bI/fR/bR/fM/bM` with `frontCenteringData`.
- **console.log in production paths** (non-test, 105 total): `src/services/api.js` 24, `api/deep-analyze-v2.js` 13, `src/services/ocr.js` 10 (dead), `api/stripe/webhook.js` 10, `src/lib/identify-card.js` 5, `src/lib/card-matcher.js` 5 (dead), `CardIdentifier.jsx` 5, `src/App.jsx` 5 (:1980, :1996, :2033, :2169, :2291), `api/card-info-unified.js` 4, `scans.js` 3, `ai-analyze-unified.js` 3, 2 each in `image-converter`, `clip-matcher`, `CollectionView`, four `_providers/*`, `replicate-utils`, 1 each in `tcgdex`, `phash`. `App.jsx:1996/2033` log image data-URL prefixes and the full Deep AI state object on every save.
- **Tests** are colocated `*.test.js` run by a 19-command `&&` chain in `package.json` `test:lib` (no runner, no coverage, no React component tests); `src/lib/__fixtures__/C1287305_front_1400.jpg` is tracked.
- **API handlers** each build their own Supabase client, auth check and CORS; `api/_lib/routes/` exists for slabs only.

## Findings

D-01 | Major | `package.json`, `src/lib/clip-matcher.js:93` | dependency hygiene / 2.1 performance | `@xenova/transformers` is a devDependency yet ships as the 828 kB identify chunk, bundling a second ONNX runtime (1.14.0) beside the bucket ORT the grading models use, so an identify after a grade holds two runtimes + WASM in one phone tab (the memory-tight phones already reload) | move to `dependencies`; run CLIP on the bucket ORT or move identification server-side
D-02 | Major | `public/card-images/` (18 GB) | build hygiene | copied into `dist/` on every `vite build`; two concurrent builds raced (`ENOTEMPTY` on `dist/card-images`) | move the folder out of `public/` (e.g. `data/card-images/`) and point the card-DB scripts at it
D-03 | Major | `Slabsense Gemini API-.txt`, `scripts/Tag scraper/tag_proxy.py` | secrets | live Gemini/OpenAI keys and the proxy signing secret + AES key sit untracked; `.gitignore` `*-API-.txt` does not match the filename, so `git add .` would commit them; never in history, so no rewrite needed | rotate, delete, add `*API-.txt` and `scripts/Tag scraper/` to `.gitignore`
D-04 | Major | `training/weights/onnx/{card-v1,centering_rgb-v2b}.json` + `.parity.json` | reproducibility | the export manifests and parity records of the two models in production are untracked; all older ones are tracked | `git add` them with the `training/weights/card/v1` and `centering_rgb/v2b` run records
D-05 | Major | `src/App.jsx` (3,487 lines, 81 states) | maintainability / 2.1 stability | one component owns camera, analysis, three grade modes, jobs, saving, six tabs and nine modals; `resetGradingState` :1893 calls 35 setters and any missed one leaks state across cards | split per §4 (pure functions, then hooks, then tab components)
D-06 | Major | `src/lib/detectors.js:639` ↔ `src/services/cornerEdgeModels.js:75-81` | silent behaviour fork | the pixel corner/edge detectors always run and are discarded when models are on; when the crash guard flips `slabsense_modelGrading` to `0` the untuned pixel dings decide the free grade with no UI signal and no per-release harness check | either skip `detectCornerDings`/`detectEdgeDings` when models are on and label the models-off grade "corners/edges unchecked", or keep the fallback and add it to the harness gate
D-07 | Minor | `src/services/api.js:46-104, 398-983` | dead code | 640-line SAM-mask/perspective chain and the deprecated `extractCardInfo` have no callers (§1b) | delete; `api.js` becomes ~450 lines
D-08 | Minor | `src/services/ocr.js`, `src/lib/card-matcher.js`, `src/lib/phash.js`, `src/lib/image-converter.js` | dead modules | no importer (§1a); `phash.js` kept only by `scripts/build-hash-db.cjs` | delete all four and `scripts/build-hash-db.cjs`; drop `heic2any`
D-09 | Minor | `public/card-hashes.json`, `src/lib/clip-matcher.js:136-160` | dead fallback shipped | 1.98 MB deployed for a fallback that returns early whenever the bucket DB loaded | delete the file and `loadCardInfo()`; fail identify loudly if the shards are missing
D-10 | Minor | `src/components/{HoloCard,HoloLogo,CardIdentifier}/index.js` | dead barrels | never imported | delete, or import through them consistently
D-11 | Minor | `api/card-info-unified.js:26,139-260`, `api/_lib/replicate-utils.js` | unreachable server mode + duplicate | `mode=llava` is never sent by the client; `pollForResult` exists twice | delete the LLaVA branch, `REPLICATE_API_TOKEN` and the untracked helper
D-12 | Minor | `src/components/CardViewer/SlabSenseSlab.jsx`, `CardViewer3D.jsx:10,123` | never rendered | 225-line component behind a commented toggle | delete or schedule; not in the submission build
D-13 | Minor | §1b list | unused exports | ~95 exports with no consumer in app or api (scans, credits, cornerEdgeModels, tcgdex, tag-coordinates, corner-measurement, providers, detectionPrompt…) | delete; keep the test-only and scripts-only exports, mark them `/** @internal */`
D-14 | Minor | `src/services/api.js:206` vs `:339` | duplication | the two upload helpers differ only in error strings | one `uploadGradeImage(dataUrl, side, userId, label)`
D-15 | Minor | 10 API files (§2) | duplication | ten service-role Supabase clients, ten auth/CORS preambles | `api/_lib/db.js` + `api/_lib/handler.js` wrapper
D-16 | Minor | `src/components/Collection/CollectionView.jsx:23`, `RealisticSlab.jsx:21`, `softwareGrade.js:50` vs `gradingScales.js:115` | duplicated tables/logic | second company table with different colours; two TAG band lookups | use `utils/gradingScales` only
D-17 | Minor | 5 `loadImage` copies (§2) | duplication | same Promise/`new Image()` wrapper five times, three without `crossOrigin` | use `image-utils.loadImageElement`
D-18 | Minor | `src/lib/softwareGrade.js:42-179`, `src/services/api.js:1011`, `api/deep-analyze-v2.js:206,454-468` | legacy shapes | "keep until UI migrates" fields, 2-image acceptance and duplicated top-level keys still shipped; the referenced `ENGINE_WIRING.md` is untracked scratch | migrate the Grade tab to the unified fields, drop the legacy block and the 2-image path
D-19 | Minor | `api/_lib/credits.js:75,159` | second accounting path | `legacySpend`/`legacyRefund` run if the RPC migration is absent | verify the migration in prod, delete the fallback
D-20 | Minor | `api/_lib/gradeRollup.js:13`, `api/_lib/surfaceDeduction.js:23` | cold start | 2.3 MB of JSON trees statically imported into every paid-grade function while `GRADE_ROLLUP_MODEL` is off | lazy `import()` behind the flag; keep the surface model static (it is used)
D-21 | Minor | `src/App.jsx:1614` | build warning | `scans.js` both static and dynamic imported, so the dynamic import splits nothing | import `getUserScans` statically
D-22 | Minor | `src/App.jsx` (one 718 kB chunk) | first-load size | every tab/modal is in the entry chunk | `React.lazy` for `CollectionView`, `PricingPage`, `DamageReportModal`, `CardViewer3D`, `PostCaptureCentering`, `ExportCard`, `ProfileSettings`
D-23 | Minor | `src/components/Collection/CollectionView.jsx` (2,125), `PostCaptureCentering.jsx` (1,355) | file size | single components with 24 / 29 states | split per §4
D-24 | Minor | `src/App.jsx:1996,2033` and 103 other `console.log`s (§8) | console noise in prod | logs image data-URL prefixes and full grade state on every save; webhook logs 10 lines per event | strip `console.log` (keep `warn`/`error`); add a `debug()` gated on `import.meta.env.DEV` |
D-25 | Minor | `src/components/Auth/UserMenu.jsx:156` | dead control | "Upgrade" menu item only closes the menu | open the pricing modal or remove
D-26 | Minor | `src/components/Collection/CollectionView.jsx:350` | TODO | holo type hard-coded to `modern_holo` for every card | use `isHoloCard(scan)` :71
D-27 | Minor | root + `scripts/` untracked one-offs (§5) | repo hygiene | 2 stale generated docs, 9 June one-off scripts, 3 duplicate twins, 10 MB of scraper cache | apply the §5 table (delete 18, track 9, move 6)
D-28 | Minor | `staging/` (31 tracked), `backup-api/`, `backend/`, `CODEBASE_AUDIT.md`, `HANDOFF.md`, `config/grading-calibration.json` | tracked leftovers | June backups of API files, an abandoned Python backend, an unreferenced calibration JSON | delete; archive the five `staging/unified prompting/*.md` under `docs/grading-research/archive/`
D-29 | Note | `src/lib/detectors.js:488 detectSurfaceDings` | design | the only surface signal on the free path is the pixel detector; intentional until the surface model lands | record only
D-30 | Note | §8 styling | consistency | 1,088 inline style objects, zero stylesheets, repeated font stacks | adopt one token module (`src/styles/tokens.js`) during the split; not a submission item
D-31 | Note | §8 naming | consistency | kebab vs camel in `src/lib`, barrels used for 2 of 5 folders | pick kebab for lib/services, drop barrels
D-32 | Note | `package.json` `test:lib` | test harness | 19 chained node scripts, no runner, no component tests | `node --test` glob (`node --test src api`) in Phase 3
D-33 | Note | `public/slab/vendor/supabase.js` | duplication | second copy of supabase-js for the studio pages | acceptable while the studio is a static page
D-34 | Note | `src/lib/__fixtures__/C1287305_front_1400.jpg` | tracked binary | used by tests; fine, record the licence (TAG cert image) for the IP section
