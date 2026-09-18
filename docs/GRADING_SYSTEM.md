# SlabSense Grading System

**The one grading document.** Everything about how SlabSense turns a card's photos into a grade lives here
or in the verbatim company standards next to it. Nothing else in the repo may define a grading number.

- Code: `src/lib/gradingEngine.js` (all math), `src/lib/softwareGrade.js` (software adapter),
  `src/lib/detectors.js` (software defect detectors), `api/_lib/detectionPrompt.js` (AI detection prompt +
  output assembly), `api/ai-analyze-unified.js` / `api/deep-analyze-v2.js` (paid paths),
  `src/utils/gradingScales.js` (UI metadata derived from the engine).
- Company standards (verbatim, captured 2026-09-15): `docs/grading-research/sources/`
  `TAG_scale_and_rubric_verbatim.md`, `PSA_gradingstandards_verbatim.md`, `CGC_gradingscale_verbatim.md`,
  `SGC_gradingscale_verbatim.md`, `BGS_gradingstandards_verbatim.md`, plus the owner's own TAG DIG report data in
  `TAG_DIG_reports_calibration.md`.
- Rule: **no grading number without a citation.** Every per-company rule in the engine cites a `sources/*` file.
  Values marked *internal* below are SlabSense choices (calibrated against DIG reports), not company rules.

Last updated 2026-09-17 (engine 1.1; corner/edge models on the software path).

---

## 1. Pipeline

Three grade paths, one engine:

| Path | Who finds the defects | Who grades | Cost |
|---|---|---|---|
| Software | corner/edge models on TAG-framed crops + `detectors.js` for surface wear; centering from the app | engine | free |
| AI | Claude, one pass, surface detection; corners/edges from the models when the app ran them | engine | 1 credit |
| Deep AI | Claude, two passes (pass 2 sees pass 1 + TAG-graded reference cards); corners/edges from the models when the app ran them | engine | 2 credits |

