# Software Grade Review — 2026-09-13

**Date of review:** September 13, 2026
**Scope:** The client-side "Software Grade" path only (`run()` → `analyzeCardFull()` → `computeGrade()` → `gradeCard()`).
**Trigger:** Software grades are coming out wrong. No code was changed during this review.
**Owner's answers (2026-09-13):** grades are **too lenient** in practice. A card with a clear crease
across the middle graded a 9. Both corner and edge measure modes are in use (user preference at
upload). Auto centering is intentionally disabled; the user's outer-border crop and inner-border
ratios are meant to be used everywhere downstream.
**Headline cause of the leniency:** the software detectors can only emit CORNER WEAR, EDGE WEAR and
SURFACE / PLAY WEAR. Creases, dents, scratches, ink defects, stains and tears are never produced,
so the engine's crease/tear/stain caps can never fire on the software path. See F10.
**Cross-checked against:** `CROSS_REFERENCE.md`, `CODEBASE_AUDIT.md`, `CODEBASE_DOCUMENTATION.md`, `docs/GRADING_SCALE.md`, `docs/grading-research/TAG_DIG_CALIBRATION_DATA.md`.

> Line numbers below are from the working tree on 2026-09-13. The three reference docs are
> roughly 60 lines stale for App.jsx (the audit lists `computeGrade` at 834; it is at 897) but
> their descriptions of the three grading paths are otherwise accurate and were used to
> separate software-only issues from shared or AI-only ones.

---

## 1. How the software grade actually flows (verified)

```
Capture photo -> analyzePhotoQuality() -> PostCaptureCentering (manual, no skip button)
   Step 1: user drags OUTER card border -> crop generated (frontCroppedImage / backCroppedImage)
   Step 2: user drags INNER art border on the crop -> lrRatio / tbRatio
   Result stored in frontCenteringData / backCenteringData

run()  [App.jsx:2999]
   builds overrideBounds from centeringData (corner mode: outerCorners bbox; edge mode: .outer)
   analyzeCardFull(fI, 'front', overrideBounds, overrideCentering)   [App.jsx:3040]
      loadImg(fI, 1400)                <- fI is the ORIGINAL photo, NOT the crop
      bounds    = overrideBounds || findBounds()
      centering = overrideCentering || analyzeCentering()
      detectCornerDings / detectEdgeDings / detectSurfaceDings on (original photo, bounds)
   computeGrade(fr.allDings, br.allDings, effFront, effBack, company, imageQuality) [App.jsx:3061]
      dings -> engine defects (mapDingType / mapDingSeverity)
      gradeCard()  <- src/lib/gradingEngine.js (82/82 tests pass)
      returns legacy `grade` (TAG-band lookup) + unified `companyGrades`
UI reads gr.grade.grade   [App.jsx:4108]
Save stores gradeResult.grade.grade as grade_value, rawScore as raw_score  [App.jsx:3209, 3231]
Collection recalculates from raw_score via getGradeFromScore(rawScore, company)  [CollectionView.jsx:509]
```

**Key fact:** the intended design is "detectors run on the user's cropped image". Today the
cropped image is used for saving, the AI paths, the 3D viewer and display, but the software
detectors are never given it. They run on the original photo with the manual bounds overlaid.

**Auto centering:** the manual tool has no Skip button (`onSkip` only fires in the error
`catch`), so `analyzeCentering()` and `findBounds()` are only reached on an error path. The
manual lrRatio / tbRatio values are what feed the engine, which is correct.

---

## 2. Findings

Each finding is tagged **[SOFTWARE ONLY]**, **[SHARED]** (also affects AI / Deep AI), or
**[AI ONLY]** (noticed in passing, not part of the software problem).

### F1. Non-TAG companies display the wrong grade — [SOFTWARE ONLY] — confirmed bug

- `computeGrade()` returns `grade: getGrade(tagScore1000, companyId)` (App.jsx:947).
  `getGrade` uses `GRADING_COMPANIES[company].grades`, and `masterweights.js:738` builds every
  company's `grades` list from `TAG_SCORE_THRESHOLDS`. So the legacy `grade` is a TAG-band
  lookup for every company.
- The engine already computes correct PSA/BGS/CGC/SGC grades in `companyGrades[company]`
  (each with its own rules and subgrades). The software screen never reads them.
