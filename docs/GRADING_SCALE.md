# SLABSENSE GRADING SCALE — CANONICAL REFERENCE
**Version 1.0 | This document is the SINGLE SOURCE OF TRUTH for all grading math.**

> **What this is:** The unified 100-point grading system used by ALL THREE grading paths
> (Software Grade, AI Grade, Deep AI Grade). Every scoring function, every AI prompt, and
> every UI display must match this document.
>
> **Where it lives:** Project root `/docs/GRADING_SCALE.md`
>
> **What it does:** Defines subgrade categories, deduction weights, severity multipliers,
> the final-grade combination formula, rounding rules, per-company allowed grades, hard
> caps, and forbidden AI behaviors. If code or prompts disagree with this file, the code
> or prompts are wrong.
>
> **Baseline:** TAG's published 1000-point system (see `TAG_DEFECT_WEIGHTS.md`), rescaled
> to 100 points per category. TAG score ÷ 10 = SlabSense score. Other companies (PSA, BGS,
> CGC, SGC) are derived from the same 8 subgrades using each company's own combination
> rule (see `COMPANY_OFFSETS.md`).

---

## 1. THE 8 SUBGRADE CATEGORIES

Every card is scored in 8 independent categories. **Each category starts at 100 points.**
Deductions are subtracted per defect. No category can go below 10.

| # | Category | Key Name (use EXACTLY this in code/JSON) |
|---|----------------|------------------------------------------|
| 1 | Front Centering | `frontCentering` |
| 2 | Back Centering | `backCentering` |
| 3 | Front Corners | `frontCorners` |
| 4 | Back Corners | `backCorners` |
| 5 | Front Edges | `frontEdges` |
| 6 | Back Edges | `backEdges` |
| 7 | Front Surface | `frontSurface` |
| 8 | Back Surface | `backSurface` |

**Scale conversion:** SlabSense 0–100 maps 1:1 to TAG 0–1000 (×10).
A SlabSense 95 = TAG 950 = Gem Mint threshold.

---

## 2. CENTERING DEVIATION — STANDARD DEFINITION

**There is exactly ONE definition of centering deviation in this project:**

```
deviation = |ratio − 50|
```

- A 55/45 card has a **5.0% deviation**.
- A 60/40 card has a **10.0% deviation**.
- A 70/30 card has a **20.0% deviation**.

⚠️ **FORBIDDEN:** The formula `|L−R| / (L+R)` is NOT used anywhere. It produces values
~2x larger and was an error in the old `grading-calibration.json`. Any file containing
that formula is wrong and must be corrected.

Centering is measured by the **user's manual centering tool** at upload time. The AI
NEVER estimates centering. The AI receives the measured numbers and scores them using
the table below.

### Centering Score Table (TCG cards — Pokemon, MTG, etc.)

Worst axis (L/R or T/B) determines the score for that side.

| Front Deviation | Front Score | Back Deviation | Back Score |
|-----------------|-------------|----------------|------------|
| ≤ 2.0% | 99.5 | ≤ 2.0% | 99.5 |
| ≤ 5.0% | 97.0 | ≤ 15.0% | 97.0 |
| ≤ 7.0% | 92.0 | ≤ 20.0% | 92.0 |
| ≤ 12.5% | 86.0 | ≤ 25.0% | 86.0 |
| ≤ 15.0% | 82.5 | ≤ 35.0% | 82.5 |
| ≤ 17.5% | 77.5 | > 35.0% | 70.0 |
| ≤ 20.0% | 72.5 | | |
| ≤ 22.5% | 67.5 | | |
| ≤ 25.0% | 62.5 | | |
| ≤ 30.0% | 52.5 | | |
| > 30.0% | 40.0 | | |

(Derived from TAG's published TCG centering tables, ÷10. Sports card table differs —
see `TAG_DEFECT_WEIGHTS.md` if sports support is added later.)

---

## 3. DEFECT DEDUCTIONS

Each defect deducts points from its category score using:

```
deduction = BASE[type] × SEVERITY[severity] × SIDE[side] × DIMINISH(index)
```

