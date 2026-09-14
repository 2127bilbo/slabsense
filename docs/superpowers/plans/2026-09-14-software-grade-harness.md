# Software Grade Harness + F1/F2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client-side Software Grade measurable against 507 TAG-graded cards, record a baseline, then fix the company-grade display bug (F1) and run the detectors on the user's cropped image (F2).

**Architecture:** The detector functions and the `computeGrade` adapter move out of `src/App.jsx` into two pure modules so both the app and a node harness call identical code. A Python export turns the tag-dataset parquet tables into a committed `ground-truth.json`; a node script loads the 507 local reference photos with node-canvas, runs the real detectors and adapter, and scores grade, subgrade and ding accuracy. F1 and F2 are then applied in the app and the harness is re-run.

**Tech Stack:** Node 24 ESM (plain `node` scripts, no test framework, same style as `src/lib/gradingEngine.test.js`), `canvas` 3.x (already a devDependency), Python 3.14 venv at `scripts/tag-dataset/.venv` with pyarrow/pandas, React 18 / Vite app, Supabase SQL migrations.

**Spec:** `docs/superpowers/specs/2026-09-14-software-grade-harness-design.md`

## Global Constraints

- No changes to `src/lib/gradingEngine.js`; `node src/lib/gradingEngine.test.js` must print `82 passed, 0 failed` after every task.
- No detector threshold changes and no new defect types in this round.
- Moved code is moved verbatim (byte-identical bodies) so the extraction cannot change grades.
- Images are resized so the longest side is 1400 px, exactly like `loadImg` in `src/lib/image-utils.js`.
- Harness ground truth: only certs with local photos under `scripts/Tag scraper/dig info/weights by tag/TAG Map/Front` and `/Back`; dings with `engine_type` `SKIP` or `CENTERING` excluded.
- Sign convention everywhere: `software − TAG`; positive means the software is too lenient.
- Windows paths: the project root contains a space (`G:\Grading App\SlabSense`). Quote every path. In node, build paths with `path.join` / `fileURLToPath`, never string concatenation of `import.meta.url`.
- Commit messages end with the attribution lines given in the session reminder.
- Do not touch the user's uncommitted changes under `scripts/tag-dataset/tagdataset/` or `scripts/tag-dataset/tests/`; never `git add -A`.

Line numbers quoted below are from commit `050a162`. Task 1 deletes lines, so every later task locates code by `grep -n` first.

---

### Task 1: Extract detectors into `src/lib/detectors.js`

**Files:**
- Create: `src/lib/detectors.js`
- Create: `src/lib/__fixtures__/C1287305_front_1400.jpg`
- Create: `src/lib/detectors.test.js`
- Modify: `src/App.jsx` (remove lines 63–66 and 171–784; replace `analyzeCardFull` body)

**Interfaces:**
- Consumes: `LUM` from `src/lib/image-utils.js`.
- Produces: `export { PX, findBounds, edgeScanFallback, scanBorderFromEdge, analyzeCentering, checkCenteringDings, detectCornerDings, detectEdgeDings, detectSurfaceDings, clusterDefects, analyzePixels }`.
  `analyzePixels({ data, w, h }, side, overrideBounds = null, overrideCentering = null)` → `{ centering, centerDings, corners, edges, surface, allDings, bounds, imgW, imgH }` where `data` is a `Uint8ClampedArray` of RGBA pixels (i.e. `ImageData.data`), `side` is `'front' | 'back'`.

- [ ] **Step 1: Create the fixture image**

```bash
cd "G:/Grading App/SlabSense" && mkdir -p src/lib/__fixtures__ && node -e "
import('canvas').then(async ({createCanvas, loadImage}) => {
  const fs = await import('node:fs');
  const img = await loadImage('scripts/Tag scraper/dig info/weights by tag/TAG Map/Front/C1287305_9_MINT_front.jpg');
  const s = 1400/Math.max(img.width,img.height); const w=Math.round(img.width*s), h=Math.round(img.height*s);
  const c=createCanvas(w,h); c.getContext('2d').drawImage(img,0,0,w,h);
  fs.writeFileSync('src/lib/__fixtures__/C1287305_front_1400.jpg', c.toBuffer('image/jpeg',{quality:0.85}));
  console.log('fixture', w, h);
})"
ls -la src/lib/__fixtures__
```
Expected: `fixture 1012 1400`, file roughly 200–400 KB.

- [ ] **Step 2: Write the failing test**

Create `src/lib/detectors.test.js`:

