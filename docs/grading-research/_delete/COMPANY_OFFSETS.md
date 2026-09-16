# SLABSENSE COMPANY CONVERSION LAYER — CANONICAL REFERENCE
**Version 1.0 | How TAG-baseline scores become PSA / BGS / CGC / SGC grades.**

> **What this is:** The rules for converting SlabSense's 8 internal subgrades (0–100,
> TAG-baseline, defined in `GRADING_SCALE.md`) into each grading company's native
> subgrades and final grade. This is NOT a flat offset table — each company's own
> combination algorithm is re-run on our subgrades, which is more accurate.
>
> **Where it lives:** Project root `/docs/COMPANY_OFFSETS.md`
>
> **What it does:** Defines, per company: (1) how our 0–100 subgrades map to their
> subgrade scale, (2) their combination rule, (3) their allowed final grades, (4) their
> centering thresholds. The UI shows company-native numbers when that company is
> selected; our raw 0–100 subgrades appear only in the Damage Report.
>
> **Source docs:** `PSA_DEFECT_WEIGHTS.md`, `BGS_DEFECT_WEIGHTS.md`,
> `CGC_DEFECT_WEIGHTS.md`, `SGC_DEFECT_WEIGHTS.md`, `TAG_DEFECT_SCORING.md`,
> `TAG_DEFECT_WEIGHTS.md`.

---

## 1. PIPELINE OVERVIEW

```
8 internal subgrades (0–100)           [GRADING_SCALE.md]
        │
        ├─► TAG     : overall.score ×10 → 1000-pt score → TAG grade table
        ├─► PSA     : 4 merged subgrades → PSA centering tables → LOWEST WINS
        ├─► BGS     : 4 merged subgrades → BGS 1–10 subgrades → 0.5 RULE
        ├─► CGC     : 4 merged subgrades → HOLISTIC (centering compensatable)
        └─► SGC     : 4 merged subgrades → LOWEST WINS (strict back centering)
```

### 1.1 Merging 8 → 4 subgrades

PSA/BGS/CGC/SGC evaluate 4 categories (centering, corners, edges, surface) considering
both sides. Merge our 8 with front-weighted averaging — EXCEPT centering, which each
company thresholds per-side (front and back have separate tables):

```javascript
// EXACT function names — keep these call-outs when wiring in.
function mergeSubgrades(sub) {
  return {
    corners: sub.frontCorners * 0.65 + sub.backCorners * 0.35,
    edges:   sub.frontEdges   * 0.65 + sub.backEdges   * 0.35,
    surface: sub.frontSurface * 0.65 + sub.backSurface * 0.35
    // centering handled per-side via company threshold tables, NOT merged
  };
}
```

### 1.2 Converting a merged 0–100 to a company subgrade (1–10 scale)

```javascript
// Universal condition-subgrade conversion (corners/edges/surface).
// score/10 then snap DOWN to the company's allowed subgrade steps.
function toCompanySubgrade(score100, company) {
  const raw = score100 / 10;                  // 95 → 9.5
  return snapDown(raw, ALLOWED_SUBGRADES[company]);
}

const ALLOWED_SUBGRADES = {
  psa: [1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,10],      // no 9.5
  bgs: [1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,9.5,10],
  cgc: [1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,9.5,10],
  sgc: [1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,6.5,7,7.5,8,8.5,9,9.5,10]
};
```

`snapDown(9.7, psa)` → 9. `snapDown(9.7, bgs)` → 9.5. Strict bias, always down.

### 1.3 Centering subgrade per company

Centering converts via each company's published deviation thresholds (Sections 3–6),
using `centering.front.maxDev` and `centering.back.maxDev` from the output schema.
Deviation = `|ratio − 50|` (a 55/45 card = 5% dev). The centering subgrade is the
HIGHEST grade whose front AND back thresholds are both satisfied.

---

## 2. TAG (baseline — no conversion)