### 3.1 Base Deductions (points on the 100 scale)

| Type Key (use EXACTLY) | Defect Type | Base |
|------------------------|----------------------------------|------|
| `CORNER` | Corner wear/ding/fray | 4.0 |
| `EDGE` | Edge wear/chip/nick | 5.0 |
| `SCRATCH` | Surface scratch | 2.5 |
| `DENT` | Dent / indentation | 6.0 |
| `PRINT_DEFECT` | Print line / ink spot / speck | 3.0 |
| `CREASE` | Crease / wrinkle / bend | 12.0 |
| `PLAY_WEAR` | General play wear / scuffing | 3.5 |
| `PIT` | Surface pit | 5.0 |
| `STAIN` | Stain / water damage | 20.0 |
| `TEAR` | Tear / rip / missing stock | 30.0 |

### 3.2 Severity Multipliers

| Severity Key | Multiplier | Meaning |
|--------------|-----------|---------|
| `minor` | 1.0 | Visible under close inspection / magnification only |
| `moderate` | 2.5 | Clearly visible at arm's length |
| `severe` | 5.0 | Obvious at a glance, structural impact |
| `extreme` | 8.0 | Major damage, card integrity compromised |

### 3.3 Side Multipliers

| Side | Multiplier |
|------|-----------|
| `FRONT` | 1.0 |
| `BACK` | 0.7 |

(Front matters more. 0.7 back ≈ TAG's "front weighted ~1.5x" rule, since 1/1.5 ≈ 0.67.)

### 3.4 Diminishing Returns (per category)

Defects within the SAME category compound with diminishing returns, ordered
worst-deduction-first:

```
DIMINISH(index) = 1 / (1 + index × 0.15)    // index 0 for worst defect, 1 for next...
```

### 3.5 Reference: Single-Defect Outcomes (front, no diminishing)

| Defect | minor | moderate | severe | extreme |
|--------------|-------|----------|--------|---------|
| CORNER | −4 | −10 | −20 | −32 |
| EDGE | −5 | −12.5 | −25 | −40 |
| SCRATCH | −2.5 | −6.25 | −12.5 | −20 |
| CREASE | −12 | −30 | −60 | −96 |
| STAIN | −20 | −50 | −100* | −100* |
| TEAR | −30 | −75 | −100* | −100* |

\* Category floor is 10, so max effective deduction is −90.

**Sanity anchors:**
- 1 minor front corner touch → frontCorners 96 → consistent with TAG dropping Pristine but keeping Gem Mint.
- 1 moderate crease → surface 70 → grade ~7 cap territory, consistent with crease rules.
- 1 severe tear → surface ≤ 10 → grade 1 region. **The full 1–10 range is reachable.**

---

## 4. FINAL GRADE COMBINATION (TAG-style compounding)

TAG **compounds** — it does not average. The lowest subgrade dominates.

```
overall = (min(all 8 subgrades) × 0.75) + (mean(all 8 subgrades) × 0.25)
```

Then apply **hard caps** (Section 5), take the lower of the two, and convert to a grade
via Section 6.

⚠️ The overall displayed grade may NEVER exceed the grade implied by the lowest
subgrade. `overall_grade ≤ grade(min(subgrades))` is an invariant — assert it in code.
**Implementation (MIN_SUBGRADE_CLAMP):** after the formula and hard caps, the overall
score is clamped to the band CEILING of the lowest subgrade's grade band (lowest
subgrade 94.4 sits in the 90–94.9 Mint band → overall score clamped to 94.99 → grade
9). Matches TAG's real behavior (10/10/10/9 → 9) and keeps the 1000-pt score coherent
with the displayed grade. The mean term differentiates scores WITHIN a band, never
across bands. Implemented in `gradingEngine.js` → `applyCaps()`.

---

## 5. HARD CAPS (applied AFTER the formula)