- Same bug on save: `gradeValue = aiGradeForCompany?.grade ?? gradeResult.grade.grade`
  (App.jsx:3209). Same bug in the collection: `getGradeFromScore(rawScore, company)`
  ignores `company` (gradingScales.js:37).
- Consequences: BGS/CGC/SGC can never show 9.5 in software mode; PSA's "any defect caps at 9"
  rule is invisible; the BGS 0.5 rule is invisible.
- Why the AI paths are unaffected: the live screen reads `aiGrades?.[gradingCompany]?.grade`
  (App.jsx:4127), which is `companyGrades` from `assembleUnifiedOutput()`. In the collection,
  non-TAG AI company grades carry no `score` field, so the recalc is skipped and the stored
  grade is used.

### F2. Detectors run on the original photo, not the crop — [SOFTWARE ONLY] — confirmed

- `run()` passes `fI` / `bI` (originals) to `analyzeCardFull()` (App.jsx:3040, 3044).
  `frontCroppedImage` / `backCroppedImage` are never used by the detectors.
- **Edge measure mode** (persisted in localStorage as `slabsense_measureMode`):
  `PostCaptureCentering.jsx:324` returns `outer = {left:0, top:0, right:cropW, bottom:cropH}`
  in cropped-image space. `run()` overlays that on the original photo, so corners, edges and
  surface are measured on the top-left rectangle of the raw photo (mostly background).
- **Corner measure mode** (default): `run()` builds an axis-aligned box from `outerCorners`
  (tl.x, tr.x, tl.y, bl.y). Coordinates are in the same 1400px space as `loadImg`, so it is
  roughly right, but any rotation makes the box loose and pulls background into the corner
  and edge samples.
- Fix direction: run detectors on the cropped image with bounds = full image, or return
  original-space corners in both modes and crop before detecting.

### F3. Detector severity does not match engine severity — [SOFTWARE ONLY] — main "too harsh" source

Engine semantics (`GRADING_SCALE.md` section 3.2): minor = magnification only, x1.0; moderate =
arm's length, x2.5; severe = obvious, x5.0. Detectors assign 1/2/3 from pixel-whiteness thresholds:

| Detector | Flag threshold | sev 1 (minor) | sev 2 (moderate) | sev 3 (severe) | Code |
|---|---|---|---|---|---|
| Front corner, non-holo | wear > 15% | never (flag is already >= moderate) | > 15% | > 25% | App.jsx:534-548 |
| Front corner, holo | wear > 22% | never | > 22% | > 25% | same |
| Back corner | wear > 40% | 40-45% | > 45% | > 55% | same |
| Edge (any side, no holo/back allowance) | white > 8% OR roughness > 28 | 8-12% | > 12% | > 20% | App.jsx:611-620 |
| Surface, standard front | anomaly rate > 4% | > 4% | > 8% | > 15% | App.jsx:755-763 |

Engine outcome for typical detector outputs (run 2026-09-13 with a scratch harness against
`gradeCard`, perfect 50/50 centering, single side):

| Detector output | TAG score | TAG grade | Min subgrade |
|---|---|---|---|
| 1 minor front corner (cannot happen today) | 968 | 10 | corners 96 |
| 1 moderate front corner (lowest possible front corner hit) | 921 | 9 | corners 90 |
| 2 moderate front corners | 849 | 8 | corners 81.3 |
| 1 severe front corner (wear > 25%) | 843 | 8 | corners 80 |
| 4 minor front corners | 895 | 8.5 | corners 86.7 |
| 1 minor front edge (white > 8%) | 960 | 10 | edges 95 |
| 1 moderate front edge (white > 12%) | 899 | 8.5 | edges 87.5 |
| 1 severe front edge (white > 20%) | 799 | 7.5 | edges 75 |
| 4 minor back edges | 899 | 8.5 | backEdges 88.4 |
| 4 minor back edges + 1 minor back corner | 850 | 8.5 (DEFECT_COUNT_CAP) | n/a |
| Surface play wear minor front (anomaly > 4%) | 972 | 10 | surface 96.5 |
| Surface play wear severe front (anomaly > 15%) | 849 | 8 | surface 82.5 |
| Clean card, 56/44 front centering | 937 | 9 | frontCentering 92 |