- `companyGrades.tag.score` = `overall.score × 10` (rounded int, 0–1000)
- `companyGrades.tag.grade` = `overall.grade` (always identical by definition)
- Grade table: `GRADING_SCALE.md` §6. No 9.5. 10 splits into Gem Mint (950–989) and
  Pristine (990–1000).

---

## 3. PSA — Lowest Score Wins

**Algorithm:** `psaGrade = min(centering, corners, edges, surface)` then apply caps.

### 3.1 Centering thresholds (front dev / back dev, max allowed)

| PSA Grade | Front Dev ≤ | Back Dev ≤ |
|-----------|-------------|------------|
| 10 | 5.0 (55/45) | 25.0 (75/25) |
| 9 | 10.0 (60/40) | 40.0 (90/10) |
| 8 | 15.0 (65/35) | 40.0 |
| 7 | 20.0 (70/30) | 40.0 |
| 6 | 30.0 (80/20) | 40.0 |
| 5 | 35.0 (85/15) | 40.0 |
| ≤4 | worse | worse |

### 3.2 Hard caps
- **Any crease (any size): PSA grade ≤ 6.** Heavy crease → ≤ 4.
- Any `extreme` severity defect → ≤ 5.

### 3.3 Notes
- PSA has no 9.5 — a 9.5-quality card is a PSA 9.
- One minor flaw total = ceiling 9; zero defects required for 10.
  Implement as: if `defects.counts.total ≥ 1` (excluding NHOD-level) → PSA ≤ 9;
  if ≥ 3 → PSA ≤ 8.

---

## 4. BGS — Four Subgrades + 0.5 Rule

**Algorithm:**
1. Compute four BGS subgrades (centering via §4.1, others via §1.2).
2. `lowest = min(four subgrades)`
3. If two or more subgrades tie at `lowest` → final = `lowest`.
4. Else final = `lowest + 0.5`, but never more than 2.0 above `lowest`, and never above
   the second-lowest subgrade.
5. Snap to BGS allowed grades.

### 4.1 Centering thresholds

| BGS Subgrade | Front Dev ≤ | Back Dev ≤ |
|--------------|-------------|------------|
| 10 | 0.0 (50/50) | 0.0 (50/50) |
| 9.5 | 5.0 (55/45) | 10.0 (60/40) |
| 9 | 10.0 (60/40) | 15.0 (65/35) |
| 8.5 | 12.0 (62/38) | 20.0 (70/30) |
| 8 | 15.0 (65/35) | 25.0 (75/25) |
| 7 | 20.0 (70/30) | 30.0 (80/20) |
| 6 | 25.0 (75/25) | 35.0 (85/15) |

### 4.2 Labels
- **Black Label 10:** all four subgrades = 10.
- **Gold Label 10 (Pristine):** three 10s + one 9.5.
- Output BGS subgrades in `companyGrades.bgs.subgrades` (the UI shows them like a real
  BGS label when BGS is selected).

### 4.3 Strictness adjustment
BGS corners/surface are graded under magnification — apply a −0.5 step to the BGS
corner subgrade if ANY corner defect exists (even one minor), reflecting "single dinged
corner takes a potential 10 to 8-or-lower" behavior: a corner with a `moderate`+ defect
caps the BGS corners subgrade at 8.

---

## 5. CGC — Holistic (centering compensatable)

**Algorithm:**
1. Compute four subgrades (centering via §5.1).
2. `base = min(corners, edges, surface)` — condition still uses lowest-factor.
3. **Centering compensation:** if centering subgrade < base, final =
   `max(centering, base − 1.0)` — i.e., good condition can pull a card up to 1.0 grade
   above what its centering alone would give, but never above the condition subgrades.
   If centering ≥ base, final = base.
4. Snap to CGC allowed grades.

### 5.1 Centering thresholds