```js
/**
 * Detector extraction guard. Runs the real detectors on a committed 1400-px
 * reference card and checks bounds + ding output against a recorded snapshot.
 * Run: node src/lib/detectors.test.js
 */
import { createCanvas, loadImage } from 'canvas';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { analyzePixels } from './detectors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '__fixtures__', 'C1287305_front_1400.jpg');

// Recorded on first green run (Step 5). Update ONLY when a detector change is intended.
const SNAPSHOT_DINGS = null; // replaced in Step 5

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};

const img = await loadImage(FIXTURE);
const c = createCanvas(img.width, img.height);
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0);
const { data, width: w, height: h } = ctx.getImageData(0, 0, img.width, img.height);

console.log('— analyzePixels on C1287305 front');
const r = analyzePixels({ data, w, h }, 'front');

check('returns bounds', !!r.bounds && r.bounds.right > r.bounds.left && r.bounds.bottom > r.bounds.top);
check('card fills ≥85% of frame width', r.bounds.cardW >= w * 0.85, `cardW=${r.bounds.cardW} w=${w}`);
check('card fills ≥85% of frame height', r.bounds.cardH >= h * 0.85, `cardH=${r.bounds.cardH} h=${h}`);
check('centering ratios present', typeof r.centering.lrRatio === 'number' && typeof r.centering.tbRatio === 'number');
check('allDings is an array', Array.isArray(r.allDings));
check('corners.details has 4 entries', r.corners.details.length === 4);
check('edges.details has 4 entries', r.edges.details.length === 4);
check('imgW/imgH echo input', r.imgW === w && r.imgH === h);

const summary = r.allDings.map(d => `${d.side}|${d.type}|${d.location}|${d.severity}`);
if (SNAPSHOT_DINGS === null) {
  console.log('  (no snapshot yet) dings =', JSON.stringify(summary));
} else {
  check('dings match snapshot', JSON.stringify(summary) === JSON.stringify(SNAPSHOT_DINGS),
    `\n    got  ${JSON.stringify(summary)}\n    want ${JSON.stringify(SNAPSHOT_DINGS)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd "G:/Grading App/SlabSense" && node src/lib/detectors.test.js`
Expected: fails with `Cannot find module '.../src/lib/detectors.js'`.

- [ ] **Step 4: Cut the detector code out of App.jsx into detectors.js**

Confirm the anchors first (numbers as of 050a162):

```bash
cd "G:/Grading App/SlabSense" && grep -n "^const PX=\|^function findBounds\|^function clusterDefects\|^function saveTrainingBounds\|IMAGE UTILITIES\|CARD DETECTION v2.6" src/App.jsx
```
Expected: `63: IMAGE UTILITIES` header line ±1, `66:const PX=`, `172: CARD DETECTION v2.6` ±1, `176:function findBounds`, `769:function clusterDefects`, `791:function saveTrainingBounds`.
The detector block is from the `/* ═══ CARD DETECTION` comment (line 171) through the closing `}` of `clusterDefects` (line 784, the line before the blank line preceding `/* ═══ LOCAL TRAINING DATA`). Verify with `sed -n '784p;785p' src/App.jsx` → `}` then blank.

Build the module:

```bash
cd "G:/Grading App/SlabSense" && {
cat <<'EOF'
/**
 * ============================================================================
 * SLABSENSE SOFTWARE DETECTORS — detectors.js
 * ============================================================================
 * Pure pixel-level detectors for the client-side Software Grade path.
 * Moved verbatim from src/App.jsx on 2026-09-14 (see
 * docs/superpowers/specs/2026-09-14-software-grade-harness-design.md).
 *
 * Every function takes raw RGBA pixel data (ImageData.data), width, height.
 * No DOM, no fetch, no React. Runs in the browser and under node (scripts/harness).
 *
 * RULES: any threshold change here changes production grades. Run
 *   node src/lib/detectors.test.js   and   npm run harness
 * and record the delta before committing.
 * ============================================================================
 */
import { LUM } from './image-utils.js';

export const PX=(d,w,x,y)=>{const i=(y*w+x)*4;return[d[i],d[i+1],d[i+2]];};

EOF
sed -n '171,784p' src/App.jsx
cat <<'EOF'

/* ═══════════════════════════════════════════
   PIXEL-LEVEL PIPELINE (what analyzeCardFull does after loadImg)
   ═══════════════════════════════════════════ */
export function analyzePixels({ data, w, h }, side, overrideBounds = null, overrideCentering = null) {
  const d = data;
  const bounds = overrideBounds
    ? { ...overrideBounds, cardW: overrideBounds.right - overrideBounds.left, cardH: overrideBounds.bottom - overrideBounds.top }
    : findBounds(d, w, h);
  const centering = overrideCentering || analyzeCentering(d, w, h, bounds);
  const centerDings = checkCenteringDings(centering, side);
  const corners = detectCornerDings(d, w, h, bounds, side);
  const edges = detectEdgeDings(d, w, h, bounds, side);
  const surface = detectSurfaceDings(d, w, h, bounds, side);
  const allDings = [...centerDings, ...corners.dings, ...edges.dings, ...surface.dings];
  return { centering, centerDings, corners, edges, surface, allDings, bounds, imgW: w, imgH: h };
}
EOF
} > src/lib/detectors.js
```

Now add `export` to the moved function declarations (they were module-private in App.jsx):

```bash
cd "G:/Grading App/SlabSense" && sed -i -E 's/^function (findBounds|edgeScanFallback|scanBorderFromEdge|analyzeCentering|checkCenteringDings|detectCornerDings|detectEdgeDings|detectSurfaceDings|clusterDefects)\(/export function \1(/' src/lib/detectors.js && grep -c "^export function" src/lib/detectors.js
```
Expected: `10` (9 moved + analyzePixels).

Delete from App.jsx, bottom-up so earlier numbers stay valid:

```bash
cd "G:/Grading App/SlabSense" && sed -i '171,784d' src/App.jsx && sed -i '63,66d' src/App.jsx && grep -n "^function findBounds\|^const PX=\|^function clusterDefects" src/App.jsx; echo "exit=$?"
```
Expected: no matches (`exit=1`).

Replace `analyzeCardFull` in App.jsx. Find it:

```bash
cd "G:/Grading App/SlabSense" && grep -n "^async function analyzeCardFull" src/App.jsx
```
Its body currently spans from that line to the closing `}` before the blank line and `/* ═══ UI COMPONENTS` header. Replace the whole function with:

```js
async function analyzeCardFull(src, side, overrideBounds = null, overrideCentering = null) {
  const { w, h, data, canvas } = await loadImg(src);
  const scaledImgUrl = canvas.toDataURL('image/jpeg', 0.92);
  const result = analyzePixels({ data: data.data, w, h }, side, overrideBounds, overrideCentering);
  return { ...result, scaledImgUrl };
}
```

Add the import near the other `./lib` imports at the top of App.jsx:

```js
import { analyzePixels } from "./lib/detectors.js";
```

- [ ] **Step 5: Run the test, then record the snapshot**

Run: `cd "G:/Grading App/SlabSense" && node src/lib/detectors.test.js`
Expected: 8 passed, and a line `(no snapshot yet) dings = [...]`.
Copy the printed JSON array into `SNAPSHOT_DINGS` in `detectors.test.js` (replace `null`). Re-run; expected `9 passed, 0 failed`.

- [ ] **Step 6: Verify the app still builds and the engine tests pass**

```bash
cd "G:/Grading App/SlabSense" && node src/lib/gradingEngine.test.js | tail -2 && npm run build 2>&1 | tail -5
```
Expected: `82 passed, 0 failed` and a successful Vite build with no `is not defined` errors. If the build reports an unresolved name (e.g. `PX`, `clusterDefects`) used elsewhere in App.jsx, add it to the `detectors.js` import line rather than re-declaring it.

- [ ] **Step 7: Commit**

```bash
cd "G:/Grading App/SlabSense" && git add src/lib/detectors.js src/lib/detectors.test.js src/lib/__fixtures__/C1287305_front_1400.jpg src/App.jsx && git commit -m "refactor: move software detectors out of App.jsx into src/lib/detectors.js

Verbatim move of findBounds/analyzeCentering/detect*Dings plus a new
analyzePixels() entry point so the node harness can run production code.
Adds a fixture-based snapshot test.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0178aXs7Ezimfg5onrPwdSTd"
```

---

### Task 2: Extract the grade adapter into `src/lib/softwareGrade.js`

**Files:**
- Create: `src/lib/softwareGrade.js`
- Modify: `src/App.jsx` (remove the `getGradesForCompany`/`GRADES`/`getGrade` block and the `UNIFIED SCORING` block; add imports)

**Interfaces:**
- Consumes: `gradeCard, scoreToGrade, ENGINE_VERSION` from `./gradingEngine.js`; `GRADING_COMPANIES, DEFAULT_GRADING_COMPANY, calculateSoftwareConfidence` from `./masterweights.js`.
- Produces: `export { getGradesForCompany, getGrade, mapDingSeverity, mapDingType, dingToEngineDefect, computeGrade }` with the exact signatures they have in App.jsx today:
  `computeGrade(frontDings, backDings, frontCenter, backCenter, companyId = DEFAULT_GRADING_COMPANY, imageQuality = null)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/softwareGrade.test.js`:

```js
/**
 * Adapter guard: legacy dings → engine defects → computeGrade output shape.
 * Run: node src/lib/softwareGrade.test.js
 */
import { computeGrade, dingToEngineDefect, mapDingType, mapDingSeverity } from './softwareGrade.js';

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('— mapping');
check('CORNER WEAR → CORNER', mapDingType('CORNER WEAR') === 'CORNER');
check('EDGE WEAR → EDGE', mapDingType('EDGE WEAR') === 'EDGE');
check('SURFACE / PLAY WEAR → PLAY_WEAR', mapDingType('SURFACE / PLAY WEAR') === 'PLAY_WEAR');
check('CENTERING → null', mapDingType('CENTERING') === null);
check('severity 1/2/3 → minor/moderate/severe', mapDingSeverity(1) === 'minor' && mapDingSeverity(2) === 'moderate' && mapDingSeverity(3) === 'severe');
check('centering ding dropped', dingToEngineDefect({ type: 'CENTERING', side: 'FRONT', severity: 3 }) === null);

console.log('— computeGrade');
const clean = computeGrade([], [], { lrRatio: 50, tbRatio: 50 }, { lrRatio: 50, tbRatio: 50 }, 'tag', null);
check('clean card TAG score 995', clean.rawScore === 995, `got ${clean.rawScore}`);
check('clean card overall grade 10', clean.overall.grade === 10);
check('companyGrades has all five', ['tag','psa','bgs','cgc','sgc'].every(k => clean.companyGrades[k]));
check('8 subgrade keys', Object.keys(clean.subgrades).length === 8);
check('gradePath software', clean.gradePath === 'software');

const worn = computeGrade(
  [{ side: 'FRONT', type: 'CORNER WEAR', location: 'FRONT / TOP LEFT', severity: 2 }],
  [], { lrRatio: 50, tbRatio: 50 }, { lrRatio: 50, tbRatio: 50 }, 'tag', null);
