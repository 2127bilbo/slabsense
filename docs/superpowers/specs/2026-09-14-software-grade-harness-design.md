# Software Grade Harness + Fixes F1/F2 — Design

**Date:** 2026-09-14
**Status:** approved in chat, spec for implementation planning
**Background:** `docs/SOFTWARE_GRADE_REVIEW_2026-09-13.md` (findings F1–F10)

## 1. Goal

Make the client-side Software Grade measurable against TAG ground truth, record a baseline,
then land the two quick fixes (F1 display bug, F2 detectors on the cropped image) and show the
delta. Crease detection (F10) is explicitly out of scope for this round; it gets its own round
with this harness as the yardstick.

Success for this round:

- A repeatable command produces per-card and summary accuracy numbers for the software path
  against 507 TAG-graded cards.
- A baseline results file is committed before any behavior change.
- F1 and F2 are implemented, verified in the browser, and the harness shows their effect.

## 2. Non-goals

- No detector threshold changes (F3, F4, F5).
- No new defect types (F10).
- No changes to `gradingEngine.js`.
- No phone-photo dataset; the reference photos are studio shots and the harness measures
  detectors under ideal conditions only.

## 3. Ground truth

Source tables (already built by `scripts/tag-dataset`, read via its venv):

| Table | Used for |
|---|---|
| `data/dataset/manifest.parquet` | grade_num, grade_label, is_pristine, rollup_centering / corners / edges / surface (TAG 1000-pt), surface_front / surface_back, dte_* (distance-to-edge px, front and back), image_w / image_h |
| `data/dataset/dings.parquet` | per-ding side, type_name, engine_type, location, normalized x/y/w/h |
| `data/dataset/corners.parquet` | per-corner TAG score_angle / score_fill / score_fray |
| `data/dataset/edges.parquet` | per-edge TAG score_fill / score_fray |

All 507 certs that have local photos under
`scripts/Tag scraper/dig info/weights by tag/TAG Map/Front|Back` are present in the manifest
with rollup subgrades. The harness covers exactly that set.

Centering ratios are derived from the dte pixels: `lrRatio = left / (left + right) * 100`,
`tbRatio = top / (top + bottom) * 100`, per side. These are fed to the engine as the "manual
tool" values so detector accuracy is isolated from centering-tool accuracy.

Dings with `engine_type == 'SKIP'` are excluded from scoring. `CENTERING` dings are excluded
(the adapter drops them too).

### 3.1 Export script

`scripts/harness/export_ground_truth.py`, run once with the tag-dataset venv:

```
scripts/tag-dataset/.venv/Scripts/python scripts/harness/export_ground_truth.py
```

Writes `scripts/harness/ground-truth.json` (committed, ~1 MB):

```json
{
  "generated": "2026-09-14T...",
  "certs": {
    "C1287305": {
      "grade": 9, "label": "9 MINT", "pristine": false,
      "tag": { "centering": 970, "corners": 916, "edges": 999, "surface": 1000,
               "surfaceFront": 1000, "surfaceBack": 902 },
      "centering": { "front": { "lrRatio": 52.9, "tbRatio": 51.9 },
                     "back":  { "lrRatio": 47.9, "tbRatio": 49.8 } },
      "dings": [ { "side": "FRONT", "type": "CORNER WEAR", "engineType": "CORNER",
                   "location": "BOTTOM LEFT", "x": 0.0099, "y": 0.95 } ],
      "corners": { "F": { "TL": { "angle": 998, "fill": 999, "fray": 1000 }, ... }, "B": {...} },
      "edges":   { "F": { "T": { "fill": 998, "fray": 994 }, ... }, "B": {...} },
      "images": { "front": "C1287305_9_MINT_front.jpg", "back": "C1287305_9_MINT_back.jpg" }
    }
  }
}
```

Side codes in the parquet (`F`/`B`) map to `FRONT`/`BACK`.

## 4. Code extraction (no behavior change)

### 4.1 `src/lib/detectors.js`

Moved verbatim from App.jsx: `PX`, `findBounds`, `edgeScanFallback`, `scanBorderFromEdge`,
`analyzeCentering`, `checkCenteringDings`, `detectCornerDings`, `detectEdgeDings`,
`detectSurfaceDings`, `clusterDefects`. All are already pure functions over
`(pixelData, w, h, ...)`. `LUM` continues to come from `image-utils.js`.

New export:

```js
export function analyzePixels({ data, w, h }, side, overrideBounds = null, overrideCentering = null)
```

Returns the same object `analyzeCardFull` returns today minus `scaledImgUrl`
(`centering, centerDings, corners, edges, surface, allDings, bounds, imgW, imgH`).
`analyzeCardFull` in App.jsx becomes: `loadImg` → `analyzePixels` → add `scaledImgUrl`.

### 4.2 `src/lib/softwareGrade.js`