TAG reference (`TAG_DIG_CALIBRATION_DATA.md`): Mint 9 typically has 1-2 light corner touches;
NM-MT 8 allows up to 2 front corner touches plus multiple on the back. The detectors push
those cards 1-2 grades lower than TAG would.

### F4. Light backgrounds read as whitening; edge detector lacks holo/back allowances — [SOFTWARE ONLY]

- Corner and edge detectors count neutral bright pixels (luminance > 215/220, r = g = b within
  tolerance) as wear and sample starting exactly at the boundary. Edge strip depth `eW` is 2.5%
  of the card dimension (about 35 px at 1400). A boundary 3-5 px loose on a white background
  gives 8-14% whiteRatio on all four edges, which is a minor or moderate EDGE WEAR each.
- The corner detector has holo, dark-border and back-side adjustments; the edge detector has
  none. Its `roughness > 28` test fires on foil texture regardless of whiteness.
- F2 (tight crop) only partially fixes this; the strip should start a few px inside the
  boundary and/or exclude pixels matching the background color.

### F5. The 5-defect cliff amplifies detector noise — [SOFTWARE ONLY in practice]

- `applyCaps` hard-caps at 85 (grade 8.5) when `defects.length >= 5`. Each side can emit up to
  9 dings (4 corners + 4 edges + 1 surface), so 18 per card.
- Five threshold blips on the back, each individually Gem Mint compatible, produce an 8.5.
- TAG's cliff was measured on real DINGS (grade-significant defects). Options: one EDGE ding
  per side with severity by edge count, or count only moderate+ dings toward the cliff for the
  software path.
- The cap itself lives in the engine and is shared with the AI paths, but the AI prompts are
  told to report only grade-significant defects, so it behaves as intended there.

### F6. Silent perfect-centering fallback — [SOFTWARE ONLY, error path only]

- `analyzeCentering()` falls back to symmetric 5%/7% borders, which is exactly 50/50 and a
  frontCentering of 99.5, when it finds nothing (App.jsx:399). `computeGrade` also defaults to
  50/50 when centering is missing (App.jsx:911).
- Only reachable when the manual tool errors out (there is no Skip button), so low impact
  today. Should still surface as a confidence penalty rather than a free 99.5.

### F7. The 507-card calibration is not wired in — [SOFTWARE ONLY] — housekeeping

- App.jsx:21-29 imports `TAG_CENTERING_THRESHOLDS`, `GRADE_CEILINGS`, `DEFECT_GRADE_CAPS`,
  `getMaxGradeByDefects`, `getCenteringGrade`, `ratioToDeviation` from `tag-calibration.js`.
  None are used anywhere in App.jsx. The engine uses the spec tables in `GRADING_SCALE.md`.
- The two disagree: `GRADE_CEILINGS[9.0].maxFrontDev = 21.9` vs the engine table (7.0% dev
  gives 92, a grade 9 ceiling). `GRADE_CEILINGS[9.0].maxCorner = 3` vs the engine (2 moderate
  corners gives an 8).
- HANDOFF.md says "Software grading now uses calibration data from 507 real TAG-graded
  reference cards". That is not true of the current engine. Decide on one source of truth.

### F8. Minor display and table issues — [SOFTWARE ONLY]

- Pristine shows as "Gem Mint": `TAG_SCORE_THRESHOLDS` has no separate 990+ band; the engine
  says `10P`. The software screen uses the legacy table.
- `GRADING_COMPANIES[*].grades` bands use `max: min + 49`; a score of 1000 matches nothing and
  falls to Poor. Unreachable today (centering tops out at 99.5, so 995) but fragile.

### F9. No detector tests; detectors cannot run outside the browser — [SOFTWARE ONLY]

- `gradingEngine.test.js`: 82 tests, all pass. Detectors (`findBounds`, `analyzeCentering`,
  `detectCornerDings`, `detectEdgeDings`, `detectSurfaceDings`): zero tests, live inside the
  4750-line App.jsx, depend on DOM canvas.
- Threshold tuning without a harness against the reference card images is guesswork.

### F10. Software path cannot see creases, dents, scratches, stains or tears — [SOFTWARE ONLY] — root cause of "too lenient"