check('one moderate front corner → TAG 921 / grade 9', worn.rawScore === 921 && worn.overall.grade === 9, `got ${worn.rawScore}`);
check('defect counted', worn.defectCounts.total === 1 && worn.defectCounts.corner === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "G:/Grading App/SlabSense" && node src/lib/softwareGrade.test.js`
Expected: `Cannot find module '.../softwareGrade.js'`.

- [ ] **Step 3: Cut the adapter code out of App.jsx**

Locate the two blocks (numbers will have shifted after Task 1):

```bash
cd "G:/Grading App/SlabSense" && grep -n "^// Legacy GRADES array\|^const getGradesForCompany\|^const GRADES = \|^const getGrade = \|^const mono=\|UNIFIED SCORING\|^function mapDingSeverity\|^function computeGrade\|SURFACE VISION MAPS" src/App.jsx
```
Block A = from `// Legacy GRADES array` through the closing `};` of `getGrade` (the line before `const mono=`).
Block B = from the `/* ═══` line two lines above `UNIFIED SCORING` through the closing `}` of `computeGrade` (the line before the blank line preceding `/* ═══ SURFACE VISION MAPS`). Note the exact start/end numbers as `A1,A2` and `B1,B2`.

Build the module (substitute the numbers):

```bash
cd "G:/Grading App/SlabSense" && {
cat <<'EOF'
/**
 * ============================================================================
 * SLABSENSE SOFTWARE GRADE ADAPTER — softwareGrade.js
 * ============================================================================
 * Turns legacy detector dings into engine defects and runs gradingEngine.
 * Moved verbatim from src/App.jsx on 2026-09-14 (see
 * docs/superpowers/specs/2026-09-14-software-grade-harness-design.md).
 * Pure: no DOM, no React. Shared by the app and scripts/harness.
 * ============================================================================
 */
import { gradeCard, scoreToGrade, ENGINE_VERSION } from './gradingEngine.js';
import { GRADING_COMPANIES, DEFAULT_GRADING_COMPANY, calculateSoftwareConfidence } from './masterweights.js';

EOF
sed -n "A1,A2p" src/App.jsx
echo
sed -n "B1,B2p" src/App.jsx
} > src/lib/softwareGrade.js
sed -i -E 's/^const (getGradesForCompany|getGrade) = /export const \1 = /; s/^function (mapDingSeverity|mapDingType|dingToEngineDefect|computeGrade)\(/export function \1(/' src/lib/softwareGrade.js
sed -i '/^const GRADES = getGradesForCompany/d' src/lib/softwareGrade.js
grep -c "^export" src/lib/softwareGrade.js
```
Expected: `6`.

Delete from App.jsx bottom-up: `sed -i "B1,B2d" src/App.jsx` then `sed -i "A1,A2d" src/App.jsx`.

Add to App.jsx imports (and remove `DEFAULT_GRADING_COMPANY`/`GRADING_COMPANIES` from the `./utils/gradingScales.js` import only if they are no longer used elsewhere in App.jsx; `grep -c` first):

```js
import { getGrade, computeGrade } from "./lib/softwareGrade.js";
```

Remove `gradeCard, scoreToGrade, ENGINE_VERSION` from App.jsx's `./lib/gradingEngine.js` import if nothing else in App.jsx uses them (`grep -n "gradeCard(\|scoreToGrade(\|ENGINE_VERSION" src/App.jsx`). Likewise drop `calculateSoftwareConfidence` from the `./lib/tag-calibration.js` import if unused; leave the other unused calibration imports alone (F7 is a separate item).

- [ ] **Step 4: Run tests and build**

```bash
cd "G:/Grading App/SlabSense" && node src/lib/softwareGrade.test.js | tail -1 && node src/lib/detectors.test.js | tail -1 && node src/lib/gradingEngine.test.js | tail -2 && npm run build 2>&1 | tail -3
```
Expected: `13 passed, 0 failed`, `9 passed, 0 failed`, `82 passed, 0 failed`, clean build.

- [ ] **Step 5: Browser parity check**

Run `npm run dev`, upload a front and back photo you have graded before, run the software grade, and confirm the TAG score and ding list are identical to what that card produced before Task 1 (the collection view shows the previously saved raw_score for comparison). Note the score in the commit message.

- [ ] **Step 6: Commit**

```bash
cd "G:/Grading App/SlabSense" && git add src/lib/softwareGrade.js src/lib/softwareGrade.test.js src/App.jsx && git commit -m "refactor: move computeGrade adapter into src/lib/softwareGrade.js

Verbatim move so the harness and the app share one grading adapter.
Browser parity checked on <card> (TAG <score>, unchanged).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0178aXs7Ezimfg5onrPwdSTd"
```

---

### Task 3: Ground-truth export

**Files:**
- Create: `scripts/harness/export_ground_truth.py`
- Create: `scripts/harness/ground-truth.json` (generated, committed)

**Interfaces:**
- Consumes: `scripts/tag-dataset/data/dataset/{manifest,dings,corners,edges}.parquet`; local photo filenames under `scripts/Tag scraper/dig info/weights by tag/TAG Map/{Front,Back}`.
- Produces: `ground-truth.json` with the schema in spec §3.1. Keys per cert: `grade` (number), `label`, `pristine`, `tag: {centering, corners, edges, surface, surfaceFront, surfaceBack}` (numbers or null), `centering: {front:{lrRatio,tbRatio}, back:{lrRatio,tbRatio}}` (numbers or null), `dings: [{side:'FRONT'|'BACK', type, engineType, location, x, y}]`, `corners: {F:{TL:{angle,fill,fray},...},B:{...}}`, `edges: {F:{T:{fill,fray},...},B:{...}}`, `images: {front, back}` (basenames).

- [ ] **Step 1: Write the export script**

Create `scripts/harness/export_ground_truth.py`:

```python
"""
Export TAG ground truth for the 507 locally-stored reference photos.

Run from the repo root with the tag-dataset venv:
  scripts/tag-dataset/.venv/Scripts/python scripts/harness/export_ground_truth.py

Reads the parquet tables built by `python -m tagdataset build` and writes
scripts/harness/ground-truth.json (committed). Re-run when the dataset changes.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "scripts" / "tag-dataset" / "data" / "dataset"
PHOTOS = ROOT / "scripts" / "Tag scraper" / "dig info" / "weights by tag" / "TAG Map"
OUT = ROOT / "scripts" / "harness" / "ground-truth.json"

SIDE = {"F": "FRONT", "B": "BACK"}


def num(v):
    """pandas value -> float or None (NaN/None -> None)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def ratio(a, b):
    a, b = num(a), num(b)
    if a is None or b is None or (a + b) <= 0:
        return None
    return round(a / (a + b) * 100, 2)


def local_images():
    """cert -> {'front': basename, 'back': basename} for certs with both photos."""
    front = {re.match(r"([A-Z0-9]+)_", p.name).group(1): p.name for p in (PHOTOS / "Front").glob("*.jpg")}
    back = {re.match(r"([A-Z0-9]+)_", p.name).group(1): p.name for p in (PHOTOS / "Back").glob("*.jpg")}
    return {c: {"front": front[c], "back": back[c]} for c in front if c in back}


def main():
    images = local_images()
    manifest = pd.read_parquet(DATASET / "manifest.parquet")
    dings = pd.read_parquet(DATASET / "dings.parquet")
    corners = pd.read_parquet(DATASET / "corners.parquet")
    edges = pd.read_parquet(DATASET / "edges.parquet")

    manifest = manifest[manifest.cert.isin(images)]
    missing = sorted(set(images) - set(manifest.cert))
    if missing:
        print(f"WARNING: {len(missing)} local certs not in manifest: {missing[:10]}")

    dings = dings[dings.cert.isin(images) & ~dings.engine_type.isin(["SKIP", "CENTERING"])]
    corners = corners[corners.cert.isin(images)]
    edges = edges[edges.cert.isin(images)]

    out = {}
    for row in manifest.itertuples(index=False):
        cert = row.cert
        d = dings[dings.cert == cert].sort_values(["side", "ordering"])
        c = corners[corners.cert == cert]
        e = edges[edges.cert == cert]
        out[cert] = {
            "grade": num(row.grade_num),
            "label": row.grade_label,
            "pristine": bool(row.is_pristine),
            "tag": {
                "centering": num(row.rollup_centering),
                "corners": num(row.rollup_corners),
                "edges": num(row.rollup_edges),
                "surface": num(row.rollup_surface),
                "surfaceFront": num(row.surface_front),
                "surfaceBack": num(row.surface_back),
            },
            "centering": {
                "front": {"lrRatio": ratio(row.dte_front_left, row.dte_front_right),
                          "tbRatio": ratio(row.dte_front_top, row.dte_front_bottom)},
                "back": {"lrRatio": ratio(row.dte_back_left, row.dte_back_right),
                         "tbRatio": ratio(row.dte_back_top, row.dte_back_bottom)},
            },
            "dings": [
                {"side": SIDE.get(r.side, r.side), "type": r.type_name, "engineType": r.engine_type,
                 "location": None if pd.isna(r.location) else r.location,
                 "x": num(r.x), "y": num(r.y)}
                for r in d.itertuples(index=False)
            ],
            "corners": {
                s: {r.corner: {"angle": num(r.score_angle), "fill": num(r.score_fill), "fray": num(r.score_fray)}
                    for r in c[c.side == s].itertuples(index=False)}
                for s in ("F", "B")
            },
            "edges": {
                s: {r.edge: {"fill": num(r.score_fill), "fray": num(r.score_fray)}
                    for r in e[e.side == s].itertuples(index=False)}
                for s in ("F", "B")
            },
            "images": images[cert],
        }

    payload = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "scripts/tag-dataset/data/dataset/*.parquet",
        "count": len(out),
        "certs": dict(sorted(out.items())),
    }
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    n_dings = sum(len(v["dings"]) for v in out.values())
    n_cent = sum(1 for v in out.values() if v["centering"]["front"]["lrRatio"] is not None)
    print(f"wrote {OUT} — {len(out)} certs, {n_dings} dings, {n_cent} with front centering")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

```bash
cd "G:/Grading App/SlabSense" && ./scripts/tag-dataset/.venv/Scripts/python scripts/harness/export_ground_truth.py && ls -la scripts/harness/ground-truth.json
```
Expected: `wrote ... — 507 certs, ~1705 dings, 507 with front centering` (ding count is after SKIP/CENTERING exclusion, so slightly under 1705 is fine). File under 2 MB.

- [ ] **Step 3: Spot-check one record against the known DIG values**

```bash
cd "G:/Grading App/SlabSense" && node -e "
const gt=JSON.parse(require('fs').readFileSync('scripts/harness/ground-truth.json','utf8'));
const c=gt.certs['C1287305']; console.log(JSON.stringify({grade:c.grade,label:c.label,tag:c.tag,centering:c.centering,dings:c.dings.length,images:c.images},null,1));
const types={}; for(const v of Object.values(gt.certs)) for(const d of v.dings) types[d.engineType]=(types[d.engineType]||0)+1; console.log(types);"
```
Expected: grade 9, label `9 MINT`, four rollup numbers present, front/back centering ratios near 50, and a type histogram with CORNER, EDGE, PLAY_WEAR, CREASE, PRINT_DEFECT, DENT, SCRATCH, STAIN, PIT, TEAR keys and no SKIP.

- [ ] **Step 4: Commit**

```bash
cd "G:/Grading App/SlabSense" && git add scripts/harness/export_ground_truth.py scripts/harness/ground-truth.json && git commit -m "feat(harness): export TAG ground truth for the 507 local reference cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0178aXs7Ezimfg5onrPwdSTd"
```

---

### Task 4: Harness runner, compare tool, baseline

**Files:**
- Create: `scripts/harness/run.mjs`
- Create: `scripts/harness/compare.mjs`
- Create: `scripts/harness/README.md`
- Create: `scripts/harness/results/2026-09-14-baseline.json`, `.md`
- Modify: `package.json` (scripts)
- Modify: `.gitignore` (harness cache)

**Interfaces:**
- Consumes: `analyzePixels` (Task 1), `computeGrade`, `mapDingType` (Task 2), `ground-truth.json` (Task 3).
- Produces: results JSON `{ meta: {date,label,gitCommit,engineVersion,cards,sign}, summary: {...}, cards: [...] }` consumed by `compare.mjs` and by the F10 round later.

- [ ] **Step 1: Write `scripts/harness/run.mjs`**

```js
#!/usr/bin/env node
/**
 * Software Grade harness.
 *
 * Runs the production detectors (src/lib/detectors.js) and adapter
 * (src/lib/softwareGrade.js) over the 507 local TAG reference photos and
 * scores them against scripts/harness/ground-truth.json.
 *
 * Usage:
 *   node scripts/harness/run.mjs [--label name] [--limit N] [--cert C1287305] [--cache dir] [--no-cache]
 *
 * Sign convention: every "error" is software − TAG. Positive = software too lenient.
 */
import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzePixels } from '../../src/lib/detectors.js';
import { computeGrade, mapDingType } from '../../src/lib/softwareGrade.js';
import { ENGINE_VERSION, mergeSubgrades } from '../../src/lib/gradingEngine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const PHOTOS = path.join(ROOT, 'scripts', 'Tag scraper', 'dig info', 'weights by tag', 'TAG Map');
const GT_PATH = path.join(here, 'ground-truth.json');
const RESULTS_DIR = path.join(here, 'results');
const MAX_DIM = 1400; // must match src/lib/image-utils.js loadImg default

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const LABEL = opt('--label', 'run');
const LIMIT = Number(opt('--limit', 0)) || 0;
const ONLY = opt('--cert', null);
const USE_CACHE = !args.includes('--no-cache');
const CACHE_DIR = opt('--cache', path.join(os.tmpdir(), 'slabsense-harness-cache'));