Moved verbatim from App.jsx: `mapDingSeverity`, `mapDingType`, `dingToEngineDefect`,
`computeGrade`. Imports `gradeCard`, `scoreToGrade`, `ENGINE_VERSION` from the engine,
`GRADING_COMPANIES`, `DEFAULT_GRADING_COMPANY` from masterweights, `calculateSoftwareConfidence`
from masterweights. `getGrade` (the legacy band lookup) moves here too because `computeGrade`
uses it; App.jsx keeps importing it from here for its remaining UI uses.

App.jsx imports from both modules. Nothing else in the app changes in this step. The engine
test suite and a manual browser upload confirm parity.

## 5. Harness

### 5.1 Layout

```
scripts/harness/
  export_ground_truth.py   # python, tag-dataset venv
  ground-truth.json        # committed output of the above
  run.mjs                  # node, no deps beyond devDependencies (canvas)
  compare.mjs              # node, prints delta between two results files
  results/                 # committed JSON + md summaries, one per run
    2026-09-14-baseline.json
    2026-09-14-baseline.md
```

Package scripts: `"harness": "node scripts/harness/run.mjs"`,
`"harness:compare": "node scripts/harness/compare.mjs"`.

### 5.2 Image loading

`run.mjs` loads each JPEG with node-canvas `loadImage`, draws it to a canvas scaled so the
longest side is 1400 px (same rule as `image-utils.js loadImg`), and takes `getImageData`.
The resized RGBA buffers are cached as PNG in the session scratch directory (or
`--cache <dir>`), keyed by filename, so reruns skip decoding the 5 MB originals.

Bounds: `findBounds` runs on the image. The studio photos have a solid orange margin around a
card that fills ~96% of the frame, so `findBounds` returns a tight card box; this stands in for
the user's crop. The harness records the bounds it used per card so a bad bounds detection can
be spotted (bounds smaller than 85% of the frame on either axis are flagged in the summary).

Centering: `overrideCentering` = the ground-truth ratios for that side.

### 5.3 What is computed per card

```js
const front = analyzePixels(frontPixels, 'front', null, gt.centering.front);
const back  = analyzePixels(backPixels,  'back',  null, gt.centering.back);
const grade = computeGrade(front.allDings, back.allDings, gt.centering.front, gt.centering.back, 'tag', null);
```

Recorded per card: `cert`, TAG grade, software grade (`grade.overall.grade`), TAG score
(`grade.rawScore`), the 8 software subgrades, the software dings (side, type, severity),
the ground-truth dings, bounds used, and the caps applied.

### 5.4 Metrics

Grade:
- mean absolute error (software grade − TAG grade, in grade points)
- signed mean error, defined as software grade minus TAG grade, so positive means the
  software is too lenient; the output header states this convention
- % exact, % within 0.5, % within 1.0
- confusion table TAG grade × software grade (rows TAG 1..10, columns software 1..10)
- the same numbers split by TAG grade bucket: 9–10, 7–8.5, 5–6.5, 1–4.5

Subgrades (software 0–100 ×10 vs TAG rollup 1000-pt):
- MAE and signed error for corners, edges, surface, centering. Software front/back pairs are
  merged with the engine's `mergeSubgrades` 0.65/0.35 rule for comparison against TAG's single
  rollup; front and back surface are also compared individually against `surfaceFront` /
  `surfaceBack`.

Dings (matching on side + engine type; location ignored this round):
- per type per side: TAG count, software count, matched count, precision, recall
- software types are mapped with the same `mapDingType` the adapter uses, so `SURFACE / PLAY
  WEAR` → `PLAY_WEAR`, etc.
- a whole-card line: cards where software emitted ≥1 ding vs cards where TAG has ≥1 ding

Bounds sanity: count of cards flagged for small bounds.

### 5.5 Output

`results/<date>-<label>.json`: `{ meta: { date, label, gitCommit, engineVersion, cards }, summary: {...}, cards: [...] }`.

`results/<date>-<label>.md`: the summary tables, human readable.

`compare.mjs a.json b.json`: prints every summary number side by side with the delta, and
lists cards whose software grade moved by ≥1.0 between runs.

Label comes from `--label <name>`; default is `run`.

### 5.6 Runtime

507 cards × 2 sides. First run decodes 1,014 JPEGs (~4–6 minutes). Cached reruns are
expected under one minute. `--limit N` and `--cert X` exist for quick iteration.

## 6. Fix F1 — company grade display

Today `computeGrade` returns `grade: getGrade(tagScore1000, companyId)`, a TAG-band lookup
regardless of company, and three consumers read it.

Change in `softwareGrade.js`: `grade` becomes a company-aware object built from
`companyGrades[companyId]`:

```js
const cg = companyGrades[companyId] || companyGrades.tag;
const grade = {
  grade: cg.grade,
  label: cg.label,
  displayGrade: cg.displayGrade,
  ...(GRADE_COLORS[cg.grade] || GRADE_COLORS[1]),   // color/bg the UI reads today
};
```