| Condition | Max Overall Score (Grade) |
|-----------------------------------------------|---------------------------|
| Any visible crease (moderate+) | 60 (grade 6) |
| Any tear, any severity | 40 (grade 4) |
| Stain, severe or extreme | 50 (grade 5) |
| Any single defect of `extreme` severity | 50 (grade 5) |
| 5+ total defects (any mix, excludes centering) | 85 (grade 8.5) |
| Any corner OR edge defect (≥minor) | 98.9 (blocks Pristine) |

Pristine (≥99) additionally requires: front centering dev ≤ 2%, back dev ≤ 2%, zero
corner defects, zero edge defects, max 3 minor surface defects.

---

## 6. SCORE → GRADE CONVERSION (TAG baseline)

| Score | Grade | Label |
|----------|-------|-----------|
| 99–100 | 10P | Pristine |
| 95–98.9 | 10 | Gem Mint |
| 90–94.9 | 9 | Mint |
| 85–89.9 | 8.5 | NM-MT+ |
| 80–84.9 | 8 | NM-MT |
| 75–79.9 | 7.5 | NM+ |
| 70–74.9 | 7 | NM |
| 65–69.9 | 6.5 | EX-MT+ |
| 60–64.9 | 6 | EX-MT |
| 55–59.9 | 5.5 | EX+ |
| 50–54.9 | 5 | EX |
| 45–49.9 | 4.5 | VG-EX+ |
| 40–44.9 | 4 | VG-EX |
| 35–39.9 | 3.5 | VG+ |
| 30–34.9 | 3 | VG |
| 25–29.9 | 2.5 | Good+ |
| 20–24.9 | 2 | Good |
| 15–19.9 | 1.5 | Fair |
| 0–14.9 | 1 | Poor |

**Rounding rule:** truncate to the band — a 94.9 is a 9, never rounded up to 10.

### Allowed grades per company (rounding targets for the offset layer)

| Company | Allowed Grades |
|---------|----------------|
| TAG | 1, 1.5, 2, 2.5 … 8.5, 9, 10 (Gem), 10P — **NO 9.5** |
| PSA | 1, 1.5, 2 … 8.5, 9, 10 — **NO 9.5** |
| BGS | 1–10 with all half grades incl. 9.5; 10 Gold; 10 Black |
| CGC | 1–9.5 with half grades; 10 (Gem); 10 (Pristine) |
| SGC | 1, 1.5 … 9.5, 10 (Gem), 10 (Pristine/Gold) |

When converting, snap DOWN to the nearest allowed grade for that company (strict bias).

---

## 7. ORDER OF OPERATIONS (applies to AI prompts AND software)

1. **Inspect & report EVERY defect** — all corners, all edges, full surface, front AND back.
2. Score the 6 condition subgrades (corners/edges/surface × front/back).
3. **Centering is scored LAST**, from the provided manual-tool measurements only.
4. Combine via Section 4 formula, apply Section 5 caps, convert via Section 6.
5. Output the unified JSON schema (see `GRADING_OUTPUT_SCHEMA.md`) — identical for all
   three grading paths.

---

## 8. FORBIDDEN BEHAVIORS (for AI prompts — preserve these on every prompt edit)

1. **NEVER stop reporting defects early.** Even if one category already caps the grade,
   ALL defects must be found, listed, and scored. A centering-7 card with corner damage
   must still report every corner defect.
2. **NEVER re-estimate centering.** Use the provided measured values. No exceptions.
3. **NEVER floor the output range.** Grades 1–5 are valid outputs. A destroyed card is a
   1, not a 6. If guidelines list defect examples down to grade 3, that is not a floor.
4. **NEVER use the formula `|L−R|/(L+R)` for centering deviation.**
5. **NEVER average subgrades** to get the overall — use the compounding formula.
6. **NEVER let glare count as a defect** — but never let real whitening be dismissed as
   glare either. Decision rule: exposed paper fibers = defect; smooth bright reflection = glare.
7. **NEVER output a grade above the lowest subgrade's implied grade.**
8. **NEVER change key names** (`frontCorners`, `CORNER`, `minor`, etc.). They are API
   contract values.

---

## 9. WORKED EXAMPLES