// ── image loading (mirrors loadImg) ─────────────────────────────────────────
async function loadPixels(file) {
  const cachePath = path.join(CACHE_DIR, path.basename(file, '.jpg') + '.png');
  if (USE_CACHE && fs.existsSync(cachePath)) {
    const img = await loadImage(cachePath);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    return { data, w: img.width, h: img.height };
  }
  const img = await loadImage(file);
  let w = img.width, h = img.height;
  if (Math.max(w, h) > MAX_DIM) { const s = MAX_DIM / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  if (USE_CACHE) { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cachePath, c.toBuffer('image/png')); }
  const { data } = ctx.getImageData(0, 0, w, h);
  return { data, w, h };
}

// ── helpers ─────────────────────────────────────────────────────────────────
const r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const bucketOf = (g) => (g >= 9 ? '9-10' : g >= 7 ? '7-8.5' : g >= 5 ? '5-6.5' : '1-4.5');
const GRADE_AXIS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10];
const DING_TYPES = ['CORNER', 'EDGE', 'PLAY_WEAR', 'CREASE', 'DENT', 'SCRATCH', 'PRINT_DEFECT', 'PIT', 'STAIN', 'TEAR'];

function softwareDingKey(d) { const t = mapDingType(d.type); return t ? `${d.side}|${t}` : null; }
function truthDingKey(d) { return `${d.side}|${d.engineType}`; }

/** multiset match on side|type: returns { matched, tp per key } */
function matchDings(soft, truth) {
  const need = {};
  for (const d of truth) need[truthDingKey(d)] = (need[truthDingKey(d)] || 0) + 1;
  let matched = 0;
  const tpByKey = {};
  for (const d of soft) {
    const k = softwareDingKey(d);
    if (k && need[k] > 0) { need[k]--; matched++; tpByKey[k] = (tpByKey[k] || 0) + 1; }
  }
  return { matched, tpByKey };
}