The model **never grades**. It returns `{ cardInfo, imageQuality, defects[], summary }`; `gradeCard()` does all the
math. Centering is **measured by the app** (the user's centering tool) and passed in; no path lets the model
estimate centering. Deep pass 2 may refine cosmetic findings but can never drop or soften a structural one
(`mergeStructural`: CREASE, TEAR, DENT, STAIN, PIT survive with at least pass-1 severity).

Paid paths run through `api/_lib/gradeJobs.js`: authenticate → spend credit → `ai_grade_jobs` row (one in
flight per user + card + tier) → analyze → store result, or refund + store error. See
`docs/superpowers/plans/2026-09-15-codebase-sweep.md` for the credit/job design.

### Defect model (the only vocabulary the engine accepts)

```
type      CORNER | EDGE | SCRATCH | DENT | PRINT_DEFECT | CREASE | PLAY_WEAR | PIT | STAIN | TEAR
severity  minor | moderate | severe | extreme
side      FRONT | BACK
location  TOP LEFT · TOP RIGHT · BOTTOM LEFT · BOTTOM RIGHT · TOP EDGE · BOTTOM EDGE · LEFT EDGE · RIGHT EDGE
          TOP CENTER · MIDDLE LEFT · MIDDLE CENTER · MIDDLE RIGHT · BOTTOM CENTER
x, y, width, height   0–100 % of the card image
```

Software detectors emit only CORNER, EDGE, PLAY_WEAR (and measure centering); the AI paths can emit every type.
Category: CORNER → corners, EDGE → edges, everything else → surface.

### Corner and edge models (software path) *(added 2026-09-17)*

Corner and edge wear comes from two trained models instead of the pixel detectors — on **every path**.
Nothing downstream changes: the models emit the same `CORNER` / `EDGE` defects the engine already accepts, so
the engine math, the damage report and the saved-card shape are untouched. The detectors' own corner and edge
dings are dropped when the models run; their surface dings (creases, scratches, stains) are kept, because no
surface model is wired in yet.

**Paid paths agree with the free one by construction** *(2026-09-17)*. When the app has run the models, a paid
grade sends every slot's prediction in the request (`cornerEdge`, the way centering is sent). The server
(`api/_lib/cornerEdgeInput.js`) validates the table, shows it to Claude as measured context so it skips
corners and edges and spends its inspection on the surface, then replaces any CORNER / EDGE defect Claude
still reports with the model's, at the same thresholds and severities as the free grade. The response carries
`meta.cornerEdgeSource: 'model'`; without the table it is `'ai'` and the paid path behaves as before (models
off, models failed, a saved card re-graded from the collection). Round-tripped over the 506 harness cards, the
paid path reproduces the free grade's corner and edge subgrades on every card.

| | |
|---|---|
| Models | `corners-v2` (wear, deduction, angle) and `edges-v1` (wear, deduction); convnext_tiny, fp16 ONNX, 54 MB each |
| Trained on | TAG's own per-slot crops over 22 202 cards — see `training/README.md` |
| Code | `src/lib/tag-crops.js` (framing), `corner-edge-model.js` (outputs → defects), `corner-edge-runner.js` (inference), `src/services/cornerEdgeModels.js` (browser) |
| Switch | Settings → Corner & Edge Models, per device; `VITE_MODEL_GRADING` sets the build default; **on** when neither is set |
| Hosting | the public `models` bucket, fetched at runtime and cached; never bundled. Supabase caps an object at 50 MB, so each model is stored in parts listed in `models.json` |

**Crop framing.** TAG grades from one crop per slot: a corner square of 0.1250 W × 0.0903 H, edge strips
filling the span between the corners, and a shorter bottom strip of 0.0739 H (measured over 598 cached dataset
cards, every card within ±1.5 %). `tag-crops.js` reproduces that on the card rectangle at any resolution,
including the 90° counter-clockwise rotation training applied to the left and right strips. Checked against
TAG's published crops on the 16 cards that have both a harness photo and cached crops: mean pixel difference
under 2/255, model wear agreeing within 0.01, and 0 threshold flips in 128 corner slots
(`scripts/harness/verify-crops.mjs`).

**Outputs → defects.** Each slot returns a wear probability and a deduction in TAG points (sigmoid × 1000).
A slot becomes a ding when wear clears its threshold, and the predicted deduction picks the engine severity.
Both are *internal* — TAG publishes neither — and both were calibrated on the DIG harness, never guessed.

| | corners | edges |
|---|---|---|
| wear threshold | 0.30 | 0.50 |
| severity: moderate / severe / extreme at | 150 / 300 / 500 predicted points | 150 / 300 / 500 |

Calibration (`scripts/harness/model-sweep.mjs`, 216 settings) was chosen on the 404 harness cards that were in
the models' training split and reported on the 102 held-out ones, with TAG's own centering held fixed so the
comparison isolates the defect change:

| held out, vs the detector baseline | baseline | models |
|---|---|---|
| mean grade error | 2.98 | 1.72 |
| TAG 9–10 bucket, mean error | 0.59 | 0.12 |
| TAG 9–10 bucket, within half a grade | — | 89 % |
| corner detection, precision / recall | never fired | 0.66 / 0.84 |

The held-out improvement is 1.26 grades (95 % paired bootstrap 0.94 to 1.69, n = 102).

**Why the thresholds are not the lowest-error ones.** Firing more and harsher corner dings scores better
overall (1.40 vs 1.84 mean error) but earns it by punishing creased and stained cards through corner dings
that TAG never marked. That trade costs clean-card accuracy (9–10 bucket 0.28 vs 0.12), makes the damage
report name the wrong defect, and would have to be undone once a surface model exists. The remaining leniency
on low grades is surface-detection debt, not a threshold left untuned.

**Phone photos: two things the app must get right** *(found 2026-09-17 on the owner's own worn card, which the
models had scored as clean)*.

1. *No synthetic corners.* The crop used to clip the card with a drawn 4.8 % rounded corner, which replaced
   the real corner tip — where wear lives — with a perfect arc. Removed; the crop now shows the real corner and
   a little of the table beyond it.
2. *TAG's backdrop is baked into the models.* Every training crop has TAG's orange backdrop beyond the corner.
   Measured on held-out scans (`scripts/harness/model-domain.mjs`): with the backdrop repainted black the
   models keep 17 of 64 corner dings and invent 23 edge dings; white keeps 26. So `tag-crops.js` flood-fills
   the table beyond the card on each tile and paints it TAG orange before inference, which brings a black table
   back to 49 of 64 and 5 false edge dings, at a cost of 3 of 64 on TAG's own scans. A leak guard leaves the
   tile alone when the fill reaches the tile centre or exceeds 30 % of it. The durable fix is backdrop-colour
   augmentation in the next training run; the repaint is the bridge until then.

**Limits to know.**

- Low grades stay lenient (1–4.5 bucket, mean error 3.84): those cards are creased and stained, which no model
  covers yet.
- The models have only ever seen TAG studio scans. Phone photos are a domain gap the harness cannot measure,
  because every photo in the repo is a TAG scan.
- Resolution costs little. TAG's crops are 550 px; the app's 2000 px upload cap leaves about 180 px per corner.
  Re-running the held-out cards from 2000 px copies moved mean grade error from 1.72 to 1.79, flipped 1.6 % of
  corner ding decisions, and left 83 % of cards on an identical grade
  (`scripts/harness/model-resolution.mjs`). That measures resolution alone — the images are still TAG scans.

---

## 2. TAG baseline (the engine's native scale)

TAG is the baseline because the owner has real DIG reports to calibrate against, and TAG publishes the most
complete rubric. Source: `sources/TAG_scale_and_rubric_verbatim.md`.

### 2.1 Eight subgrades, 0–100 each

frontCentering, backCentering, frontCorners, backCorners, frontEdges, backEdges, frontSurface, backSurface.
(Back keys are null in front-only mode.)

### 2.2 Centering → subgrade score *(TAG rubric, TCG column — verified)*

Deviation = points from 50/50 (55/45 → 5). First row whose limit the deviation meets wins.

| Front dev ≤ | Score | Band | | Back dev ≤ (TCG) | Score | Band |
|---|---|---|---|---|---|---|
| 1.0 (51/49) | 99.5 | 10P | | 2.0 (52/48) | 99.5 | 10P |
| 5.0 (55/45) | 97.0 | 10 | | 15.0 (65/35) | 97.0 | 10 |
| 10.0 (60/40) | 92.0 | 9 | | 25.0 (75/25) | 92.0 | 9 |
| 12.5 | 86.0 | 8.5 | | 35.0 (85/15) | 86.0 | 8.5 |
| 15.0 | 82.5 | 8 | | 45.0 (95/5) | 82.5 | 8 |
| 17.5 | 77.5 | 7.5 | | worse ("tiny sliver") | 77.5 | 7.5 |
| 20.0 | 72.5 | 7 | | | | |
| 22.5 | 67.5 | 6.5 | | | | |
| 25.0 | 62.5 | 6 | | | | |
| 27.5 | 57.5 | 5.5 | | | | |
| 30.0 | 52.5 | 5 | | | | |
| 32.5 | 47.5 | 4.5 | | | | |
| 35.0 | 42.5 | 4 | | | | |
| 37.5 | 37.5 | 3.5 | | | | |
| 40.0 | 32.5 | 3 | | | | |
| 42.5 | 27.5 | 2.5 | | | | |
| 45.0 | 22.5 | 2 | | | | |
| 48.33 | 17.5 | 1.5 | | | | |
| worse | 10.0 | 1 | | | | |

### 2.3 Defect deductions *(internal — calibrated against DIG reports, not published by TAG)*

`deduction = BASE[type] × SEVERITY[severity] × SIDE[side]`, then diminishing returns within a category:
defects sorted worst first, the *i*-th one scaled by `1 / (1 + 0.15·i)`. Category score = `100 − Σ`, floor 10.

| BASE | | SEVERITY | | SIDE | |
|---|---|---|---|---|---|
| CORNER 4.0 · EDGE 5.0 · SCRATCH 2.5 · DENT 6.0 · PRINT_DEFECT 3.0 | | minor ×1.0 | | FRONT ×1.0 | |
| CREASE 12.0 · PLAY_WEAR 3.5 · PIT 5.0 · STAIN 20.0 · TEAR 30.0 | | moderate ×2.5 · severe ×5.0 · extreme ×8.0 | | BACK ×0.7 | |

### 2.4 Compounding *(internal — TAG does not publish its combination math)*

`score = 0.75 × min(subgrades) + 0.25 × mean(subgrades)` over the non-null subgrades.

### 2.5 Caps (applied after compounding) *(internal unless noted)*

| Cap | Condition |
|---|---|
| ≤ 60 (grade 6) | any CREASE — *any severity; a "minor" label never lifts a crease above 6* |
| ≤ 50 (grade 5) | CREASE severe or extreme |
| ≤ 40 (grade 4) | any TEAR |
| ≤ 50 | STAIN severe or extreme |
| ≤ 50 | any defect with severity extreme |
| ≤ 85 (grade 8.5) | five or more defects |
| ≤ 98.9 (blocks Pristine) | any CORNER or EDGE defect |
| Pristine gate (≤ 98.9) | score ≥ 99 requires front & back centering dev ≤ 2, no corner/edge defects, ≤ 3 surface defects all minor |
| Min-subgrade clamp | the overall score may never exceed the band ceiling of the lowest subgrade (TAG behaviour: 10/10/10/9 → 9) |

### 2.6 Score → grade *(TAG scale page — verified)*

| Score (1000-pt) | Grade | Label | | Score | Grade | Label |
|---|---|---|---|---|---|---|
| 990–1000 | 10P | Pristine | | 500–549 | 5 | EX |
| 950–989 | 10 | Gem Mint | | 450–499 | 4.5 | VG-EX+ |
| 900–949 | 9 | Mint | | 400–449 | 4 | VG-EX |
| 850–899 | 8.5 | NM-MT+ | | 350–399 | 3.5 | VG+ |
| 800–849 | 8 | NM-MT | | 300–349 | 3 | VG |
| 750–799 | 7.5 | NM+ | | 250–299 | 2.5 | Good+ |
| 700–749 | 7 | NM | | 200–249 | 2 | Good |
| 650–699 | 6.5 | EX-MT+ | | 150–199 | 1.5 | Fair |
| 600–649 | 6 | EX-MT | | 100–149 | 1 | Poor |
| 550–599 | 5.5 | EX+ | | | | |

No 9.5 (TAG: "half points on every grade level except between 9 and 10"). The engine works in 0–100 and reports
`score × 10` as the 1000-point TAG score.

---

## 3. Company conversions

Same defects and centering, converted per company. Order: merge → company subgrades → company combination →
company caps → snap down to the company's allowed grade steps.

**Merge 8 → 3 condition subgrades** *(internal)*: `front × 0.65 + back × 0.35` for corners, edges, surface
(front only when the back is null). **Company subgrade** = merged score ÷ 10, snapped **down** to that company's
grade steps. **Centering subgrade** = the highest grade whose front AND back limits the card meets, from the
company table below.

### 3.1 Centering limits per company (max deviation front / back) — *verified from each company's page*

| Grade | PSA | BGS | CGC | SGC (front only; no back rule published) |
|---|---|---|---|---|
| 10 Pristine | — | 0 / 5 | 50/50 (label only) | 50/50 (label only) |
| 10 / 9.5 Gem | 10: 5 / 25 | 9.5: 5 / 10 | 10: 5 / 25 | 10: 5 |
| 9 | 10 / 40 | 5 / 20 | 10 / 40 | 10 |
| 8.5 | — | — | — | 15 |
| 8 | 15 / 40 | 10 / 30 | 15 / 40 | 15 |
| 7.5 | — | — | 15 / 40 | 20 |
| 7 | 20 / 40 | 15 / 40 | 20 / 40 | 20 |
| 6 | 30 / 40 | 20 / 45 | 25 / 40 | 25 |
| 5 | 35 / 40 | 25 / 45 | — | 30 |
| 4.5 | — | — | 35 / 40 | — |
| 4 | 35 / 40 | 30 / 50 | — | 35 |
| 3.5 | — | — | 40 / 40 | — |
| 3 | 40 / 40 | 35 / 50 | — | 40 |
| 2 | 40 / 40 | 35 / 50 | — | 40 |
| 1.5 | 40 / 40 | — | — | 40 |

PSA also grants a 5 % front leeway for 7 and up at the grader's discretion (not modelled). Half steps not listed
are reached only through the company's combination, never through centering.

### 3.2 Combination and caps per company

**PSA** *(sources/PSA)* — lowest subgrade wins. Any defect → ≤ 9; 3+ defects → ≤ 8; any corner wear → ≤ 8
(9 allows none); 3+ worn corners → ≤ 7; any crease → ≤ 4 ("a light crease may be visible" first appears at 4);
severe crease → ≤ 2; any tear → ≤ 4, severe tear → 1; any extreme defect → ≤ 5. Steps: 1 … 9, 10 (no 9.5).

**BGS** *(sources/BGS; the four-subgrade "+0.5" combination is NOT published by Beckett — internal)* — four
subgrades; overall = lowest + 0.5 unless two subgrades tie at the lowest, capped by the second-lowest, +1 when the
second-lowest is ≥ 3 above. Caps from the chart: any defect → ≤ 9.5; any corner wear → ≤ 9; 2+ corners → ≤ 7;
dinged (moderate) corner → ≤ 5, 2+ → ≤ 4; rounded (severe) → ≤ 3; moderate edge → ≤ 6, severe → ≤ 3;
noticeable print spots → ≤ 7, heavy → ≤ 4; moderate scratch/dent/pit → ≤ 5; any scuffing → ≤ 4, moderate → ≤ 3;
any stain → ≤ 7, moderate → ≤ 4; crease minor → ≤ 4, moderate → ≤ 3, severe+ → 1; tear 4 / 3 / 1; extreme → 1.
Labels at 10: Black Label (four 10s), Gold Label (three 10s + a 9.5), Pristine.

**CGC** *(sources/CGC; the "centering compensatable up to 1.0" rule is internal)* — base = lowest of
corners/edges/surface; centering may pull it down at most 1.0. Caps: any defect → ≤ 9; 2+ defects → ≤ 7.5
(8.5/8 allow one very minor flaw); 2–3 worn corners → ≤ 7.5, 3+ → ≤ 7; dinged corner → ≤ 6.5, 2 → ≤ 5.5,
3 → ≤ 5; rounded → ≤ 4.5, four rounded → ≤ 3.5; edge chipping → ≤ 5.5, moderate edge wear → ≤ 3.5; noticeable
print spots → ≤ 6.5; scratches/dents/pits → ≤ 4.5, severe → ≤ 3.5; any stain → ≤ 6.5, moderate → ≤ 3.5;
crease: one light → ≤ 4.5, more → ≤ 4, moderate → ≤ 3.5, heavier → ≤ 2.5, breaks the surface → 1; missing
surface (tear) → ≤ 1.5; extreme → ≤ 1.5. Pristine 10 label only at 50/50 with no defects.

**SGC** *(sources/SGC)* — lowest subgrade wins. Caps: any defect → ≤ 9.5 (Gem Mint 10 tolerates one slight print
spot only); 2+ defects → ≤ 8.5; 2+ worn corners → ≤ 7; dinged → ≤ 5; rounded → ≤ 4, more rounded → ≤ 3; edge
notching → ≤ 6, chipping → ≤ 5; print spots → ≤ 7, heavy → ≤ 2; scratching/dents → ≤ 5, severe → ≤ 3; gloss loss
→ ≤ 5, scuffing → ≤ 2; any stain → ≤ 7, moderate → ≤ 3; crease: one very slight → ≤ 5, more → ≤ 4, stronger → ≤ 3,
heavy → ≤ 2, extreme → 1; tear → ≤ 4, moderate → ≤ 2. Pristine label only at 50/50 with no defects.

**TAG** — no conversion; the engine's own result.

### 3.3 Known open items

- BGS's subgrade combination formula is unpublished; the rule above is the widely reported one.
- SGC publishes no back-centering tolerance; the engine constrains only the front for SGC.
- PSA's 5 % front leeway for 7+ is not modelled.
- The owner intends to collapse these into one shared rule set plus a per-company differences table (see the
  plan doc). Do that with the `sources/*` files open; nothing else counts as evidence.

---

## 4. Output schema (every path returns this)

```
{
  schemaVersion, gradedAt, gradePath: "software" | "ai" | "deep",
  cardInfo:     { name, setName, cardNumber, rarity, year, hp, variant, language },
  imageQuality: { front: { glareLevel, blurLevel, glareLocations[] }, back: {...}, overall, warning },
  centering:    { source: "manual", front: { lrRatio, tbRatio, devLR, devTB, maxDev }, back: {...} | null },
  defects:      { counts: { total, corner, edge, surface, frontTotal, backTotal }, items: [ { id, side, type, severity, location, x, y, width, height, description, deduction } ] },
  subgrades:    { frontCentering, backCentering, frontCorners, backCorners, frontEdges, backEdges, frontSurface, backSurface },   // 0–100
  overall:      { score, grade, label, displayGrade, capsApplied[], minSubgrade: { key, value } },
  companyGrades:{ tag: { grade, label, displayGrade, score }, psa, bgs, cgc, sgc: { grade, label, displayGrade, subgrades } },
  summary:      { positives[], concerns[], recommendation },
  confidence:   { value 0–1, factors[] },
  meta:         { engineVersion, model, gradeMode, providers, referencesUsed, elapsedMs, ... }
}
```

Invariants asserted in tests: all 8 subgrade keys present (back may be null only in front-only mode);
`overall.grade ≤ grade(min subgrade)`; every defect type/severity in the vocabulary above; `counts.total ===
items.length`; `companyGrades.tag.grade === overall.grade`; every company grade in that company's allowed steps;
`confidence.value ∈ [0, 1]`; `centering.source === "manual"`.

---

### Saved cards

A saved scan keeps the software result in its own columns (`dings`, `subgrades`, `company_grades`,
`front_centering`, `back_centering`) and the paid results in `ai_grades` / `ai_condition` / `ai_summary` /
`ai_centering`, standard AI at the top level and Deep AI under `__deep__`. `ai_condition` holds the record
`{ subgrades, overall, confidence, defects: { counts, items }, centering, gradedAt }`, so the defect boxes are
available to the damage report later. `src/lib/grade-records.js` is the only code that writes or reads this shape;
the Grade tab, the collection view and its re-grade buttons all go through it.

## 5. UI metadata

`src/utils/gradingScales.js` derives names, colours, allowed steps, labels and the per-grade centering limits
("TAG 10 threshold: 55/45" in the centering tab) **from the engine's exported tables**. It holds no numbers of its
own beyond colours and display names. Software-path confidence (photo sharpness/glare/darkness heuristic) lives in
`src/lib/softwareGrade.js`.

---

## 6. Change policy

1. A company number changes only when its `sources/*` capture changes; re-capture the page, diff, then edit the
   engine and this document together.
2. Internal values (deductions, compounding, caps, merge weights, BGS/CGC combination rules) change only with a
   harness run against DIG reports (`scripts/harness/run.mjs`) showing the improvement.
3. `npm run test:lib` must stay green; add a check for every rule you touch.
4. Do not create a second document. Extend this one.