### Example A — Two visible print lines → Mint 9 (clamp in action)
Centering: front 1.7% dev → 99.5; back 2.0% dev → 99.5.
Defects: 2 minor front print lines: −3.0, −3.0×0.87 = −2.6 → frontSurface 94.4.
All 8 subgrades = [99.5, 99.5, 100, 100, 100, 100, 94.4, 100].
`min = 94.4`, `mean = 99.2` → formula = 95.6, BUT the lowest subgrade (94.4) sits in
the Mint band (90–94.9), so MIN_SUBGRADE_CLAMP pulls the score to 94.99 →
**Grade 9 Mint (TAG score 949)**.
→ Demonstrates: TWO visible print lines = Mint, not Gem. ONE minor print line
(−3 → frontSurface 97) keeps the card Gem Mint. And marks invisible without
magnification (NHOD level) are NOT logged as defects at all — that's how clean
cards still reach Pristine.

### Example B — Mid-grade 8
Centering: front 6.2% → 92.0; back 13.6% → 97.0.
Defects: 1 moderate front corner (−10 → frontCorners 90), 1 moderate front edge
(−12.5 → frontEdges 87.5), 1 minor back surface scratch (−2.5×0.7 = −1.75 →
backSurface 98.25).
Subgrades: [92, 97, 90, 100, 87.5, 100, 100, 98.25].
`min = 87.5`, `mean = 95.6` → overall = 87.5×0.75 + 95.6×0.25 = **89.5 → 8.5**.
No caps triggered. Final: **8.5 NM-MT+**.

### Example C — Destroyed card → Grade 1
Centering: front 12% → 86; back 8% → 97.
Defects (front surface): extreme crease (−96 → floor 10), severe stain
(−100×0.87 → already floored at 10). Front corners: 4× severe (−20, −17.4, −15.4,
−13.8 → 33.4). Front edges: 2× severe (−25, −21.7 → 53.3).
Subgrades: [86, 97, 33.4, 100, 53.3, 100, 10, 100].
`min = 10`, `mean = 72.5` → formula = 25.6; hard caps (extreme → 50, crease → 60,
5+ defects → 85) don't bite further, but the lowest subgrade (10) sits in the Poor
band (0–14.9), so MIN_SUBGRADE_CLAMP pulls the score to 14.99 →
**Grade 1 Poor (TAG score 149)**.
→ Demonstrates: a card with an extreme crease, a severe stain, four trashed corners,
and chipped edges is a **1**. The full 1–10P range is reachable. No more 6s for
destroyed cards. All 8 defects are still individually reported.

---

## 10. SOURCE PROVENANCE

| Section | Source | Status |
|---------|--------|--------|
| Deduction formula, base values, severity/side multipliers, diminishing returns (§3) | `TAG_DEFECT_SCORING.md` — **TAG's published rubric** (taggrading.com/pages/rubric) | Authoritative |
| Centering deviation score tables (§2) | `TAG_DEFECT_WEIGHTS.md` — earlier TAG site scrape | Best available; not on current rubric page — re-verify if TAG updates |
| Compounding formula min×0.75 + mean×0.25 (§4) | `TAG_DEFECT_WEIGHTS.md` — earlier scrape | TAG does not publish their combination math; validate against the 509-card reference set |
| Grade-score table incl. half grades (§6) | `TAG_DEFECT_WEIGHTS.md` (complete table); rubric scrape omitted half-grade rows | Half grades 8.5→1 confirmed real |
| Hard caps for tears/stains/extreme (§5) | SlabSense interpolation from rubric deduction ranges | **Calibrate against 509-card reference set** |

## 11. CHANGE LOG
- **v1.0** — Initial canonical scale. Supersedes the 125-point subgrade system in
  `computeGrade()`. Built on TAG's published rubric (`TAG_DEFECT_SCORING.md`) for all
  deduction math; older scrape (`TAG_DEFECT_WEIGHTS.md`) fills gaps the rubric doesn't
  publish (centering tables, combination formula, half-grade score bands).
  Coordinate/zone sections of `TAG_DEFECT_SCORING.md` and `COORDINATE_MAPPING.md`
  remain valid and unchanged.