For TAG, `cg.grade` equals the engine overall grade, and the Pristine case (score ≥ 990)
uses the engine label `Pristine` with the 10 color. The legacy `min`/`max` band fields are
dropped from this object; the implementation greps App.jsx for `.grade.min` / `.grade.max`
and updates any consumer found. `getGrade` itself stays for `ScoreRing` and other legacy
TAG-score uses.

Consumers:
- Software screen (App.jsx ~4108): unchanged code, now correct by construction.
- Save path (`buildSaveData`, App.jsx ~3209): `gradeValue` / `gradeLabel` already come from
  `gradeResult.grade`; additionally store `company_grades: gradeResult.companyGrades` in the
  scan record so the collection can show any company without recomputing. Requires a
  `company_grades jsonb` column on `scans` (migration under `supabase/`).
- Collection (`CollectionView.getDisplayGrade`): for the software branch, read
  `scan.company_grades?.[company]` when present; fall back to the existing
  `getGradeFromScore(rawScore, company)` for older rows, but only when `company === 'tag'`;
  for other companies on old rows show the stored `grade_value` with the stored label.

`getGradeFromScore` itself is left alone (it is also used by AI branches, which only pass TAG
scores in practice).

## 7. Fix F2 — detectors run on the cropped image

Today `run()` and `applyManualCorrection()` call `analyzeCardFull(fI | bI, side, overrideBounds,
overrideCentering)` on the original photo with bounds derived from the centering tool, which
are in crop space for edge mode and are an axis-aligned box for corner mode.

Change: when a cropped image exists for that side, analyze it instead with full-image bounds.

```js
const src    = side === 'front' ? (frontCroppedImage || fI) : (backCroppedImage || bI);
const bounds = croppedForSide ? null : overrideBoundsAsToday;   // null → findBounds on the crop
```

With `overrideBounds = null`, `analyzePixels` runs `findBounds` on the crop. On a tight user
crop the card fills the frame; `findBounds` returns either the full frame or a box a few px
inside it, both acceptable. This keeps one code path for corner and edge modes and matches the
harness (which also lets `findBounds` run on a card-filling image).

`overrideCentering` stays exactly as today (the manual ratios). `scaledImgUrl` from the
analysis is now the crop; `fR.scaledImgUrl` consumers (vision maps, damage report) are checked
and pointed at the same image, which is what they should show anyway.

When no cropped image exists for a side (only possible on the tool's error path), behavior is
unchanged.

The `applyManualCorrection` path (post-analysis "Apply Correction" button) already produces a
new crop via `cropToOuterBounds`; it is changed to analyze that crop with null bounds too, after
the crop is generated (today the crop is generated after the analysis; the order flips).

## 8. Testing and verification

- `node src/lib/gradingEngine.test.js` → 82 pass, before and after.
- New `src/lib/detectors.test.js`: loads one committed 1400-px fixture (a downscaled copy of a
  reference card, ~300 KB, under `src/lib/__fixtures__/`) with node-canvas and asserts
  `analyzePixels` returns bounds within the expected range and the same ding list as a
  recorded snapshot. Guards the extraction and any future refactor.
- Harness baseline run committed before F1/F2. Harness rerun committed after, with the
  compare output pasted into the run's `.md`.
- Browser check after F1: select PSA and BGS on a graded card, confirm the number matches
  `companyGrades` in the console; confirm a BGS 9.5 is reachable.
- Browser check after F2: upload a card in corner mode and in edge mode, confirm the software
  ding list is the same for both and that the surface vision maps show the crop.

Note: the harness is expected to show little or no change from F1/F2 by itself. F1 does not
touch the TAG grade the harness scores, and the harness already runs on card-filling images.
The value of this round is the baseline plus the two production bugs; the delta will come
in the F10 round.

## 9. Files

New: `src/lib/detectors.js`, `src/lib/softwareGrade.js`, `src/lib/detectors.test.js`,
`src/lib/__fixtures__/<cert>_front_1400.png`, `scripts/harness/export_ground_truth.py`,
`scripts/harness/ground-truth.json`, `scripts/harness/run.mjs`, `scripts/harness/compare.mjs`,
`scripts/harness/results/*`, `supabase/migrations/<ts>_scans_company_grades.sql`.

Modified: `src/App.jsx`, `src/services/scans.js`, `src/components/Collection/CollectionView.jsx`,
`package.json`, `docs/SOFTWARE_GRADE_REVIEW_2026-09-13.md` (status notes on F1/F2 + correction
that `validation_test` photos are TAG downloads, not phone photos).

## 10. Open decisions (settled)

- Ground truth lives in a committed JSON, not read from parquet at harness time, so node has
  no Python dependency. Regenerate with the export script when the dataset changes.
- Ding matching ignores location this round. Location-aware matching (corner name, edge name,
  surface x/y) is added when F10 lands and location starts to matter.
- Harness centering comes from TAG, not from `analyzeCentering`, on purpose.