// ── main ────────────────────────────────────────────────────────────────────
const gt = JSON.parse(fs.readFileSync(GT_PATH, 'utf8'));
let certs = Object.keys(gt.certs);
if (ONLY) certs = certs.filter((c) => c === ONLY);
if (LIMIT) certs = certs.slice(0, LIMIT);
if (!certs.length) { console.error('no certs selected'); process.exit(1); }

let gitCommit = 'unknown';
try { gitCommit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}

console.log(`harness: ${certs.length} cards, label=${LABEL}, cache=${USE_CACHE ? CACHE_DIR : 'off'}`);
const t0 = Date.now();
const cards = [];
let i = 0;
for (const cert of certs) {
  const g = gt.certs[cert];
  const c = g.centering;
  const frontC = c.front.lrRatio == null ? { lrRatio: 50, tbRatio: 50 } : c.front;
  const backC = c.back.lrRatio == null ? { lrRatio: 50, tbRatio: 50 } : c.back;
  try {
    const fp = await loadPixels(path.join(PHOTOS, 'Front', g.images.front));
    const bp = await loadPixels(path.join(PHOTOS, 'Back', g.images.back));
    const fr = analyzePixels(fp, 'front', null, frontC);
    const br = analyzePixels(bp, 'back', null, backC);
    const grade = computeGrade(fr.allDings, br.allDings, frontC, backC, 'tag', null);
    const softDings = [...fr.allDings, ...br.allDings].filter((d) => d.type !== 'CENTERING');
    const m = matchDings(softDings, g.dings);
    const boundsOk = (b, p) => b.cardW >= p.w * 0.85 && b.cardH >= p.h * 0.85;
    cards.push({
      cert,
      tagGrade: g.grade,
      tagLabel: g.label,
      softGrade: grade.overall.grade,
      softScore: grade.rawScore,
      gradeError: r2(grade.overall.grade - g.grade),
      subgrades: grade.subgrades,
      tag: g.tag,
      capsApplied: grade.overall.capsApplied,
      softDings: softDings.map((d) => ({ side: d.side, type: d.type, engineType: mapDingType(d.type), severity: d.severity, location: d.location })),
      truthDings: g.dings.map((d) => ({ side: d.side, engineType: d.engineType, type: d.type, location: d.location })),
      dingMatched: m.matched,
      bounds: { front: fr.bounds, back: br.bounds, frontOk: boundsOk(fr.bounds, fp), backOk: boundsOk(br.bounds, bp) },
      centeringUsed: { front: frontC, back: backC, frontMissing: c.front.lrRatio == null, backMissing: c.back.lrRatio == null },
    });
  } catch (e) {
    cards.push({ cert, tagGrade: g.grade, error: String(e && e.message || e) });
  }
  if (++i % 25 === 0 || i === certs.length) process.stdout.write(`  ${i}/${certs.length} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
}

// ── summary ─────────────────────────────────────────────────────────────────
const ok = cards.filter((c) => !c.error);
const errs = ok.map((c) => c.gradeError);
const within = (t) => r2(100 * errs.filter((e) => Math.abs(e) <= t + 1e-9).length / errs.length);

const byBucket = {};
for (const c of ok) {
  const b = bucketOf(c.tagGrade);
  (byBucket[b] ||= []).push(c.gradeError);
}
const bucketSummary = Object.fromEntries(Object.entries(byBucket).map(([b, es]) => [b, {
  cards: es.length, mae: r2(mean(es.map(Math.abs))), signed: r2(mean(es)),
  within05: r2(100 * es.filter((e) => Math.abs(e) <= 0.5 + 1e-9).length / es.length),
}]));

const confusion = {};
for (const c of ok) { (confusion[c.tagGrade] ||= {})[c.softGrade] = ((confusion[c.tagGrade] || {})[c.softGrade] || 0) + 1; }

// subgrades: software 0-100 ×10 vs TAG 1000-pt rollups
const subErr = { corners: [], edges: [], surface: [], centering: [], surfaceFront: [], surfaceBack: [] };
for (const c of ok) {
  const m = mergeSubgrades(c.subgrades);
  const cent = c.subgrades.backCentering == null ? c.subgrades.frontCentering : c.subgrades.frontCentering * 0.65 + c.subgrades.backCentering * 0.35;
  const push = (k, soft100, tag1000) => { if (tag1000 != null) subErr[k].push(soft100 * 10 - tag1000); };
  push('corners', m.corners, c.tag.corners); push('edges', m.edges, c.tag.edges); push('surface', m.surface, c.tag.surface);
  push('centering', cent, c.tag.centering);
  push('surfaceFront', c.subgrades.frontSurface, c.tag.surfaceFront); push('surfaceBack', c.subgrades.backSurface, c.tag.surfaceBack);
}
const subSummary = Object.fromEntries(Object.entries(subErr).map(([k, es]) => [k, { n: es.length, mae: r2(mean(es.map(Math.abs))), signed: r2(mean(es)) }]));

// dings: per side|type precision / recall
const dingStats = {};
for (const side of ['FRONT', 'BACK']) for (const t of DING_TYPES) dingStats[`${side}|${t}`] = { truth: 0, soft: 0, tp: 0 };
for (const c of ok) {
  for (const d of c.truthDings) { const k = `${d.side}|${d.engineType}`; if (dingStats[k]) dingStats[k].truth++; }
  for (const d of c.softDings) { const k = `${d.side}|${d.engineType}`; if (dingStats[k]) dingStats[k].soft++; }
  const m = matchDings(c.softDings.map((d) => ({ side: d.side, type: d.type })), c.truthDings);
  for (const [k, n] of Object.entries(m.tpByKey)) if (dingStats[k]) dingStats[k].tp += n;
}
for (const s of Object.values(dingStats)) { s.precision = s.soft ? r2(s.tp / s.soft) : null; s.recall = s.truth ? r2(s.tp / s.truth) : null; }
const cardsWithSoftDings = ok.filter((c) => c.softDings.length).length;
const cardsWithTruthDings = ok.filter((c) => c.truthDings.length).length;

const summary = {
  cards: ok.length, errors: cards.length - ok.length,
  grade: { mae: r2(mean(errs.map(Math.abs))), signed: r2(mean(errs)), exact: within(0), within05: within(0.5), within10: within(1.0) },
  byBucket: bucketSummary,
  confusion,
  subgrades: subSummary,
  dings: dingStats,
  dingCards: { softwareAny: cardsWithSoftDings, truthAny: cardsWithTruthDings },
  boundsFlagged: ok.filter((c) => !c.bounds.frontOk || !c.bounds.backOk).map((c) => c.cert),
  centeringMissing: ok.filter((c) => c.centeringUsed.frontMissing || c.centeringUsed.backMissing).length,
  seconds: Math.round((Date.now() - t0) / 1000),
};

const meta = { date: new Date().toISOString(), label: LABEL, gitCommit, engineVersion: ENGINE_VERSION, cards: ok.length, sign: 'software - TAG (positive = software too lenient)' };
fs.mkdirSync(RESULTS_DIR, { recursive: true });
const stem = `${new Date().toISOString().slice(0, 10)}-${LABEL}`;
fs.writeFileSync(path.join(RESULTS_DIR, `${stem}.json`), JSON.stringify({ meta, summary, cards }, null, 1));
fs.writeFileSync(path.join(RESULTS_DIR, `${stem}.md`), renderMd(meta, summary));
console.log(renderMd(meta, summary));
console.log(`wrote results/${stem}.json and .md`);

function renderMd(meta, s) {
  const L = [];
  L.push(`# Harness run: ${meta.label} (${meta.date.slice(0, 10)})`, '');
  L.push(`commit ${meta.gitCommit} · engine ${meta.engineVersion} · ${s.cards} cards · ${s.errors} errors · ${s.seconds}s`, '');
  L.push(`Sign: ${meta.sign}`, '');
  L.push('## Grade', '', '| MAE | signed | exact % | ≤0.5 % | ≤1.0 % |', '|---|---|---|---|---|');
  L.push(`| ${s.grade.mae} | ${s.grade.signed} | ${s.grade.exact} | ${s.grade.within05} | ${s.grade.within10} |`, '');
  L.push('| TAG bucket | cards | MAE | signed | ≤0.5 % |', '|---|---|---|---|---|');
  for (const b of ['9-10', '7-8.5', '5-6.5', '1-4.5']) { const v = s.byBucket[b]; if (v) L.push(`| ${b} | ${v.cards} | ${v.mae} | ${v.signed} | ${v.within05} |`); }
  L.push('', '## Confusion (rows TAG, cols software)', '', `| TAG \\ SW | ${GRADE_AXIS.join(' | ')} |`, `|---|${GRADE_AXIS.map(() => '---').join('|')}|`);
  for (const g of GRADE_AXIS) { const row = s.confusion[g]; if (!row) continue; L.push(`| **${g}** | ${GRADE_AXIS.map((x) => row[x] || '').join(' | ')} |`); }
  L.push('', '## Subgrades (software×10 − TAG rollup, 1000-pt)', '', '| category | n | MAE | signed |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(s.subgrades)) L.push(`| ${k} | ${v.n} | ${v.mae} | ${v.signed} |`);
  L.push('', '## Dings by side|type', '', '| key | TAG | software | matched | precision | recall |', '|---|---|---|---|---|---|');
  for (const [k, v] of Object.entries(s.dings)) if (v.truth || v.soft) L.push(`| ${k} | ${v.truth} | ${v.soft} | ${v.tp} | ${v.precision ?? '-'} | ${v.recall ?? '-'} |`);
  L.push('', `Cards with ≥1 software ding: ${s.dingCards.softwareAny} · with ≥1 TAG ding: ${s.dingCards.truthAny}`);
  L.push(`Bounds flagged (<85% of frame): ${s.boundsFlagged.length}${s.boundsFlagged.length ? ' — ' + s.boundsFlagged.slice(0, 20).join(', ') : ''}`);
  L.push(`Cards with missing TAG centering (50/50 assumed): ${s.centeringMissing}`, '');
  return L.join('\n');
}
```

- [ ] **Step 2: Write `scripts/harness/compare.mjs`**

```js
#!/usr/bin/env node
/**
 * Compare two harness result files.
 *   node scripts/harness/compare.mjs results/A.json results/B.json
 * Prints every summary number side by side (B − A) and lists cards whose
 * software grade moved by ≥ 1.0.
 */
import fs from 'node:fs';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: compare.mjs A.json B.json'); process.exit(1); }
const A = JSON.parse(fs.readFileSync(a, 'utf8'));
const B = JSON.parse(fs.readFileSync(b, 'utf8'));
const r2 = (x) => Math.round(x * 100) / 100;
const fmt = (x) => (x == null ? '-' : String(x));

console.log(`A: ${A.meta.label} (${A.meta.gitCommit})   B: ${B.meta.label} (${B.meta.gitCommit})   delta = B − A\n`);
const row = (name, va, vb) => console.log(`${name.padEnd(34)} ${fmt(va).padStart(9)} ${fmt(vb).padStart(9)} ${(va == null || vb == null ? '-' : fmt(r2(vb - va))).padStart(9)}`);
console.log(`${'metric'.padEnd(34)} ${'A'.padStart(9)} ${'B'.padStart(9)} ${'delta'.padStart(9)}`);
for (const k of ['mae', 'signed', 'exact', 'within05', 'within10']) row(`grade.${k}`, A.summary.grade[k], B.summary.grade[k]);
for (const bk of ['9-10', '7-8.5', '5-6.5', '1-4.5']) for (const k of ['mae', 'signed']) row(`bucket ${bk} ${k}`, A.summary.byBucket[bk]?.[k], B.summary.byBucket[bk]?.[k]);
for (const k of Object.keys(B.summary.subgrades)) for (const m of ['mae', 'signed']) row(`sub ${k} ${m}`, A.summary.subgrades[k]?.[m], B.summary.subgrades[k]?.[m]);
for (const k of Object.keys(B.summary.dings)) {
  const va = A.summary.dings[k], vb = B.summary.dings[k];
  if (!(va?.truth || va?.soft || vb?.truth || vb?.soft)) continue;
  row(`ding ${k} precision`, va?.precision, vb?.precision);
  row(`ding ${k} recall`, va?.recall, vb?.recall);
}
row('boundsFlagged', A.summary.boundsFlagged.length, B.summary.boundsFlagged.length);

const byCert = Object.fromEntries(A.cards.map((c) => [c.cert, c]));
const moved = B.cards.filter((c) => !c.error && byCert[c.cert] && !byCert[c.cert].error && Math.abs(c.softGrade - byCert[c.cert].softGrade) >= 1);
console.log(`\nCards whose software grade moved ≥1.0: ${moved.length}`);
for (const c of moved.slice(0, 40)) console.log(`  ${c.cert}  TAG ${c.tagGrade}  A ${byCert[c.cert].softGrade} → B ${c.softGrade}`);
```

- [ ] **Step 3: Wire package scripts and gitignore**

In `package.json` `scripts`, add:
```json
"harness": "node scripts/harness/run.mjs",
"harness:compare": "node scripts/harness/compare.mjs",
"test:lib": "node src/lib/gradingEngine.test.js && node src/lib/detectors.test.js && node src/lib/softwareGrade.test.js"
```
The harness cache defaults to the OS temp dir, so nothing in the repo needs ignoring; if `--cache` is ever pointed inside the repo, add that path to `.gitignore`.

- [ ] **Step 4: Smoke run on 5 cards**

```bash
cd "G:/Grading App/SlabSense" && npm run harness -- --limit 5 --label smoke
```
Expected: progress line `5/5`, a markdown summary printed, files `scripts/harness/results/2026-09-14-smoke.json/.md`. Check `boundsFlagged` is empty or near-empty for these five, and `errors: 0`. Delete the smoke result files afterwards (`rm scripts/harness/results/2026-09-14-smoke.*`).

If `findBounds` flags many cards (orange margin not separated from the card), inspect one flagged card's `bounds` in the JSON and confirm whether the box is the full frame (acceptable: card edges then include the orange margin, which the corner detector reads as non-white) or something smaller. Do not change `findBounds` in this round; record the flagged count in the baseline notes.

- [ ] **Step 5: Full baseline run**

```bash
cd "G:/Grading App/SlabSense" && npm run harness -- --label baseline
```
Expected: `507/507`, roughly 10–15 minutes on first run (cache empty). Reruns with the cache: under 2 minutes.

- [ ] **Step 6: Write the README and commit the baseline**

Create `scripts/harness/README.md`:

```markdown
# Software Grade harness

Scores the client-side Software Grade (detectors + adapter + engine) against 507 TAG-graded cards.

    npm run harness -- --label <name>          # full run, writes results/<date>-<name>.{json,md}
    npm run harness -- --limit 20 --cert X     # quick iteration
    npm run harness:compare results/A.json results/B.json

Ground truth: `ground-truth.json`, regenerated with
`scripts/tag-dataset/.venv/Scripts/python scripts/harness/export_ground_truth.py`.

Photos: `scripts/Tag scraper/dig info/weights by tag/TAG Map/{Front,Back}` (studio shots, card fills ~96% of frame).
Centering fed to the engine is TAG's own, so the numbers measure detector accuracy only.
Sign convention: software − TAG; positive = software too lenient.

Resized 1400-px copies are cached in the OS temp dir (`--cache <dir>` to move, `--no-cache` to disable).

Results are committed. Every detector change must ship with a new results file and a compare against the previous one.
```

```bash
cd "G:/Grading App/SlabSense" && git add scripts/harness/run.mjs scripts/harness/compare.mjs scripts/harness/README.md scripts/harness/results/2026-09-14-baseline.json scripts/harness/results/2026-09-14-baseline.md package.json && git commit -m "feat(harness): node harness for the software grade + 2026-09-14 baseline

Runs production detectors/adapter on 507 TAG reference photos and scores
grade, subgrade and ding accuracy. Baseline recorded before any behavior change.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0178aXs7Ezimfg5onrPwdSTd"
```

---

### Task 5: F1 — company-aware grade object, save path, collection

**Files:**
- Modify: `src/lib/softwareGrade.js` (`computeGrade` return `grade`)
- Modify: `src/lib/softwareGrade.test.js`
- Modify: `src/App.jsx` (`buildSaveData`)
- Modify: `src/services/scans.js` (insert `company_grades`)
- Modify: `src/components/Collection/CollectionView.jsx` (`getDisplayGrade` software branch)
- Create: `supabase/migrations/20260914_scans_company_grades.sql`

**Interfaces:**
- Produces: `computeGrade(...).grade` = `{ grade: number, label: string, displayGrade: string, color: string, bg: string }` for the selected company. `scanData.companyGrades` → column `scans.company_grades jsonb` with the engine's `companyGrades` object.

- [ ] **Step 1: Add failing tests to `softwareGrade.test.js`**

Append before the final summary lines:

```js
console.log('— F1 company-aware grade');
const oneEdge = [{ side: 'FRONT', type: 'EDGE WEAR', location: 'FRONT / TOP', severity: 1 }];
const C = { lrRatio: 50, tbRatio: 50 };
const asTag = computeGrade(oneEdge, [], C, C, 'tag', null);
const asPsa = computeGrade(oneEdge, [], C, C, 'psa', null);
const asBgs = computeGrade(oneEdge, [], C, C, 'bgs', null);
check('TAG: one minor edge → grade 10', asTag.grade.grade === 10, `got ${asTag.grade.grade}`);
check('PSA: one minor edge → grade 9 (any-defect cap)', asPsa.grade.grade === 9, `got ${asPsa.grade.grade}`);
check('BGS: one minor edge → grade 10', asBgs.grade.grade === 10, `got ${asBgs.grade.grade}`);
check('grade matches companyGrades for psa', asPsa.grade.grade === asPsa.companyGrades.psa.grade && asPsa.grade.label === asPsa.companyGrades.psa.label);
check('grade carries color/bg', typeof asPsa.grade.color === 'string' && typeof asPsa.grade.bg === 'string');
const halfBgs = computeGrade([], [], { lrRatio: 55, tbRatio: 50 }, C, 'bgs', null);
check('BGS 9.5 reachable', halfBgs.grade.grade === 9.5, `got ${halfBgs.grade.grade}`);
```

Run: `node src/lib/softwareGrade.test.js` → expected the PSA and BGS-9.5 checks fail (today every company shows the TAG band: PSA shows 10, BGS shows 10 instead of 9.5).

- [ ] **Step 2: Implement in `softwareGrade.js`**

Add to imports: `GRADE_COLORS` from `./masterweights.js`.

In `computeGrade`, replace the line `grade: getGrade(tagScore1000, companyId),   // legacy band lookup for current UI colors` with:

```js
    grade: companyGradeObject(companyGrades, companyId, overall),
```

and add above `computeGrade`:

```js
/**
 * F1: the displayed grade must come from the engine's per-company conversion,
 * not from a TAG-band lookup of the TAG score. Shape matches what the UI read
 * from the legacy getGrade() object: { grade, label, displayGrade, color, bg }.
 */
export function companyGradeObject(companyGrades, companyId, overall) {
  const cg = companyGrades[companyId] || companyGrades.tag;
  const isTag = !companyGrades[companyId] || companyId === 'tag';
  const grade = cg.grade;
  const label = isTag && overall?.label ? overall.label : cg.label;
  const colors = GRADE_COLORS[grade] || GRADE_COLORS[1];
  return { grade, label, displayGrade: cg.displayGrade ?? String(grade), ...colors };
}
```

`getGrade` stays exported for `ScoreRing` and other TAG-score UI uses.

- [ ] **Step 3: Run tests**

`node src/lib/softwareGrade.test.js` → `19 passed, 0 failed`. `npm run test:lib` → all green.

- [ ] **Step 4: Save path**

In `src/App.jsx`, find `const buildSaveData` and inside the returned object, next to `subgrades: gradeResult.subgrades,`, add:

```js
      companyGrades: gradeResult.companyGrades || null,
```

In `src/services/scans.js` `saveScan` insert, after `subgrades: scanData.subgrades || {},` add:

```js
      company_grades: scanData.companyGrades || null,   // engine per-company grades (F1)
```

Create `supabase/migrations/20260914_scans_company_grades.sql`:

```sql
-- F1: store the engine's per-company software grades so the collection view
-- can show PSA/BGS/CGC/SGC without recomputing from the TAG score.
alter table public.scans
  add column if not exists company_grades jsonb;

comment on column public.scans.company_grades is
  'gradingEngine companyGrades: { tag:{grade,label,displayGrade,score}, psa:{grade,label,subgrades}, bgs, cgc, sgc }';
```

Apply it to the project database the same way the previous migrations were applied (Supabase SQL editor or CLI). The insert tolerates a missing column only if the column exists, so apply before testing the save.

- [ ] **Step 5: Collection view**

In `src/components/Collection/CollectionView.jsx` `getDisplayGrade`, replace the software branch:

```js
    // Software grade - recalculate from raw_score for selected company
    const rawScore = scan.raw_score || 0;
    const recalcGrade = rawScore > 0 ? getGradeFromScore(rawScore, company) : null;
    return {
      value: recalcGrade?.grade ?? scan.grade_value,
      label: recalcGrade?.label ?? scan.grade_label,
      color: recalcGrade?.color ?? GRADING_COMPANIES[company]?.color,
```

with:

```js
    // Software grade (F1): prefer the engine's stored per-company grade.
    // Fallbacks: TAG can be recomputed from raw_score; other companies on old rows
    // show whatever was stored at save time.
    const rawScore = scan.raw_score || 0;
    const stored = scan.company_grades?.[company];
    const recalcGrade = !stored && company === 'tag' && rawScore > 0 ? getGradeFromScore(rawScore, 'tag') : null;
    const value = stored?.grade ?? recalcGrade?.grade ?? scan.grade_value;
    const label = stored?.label ?? recalcGrade?.label ?? scan.grade_label;
    return {
      value,
      label,
      color: getGradeColor(value) || recalcGrade?.color || GRADING_COMPANIES[company]?.color,
```

Add `getGradeColor` to the masterweights import in CollectionView (it exists: `export function getGradeColor(grade)` returns `{color,bg}`; use `.color`: `color: getGradeColor(value)?.color || ...`).

Also make the collection's stored subgrades company-aware where it shows BGS subgrades (`selectedCompany === 'bgs' && grade.subgrades`): pass `subgrades: stored?.subgrades ?? scan.subgrades` in the returned object so BGS shows its four company subgrades when available.

- [ ] **Step 6: Build and browser verification**

`npm run build` clean. Then `npm run dev`:
1. Grade a card, switch company to PSA, BGS, CGC, SGC. Confirm the big number equals `gradeResult.companyGrades[<company>].grade` (log it from the console: `console.log` is not wired, so read it from the Subgrades panel or add a temporary `console.log(grade.companyGrades)` in `run()` and remove it before commit).
2. Confirm a BGS 9.5 shows on a lightly off-center clean card.
3. Save the card; in Supabase confirm `company_grades` is populated. Open the collection, switch companies, confirm the stored grades display.

- [ ] **Step 7: Commit**

```bash
cd "G:/Grading App/SlabSense" && git add src/lib/softwareGrade.js src/lib/softwareGrade.test.js src/App.jsx src/services/scans.js src/components/Collection/CollectionView.jsx supabase/migrations/20260914_scans_company_grades.sql && git commit -m "fix(F1): software grade shows the engine's per-company grade, not a TAG-band lookup

Adds scans.company_grades so the collection can display any company without
recomputing. BGS/CGC/SGC 9.5 and PSA's any-defect cap are now visible.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0178aXs7Ezimfg5onrPwdSTd"
```

---

### Task 6: F2 — detectors run on the cropped image

**Files:**
- Modify: `src/App.jsx` (`run()`, `applyManualCorrection()`)

**Interfaces:**
- Consumes: `analyzeCardFull(src, side, overrideBounds, overrideCentering)` (unchanged signature), `frontCroppedImage` / `backCroppedImage` state, `frontCenteringData` / `backCenteringData`.

- [ ] **Step 1: Locate the two call sites**

```bash
cd "G:/Grading App/SlabSense" && grep -n "analyzeCardFull(" src/App.jsx
```
Expected: the definition, one call in `applyManualCorrection`, two calls in `run()`.

- [ ] **Step 2: Change `run()`**

Current code (inside `run`):

```js
      const fr=await analyzeCardFull(fI,"front", frontOverrideBounds, frontOverrideCentering); setFR(fr);
      ...
      const br=await analyzeCardFull(bI,"back", backOverrideBounds, backOverrideCentering); setBR(br);
```

Replace with:

```js
      // F2: when the user cropped the card in the centering tool, analyze THAT image
      // with no bounds override (findBounds on a card-filling crop returns the frame).
      // The manual centering ratios still override analyzeCentering.
      const frontSrc = frontCroppedImage || fI;
      const backSrc  = backCroppedImage  || bI;
      const fr=await analyzeCardFull(frontSrc,"front", frontCroppedImage ? null : frontOverrideBounds, frontOverrideCentering); setFR(fr);
      ...
      const br=await analyzeCardFull(backSrc,"back", backCroppedImage ? null : backOverrideBounds, backOverrideCentering); setBR(br);
```

Add `frontCroppedImage, backCroppedImage` to the `useCallback` dependency array of `run`.

Update the progress text lines so they read `"Analyzing cropped card (front)..."` when `frontCroppedImage` is set, else the existing text.

- [ ] **Step 3: Change `applyManualCorrection()`**

Today it analyzes first, then crops. Flip the order so the analysis uses the fresh crop:

```js
  const applyManualCorrection = useCallback(async (side, overrideBounds, overrideCentering) => {
    const src = side === 'front' ? fI : bI;
    if (!src) return;

    // 1) Generate the new crop from the corrected outer bounds
    let croppedImage = null;
    try {
      const corners = overrideBounds.corners || {
        tl: { x: overrideBounds.left, y: overrideBounds.top },
        tr: { x: overrideBounds.right, y: overrideBounds.top },
        bl: { x: overrideBounds.left, y: overrideBounds.bottom },
        br: { x: overrideBounds.right, y: overrideBounds.bottom },
      };
      const rotation = overrideCentering.rotation || 0;
      croppedImage = await cropToOuterBounds(src, corners, rotation, 1400);
      if (side === 'front') setFrontCroppedImage(croppedImage); else setBackCroppedImage(croppedImage);
    } catch (cropErr) {
      console.error('[applyManualCorrection] Crop failed:', cropErr);
    }

    // 2) Analyze the crop (F2). Fall back to original + bounds only if cropping failed.
    const result = croppedImage
      ? await analyzeCardFull(croppedImage, side, null, overrideCentering)
      : await analyzeCardFull(src, side, overrideBounds, overrideCentering);
    const newFR = side === 'front' ? result : fR;
    const newBR = side === 'back' ? result : bR;
    if (side === 'front') setFR(result); else setBR(result);
```

Keep the rest of the function (the `newCenteringData` block and the `computeGrade` call) as it is, but move the `newCenteringData` block after step 2 unchanged, and delete the old "Generate new cropped image from the bounds" block at the bottom since step 1 replaced it. `cropToOuterBounds` previously received `result.imgW || 1400`; pass `1400` (the same value `loadImg` scales to).

- [ ] **Step 4: Check `scaledImgUrl` consumers**

`grep -n "scaledImgUrl" src/App.jsx` → the dings panel (`displayImg = result.scaledImgUrl || image`) and the damage report loop. Both now receive the crop, which is what the ding crop boxes (`cropX/cropY` in `corners.details` etc.) are relative to. No change needed; confirm in the browser that ding crops line up.

- [ ] **Step 5: Build, tests, browser verification**

`npm run build` clean; `npm run test:lib` green.
Browser:
1. Upload a card in **corner** mode. Note the software dings and TAG score.
2. Reset, upload the same photos in **edge** mode. Software dings and score must match run 1 (both paths now analyze the same crop).
3. Confirm the Dings tab shows the crop and the corner/edge thumbnails line up with the card corners.
4. Use "Apply Correction" once and confirm the crop updates and the grade recomputes without console errors.

- [ ] **Step 6: Commit**

```bash
cd "G:/Grading App/SlabSense" && git add src/App.jsx && git commit -m "fix(F2): run software detectors on the user's cropped card, not the original photo

Corner and edge measure modes now share one analysis path. Edge mode
previously overlaid crop-space bounds on the original image.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0178aXs7Ezimfg5onrPwdSTd"
```

---

### Task 7: Re-run harness, record delta, update docs

**Files:**
- Create: `scripts/harness/results/2026-09-14-after-f1-f2.json`, `.md`
- Modify: `docs/SOFTWARE_GRADE_REVIEW_2026-09-13.md`

- [ ] **Step 1: Run and compare**

```bash
cd "G:/Grading App/SlabSense" && npm run harness -- --label after-f1-f2 && npm run harness:compare scripts/harness/results/2026-09-14-baseline.json scripts/harness/results/2026-09-14-after-f1-f2.json
```
Expected: the harness numbers are identical or nearly identical to the baseline (F1 does not touch the TAG grade; the harness already ran on card-filling images). Any card that moved ≥1.0 must be explained (it would mean the extraction changed behavior; investigate before continuing). Paste the compare output at the bottom of the new `.md`.

- [ ] **Step 2: Update the review doc**

In `docs/SOFTWARE_GRADE_REVIEW_2026-09-13.md`:
- Under F1 and F2 add a line: `**Status:** fixed 2026-09-14 (commit <sha>).`
- In section 6, replace the `validation_test` row's note with: `Same 4400×6100 TAG downloads as the main set, NOT phone photos. No phone-style set exists yet.` and fix the caveat paragraph accordingly.
- Add a section `## 8. Harness baseline (2026-09-14)` containing the baseline grade table, subgrade table and the ding precision/recall table copied from `results/2026-09-14-baseline.md`, plus one sentence on what it says about F3 vs F10 (which side of the ledger dominates).

- [ ] **Step 3: Commit**

```bash
cd "G:/Grading App/SlabSense" && git add scripts/harness/results/2026-09-14-after-f1-f2.json scripts/harness/results/2026-09-14-after-f1-f2.md docs/SOFTWARE_GRADE_REVIEW_2026-09-13.md && git commit -m "docs: harness results after F1/F2 and review status update

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0178aXs7Ezimfg5onrPwdSTd"
```

---

## Self-review notes

- Spec §3 ground truth → Task 3. §4.1 → Task 1. §4.2 → Task 2. §5 harness (layout, loading, metrics, output, compare, runtime) → Task 4. §6 F1 → Task 5. §7 F2 → Task 6. §8 testing → each task's verify step plus Task 7. §9 files → covered; `.gitignore` needs no change because the cache lives in the OS temp dir.
- Names used across tasks: `analyzePixels` (T1 → T4), `computeGrade` / `mapDingType` (T2 → T4, T5), `companyGradeObject` (T5 only), `mergeSubgrades` (engine export, used in T4), `scanData.companyGrades` → `company_grades` (T5).
- `getGrade` remains exported from `softwareGrade.js` for App.jsx's `ScoreRing` and legacy uses; `getGradeFromScore` in `gradingScales.js` is untouched.