- The three detectors emit exactly three ding types (App.jsx:413-770): `CORNER WEAR`,
  `EDGE WEAR`, `SURFACE / PLAY WEAR` (plus `CENTERING`, which the adapter drops). The internal
  `anomaly` / `mark` / `scratch` cell tags only feed the crop previews; they never become dings.
- `mapDingType()` (App.jsx:862) knows how to map CREASE, TEAR, STAIN, DENT, PIT, PRINT and
  SCRATCH strings to engine types, but nothing on the software side ever produces those strings.
  The mapping exists for AI dings only.
- Engine consequence: the worst surface penalty the software path can apply is
  `PLAY_WEAR` × severe = 3.5 × 5 = 17.5 points, so `frontSurface` bottoms out at 82.5 (grade 8).
  The `CREASE_CAP_6`, `TEAR_CAP_4`, `STAIN_CAP_5` and `EXTREME_CAP_5` caps in `applyCaps()` are
  unreachable. A creased card with clean corners grades 8 at the very worst, and 9-10 if the
  surface detector does not trip.
- Why the surface detector does not trip on a crease: it compares each cell's mean luminance
  against its four neighbours on a 24 × 32 grid over the inner 80% of the card. A crease is a
  thin line 2-5 px wide inside cells roughly 45 × 50 px, which moves the cell mean by only a
  few luminance units, far below the 15/25 diff thresholds. The variance test needs a cell to be
  2.8× the global variance, which artwork already defeats.