| CGC Grade | Front Dev ≤ | Back Dev ≤ |
|-----------|-------------|------------|
| 10 Pristine | 0.0 (50/50) | 0.0 (50/50) |
| 10 Gem Mint | 5.0 (55/45) | 25.0 (75/25) |
| 9.5 / 9 | 10.0 (60/40) | 40.0 (90/10) |
| 8.5 / 8 | 15.0 (65/35) | 15.0 (65/35) |
| 7.5 / 7 | 20.0 (70/30) | 20.0 (70/30) |
| 6.5 / 6 | beyond 20.0 | — |

### 5.2 Hard caps
- Visible crease (front, moderate+) → ≤ 7. Visible fold/bend → ≤ 5.
- Pristine 10 requires perfect 50/50 both sides AND zero visible defects.
- 9.5 vs 9 split: 9.5 requires zero defects above `minor` and at most 1 minor; else 9.

---

## 6. SGC — Lowest Factor, Strict Back Centering

**Algorithm:** `sgcGrade = min(centering, corners, edges, surface)` with compounding
penalty: if 3+ categories each have at least one defect, subtract an additional 0.5.

### 6.1 Centering thresholds

| SGC Grade | Front Dev ≤ | Back Dev ≤ |
|-----------|-------------|------------|
| 10 Pristine | 0.0 (50/50) | 0.0 (50/50) |
| 10 Gem Mint | 5.0 (55/45) | 20.0 (70/30) |
| 9.5 | 5.0 (55/45) | 5.0 (55/45) |
| 9 | 10.0 (60/40) | 10.0 (60/40) |
| 8.5 / 8 | 15.0 (65/35) | 15.0 (65/35) |
| 7.5 / 7 | 20.0 (70/30) | 20.0 (70/30) |

Note the SGC quirk: 9.5 back centering (55/45) is STRICTER than Gem Mint 10 back
(70/30) — faithful to their published scale.

### 6.2 Labels
- **Gold Label = Pristine 10 only** (perfect 50/50 both sides, zero visible defects).

---

## 7. OUTPUT REQUIREMENTS

Populates `companyGrades` in `GRADING_OUTPUT_SCHEMA.md` §8. Required per company:
`grade`, `label`, `displayGrade`; BGS additionally `subgrades{centering,corners,edges,surface}`;
TAG additionally `score` (1000-pt).

**UI behavior (for reference):** company selector switches ALL displayed numbers
(final grade + per-area subgrades) to that company's native scale. The raw 0–100
internal subgrades appear ONLY in the Damage Report ("Edges 95/100" + defect list
explaining the deduction).

To support per-area display for every company, also emit native-scale subgrades for
PSA/CGC/SGC (not just BGS) using §1.2/§1.3 — same fields as BGS's `subgrades` object.

---

## 8. EXACT CALL-OUTS (keep these names)

| Function | Purpose |
|----------|---------|
| `mergeSubgrades(sub)` | 8 → 3 condition subgrades (front-weighted 0.65/0.35) |
| `toCompanySubgrade(score100, company)` | 0–100 → company subgrade with snap-down |
| `centeringSubgrade(maxDevF, maxDevB, company)` | Deviation → company centering subgrade |
| `convertToCompany(subgrades, centering, defects, company)` | Full conversion, returns `companyGrades[company]` object |
| `snapDown(raw, allowedList)` | Strict-bias rounding |

---

## 9. KNOWN APPROXIMATIONS (calibrate later)

1. The 0.65/0.35 front/back merge weight is an estimate consistent with TAG's ~1.5x
   front weighting; companies don't publish theirs.
2. CGC's 1.0-grade compensation allowance is an interpretation of "holistic."
3. BGS's magnification strictness (−0.5 corners step) is behavioral, not published.
4. SGC's 3-category compounding penalty (−0.5) approximates their "multiple defects
   compound" rule.
5. All centering tables transcribe each company's published ratios; PSA's reflect the
   Q1-2025 tightening (10 = 55/45 front).

Validate all of the above against real crossover-graded cards when available
(cards graded by 2+ companies are the gold standard for tuning this layer).

---

## 10. CHANGE LOG
- **v1.0** — Initial conversion layer. Replaces any flat-offset logic.