- How much this matters, from the 507-card TAG dataset (`scripts/Tag scraper/dig info/weights
  by tag/TAG Map/Defects`, filenames carry TAG's own ding type):

  | TAG ding type | Count (all 507 cards) | Software detector can emit it? |
  |---|---|---|
  | CORNER WEAR | 536 | yes |
  | EDGE WEAR | 216 | yes |
  | SURFACE / WRINKLE/CREASE (+ WRINKLES/CREASES) | 174 | **no** |
  | SURFACE / PLAY WEAR | 105 | yes (whole-side only) |
  | SURFACE / INK DEFECT | 56 | no |
  | SURFACE / DENT(S) | 55 | no |
  | SURFACE / SURFACE DEFECT | 37 | no |
  | SURFACE / SCRATCH(ES) | 39 | no |
  | PIT, STAIN, WATER, TEAR, PRINT LINE, ROLLER MARK, BEND, other | ~45 | no |

  Crease dings by TAG grade (half grades merged into the integer below them): grade 1: 76,
  grade 2: 46, grade 3: 21, grade 4: 17, grade 5: 11, grade 6: 5, grade 7: 2. Creases are the
  defining defect of everything below a 5, and the software path is blind to all of them.
- Interaction with F3: corner and edge hits are over-penalised (F3) while surface damage is
  under-detected (F10). On a typical worn card the two partly cancel, which is why the net
  impression is "lenient" rather than "harsh". Fixing F3 alone would make creased cards grade
  even higher relative to TAG.

### Noted in passing — [AI ONLY], not part of this problem

- The standard AI grade sends `fI` / `bI` (originals) to `claudeGradingAnalysis`
  (App.jsx:3411), while Deep AI sends originals plus crops. Not wrong, just inconsistent with
  the "crop is used across the board" intent.
- Both AI endpoints require manual centering and pass it straight to `gradeCard`; the
  centering score table (`CENTERING_SCORE_TABLE`) is therefore shared by all three paths.
  If F7 leads to changing that table, all three paths move together.

---

## 3. Recommended order of work (re-ranked after the owner's answers)

1. **F1** - software screen, save path and collection read `companyGrades[gradingCompany]`
   (or store `companyGrades` on save). Small change, removes a whole class of wrong grades
   for PSA/BGS/CGC/SGC.
2. **F2** - run the detectors on `frontCroppedImage` / `backCroppedImage` with bounds =
   full image (matches the intended design). Required because both measure modes are in
   use and edge mode currently sends the detectors to the wrong rectangle. Also removes
   most of F4.
3. **F9** - extract detectors to `src/lib/detectors.js` and build a node harness that runs
   them on the 507-card TAG set (see section 6) and scores emitted dings against TAG's ding
   list per card. This is the only way to know whether a detector change helped.
4. **F10** - add real surface-defect detection: at minimum crease / wrinkle (line detection,
   e.g. directional gradient or Hough-style accumulation on the luminance channel), then dent
   (local shading blob) and scratch (thin high-contrast line). Emit CREASE / DENT / SCRATCH
   ding strings so the existing `mapDingType()` and engine caps take over. Creases alone are
   174 of roughly 1,260 dings in the dataset and define every grade below 5.
5. **F3 / F4 / F5** - once F10 exists, recalibrate corner and edge severity bands (give front
   corners a real "minor" band), start edge strips a few px inside the boundary, decide how
   edge dings count toward the 5-defect cliff. Do not do this before F10; it would make
   creased cards grade higher.
6. **F7** - wire `GRADE_CEILINGS` into the engine or delete the imports; reconcile the 9.0
   centering thresholds; fix HANDOFF wording.
7. **F6 / F8** - confidence penalty on centering fallback; Pristine label; band table `max`.

## 4. Open questions

Answered 2026-09-13: grades are too lenient; both corner and edge modes are used; the
reference case is a clearly creased card that graded 9.

Still open:
- Should the software path keep the 5-defect cliff on raw detector dings, or only on
  moderate+ dings?
- For F10, is a "crease present, severity unknown" ding acceptable as a first step (engine
  would cap at 60 for moderate+), or does the detector need to grade crease severity too?

## 6. Ground-truth data available for a detector harness

| Location | Contents | Notes |
|---|---|---|
| `scripts/Tag scraper/dig info/weights by tag/TAG Map/Front`, `/Back` | 507 TAG-lit card photos, named `CERT_GRADE_LABEL_front.jpg` | Grade distribution: 1: 31, 2: 31, 3: 25, 4: 37, 5: 39, 6-6.5: 80, 7-7.5: 78, 8-8.5: 83, 9: 44, 10: 59 |
| `.../TAG Map/Defects` | 1,643 per-ding crops named `CERT_GRADE_defect_N_TYPE.jpg` | TAG's own ding type in the filename; this is the label set for precision/recall |
| `.../TAG Map/Surface`, `/Annotated` | 1,014 surface crops, 875 annotated overlays | |
| `.../TAG Map/results1.json` | Full DIG records (card, grade, score, centering px, dings with x/y) for 92 cards | File has trailing extra JSON after line 9686; parse the first document only |
| `.../TAG Map/tag-calibration-tool.html` | Coordinate calibration tool for mapping TAG ding x/y onto user photos | Related to `Mapping Defects/COORDINATE_MAPPING.md` |
| `scripts/Tag scraper/dig info/master.md` | Per-card surface scores, centering, ding counts by category | |
| `scripts/Tag scraper/validation_test` | 3 cards with phone-style front/back photos: E6899567 (10 GEM MINT), H9479369 (1 POOR), N8241348 (1 POOR) | Closest thing to real user input; the two POOR cards are the crease test |
| `scripts/Tag scraper/Slabs` | 62 slab photos (31 cards) | In-slab, less useful for detectors |
| `scripts/analyze_tag_calibration.cjs` | Pulls `graded_references` from Supabase and derives the calibration tables | Source of `GRADE_CEILINGS` (F7) |

Caveat: the TAG photos are studio-lit and flat. The detectors will behave differently on
phone photos; `validation_test` is the only phone-style set. Worth growing that set.

## 7. Files touched by this review (read only)

`src/App.jsx`, `src/lib/gradingEngine.js`, `src/lib/gradingEngine.test.js`,
`src/lib/masterweights.js`, `src/lib/tag-calibration.js`, `src/utils/gradingScales.js`,
`src/lib/image-utils.js`, `src/components/PostCaptureCentering/PostCaptureCentering.jsx`,
`src/components/Grading/GradeResultDisplay.jsx`, `src/components/Collection/CollectionView.jsx`,
`src/services/scans.js`, `api/ai-analyze-unified.js`, `api/deep-analyze-v2.js`,
`api/_lib/detectionPrompt.js`, `docs/GRADING_SCALE.md`,
`docs/grading-research/TAG_DIG_CALIBRATION_DATA.md`, `HANDOFF.md`, `CROSS_REFERENCE.md`,
`CODEBASE_AUDIT.md`, `CODEBASE_DOCUMENTATION.md`.
