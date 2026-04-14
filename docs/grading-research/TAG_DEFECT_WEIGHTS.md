# TAG Card Grading - Defect Weights & 1000-Point Scoring System

## Overview

TAG (Technical Authentication and Grading) uses a **1000-point internal scale** with **8 subgrades** evaluated independently. They use a **compounding system** (NOT averaging) where the lowest subgrade heavily influences the final score.

---

## The 8 Subgrades

TAG evaluates these 8 categories separately:

1. **Front Centering** - L/R and T/B alignment on front
2. **Back Centering** - L/R and T/B alignment on back
3. **Front Corners** - All 4 corners on front
4. **Back Corners** - All 4 corners on back
5. **Front Surface** - Gloss, scratches, pits, stains
6. **Back Surface** - Same for back
7. **Front Edges** - Edge condition, fraying
8. **Back Edges** - Same for back

**Critical:** Front defects are weighted MORE than back (~1.5x multiplier).

---

## 1000-Point Scale to Grade Mapping

| TAG Score | Grade | Name |
|-----------|-------|------|
| 990-1000 | 10 | **Pristine** |
| 950-989 | 10 | **Gem Mint** |
| 900-949 | 9 | Mint |
| 850-899 | 8.5 | NM-MT+ |
| 800-849 | 8 | NM-MT |
| 750-799 | 7.5 | NM+ |
| 700-749 | 7 | NM |
| 650-699 | 6.5 | EX-MT+ |
| 600-649 | 6 | EX-MT |
| 550-599 | 5.5 | EX+ |
| 500-549 | 5 | EX |
| 450-499 | 4.5 | VG-EX+ |
| 400-449 | 4 | VG-EX |
| 350-399 | 3.5 | VG+ |
| 300-349 | 3 | VG |
| 250-299 | 2.5 | Good+ |
| 200-249 | 2 | Good |
| 150-199 | 1.5 | Fair |
| 100-149 | 1 | Poor |

**Key:** Each 50-point increment = 0.5 grade increase

---

## Centering Requirements

TAG has DIFFERENT requirements for Sports Cards vs TCG (Pokemon, etc.):

### Sports Cards

| Grade | Front | Back |
|-------|-------|------|
| 10 Pristine | 51/49 | 54.5/45.5 |
| 10 Gem Mint | 55/45 | 70/30 |
| 9 Mint | 57/43 | 75/25 |
| 8.5 | 62.5/37.5 | 95/5 |
| 8 | 65/35 | 95/5 |
| 7.5 | 67.5/32.5 | 95/5 |
| 7 | 70/30 | 95/5 |
| 6 | 75/25 | 95/5 |
| 5 | 80/20 | 95/5 |
| 3 | 90/10 | 95/5 |

### TCG Cards (Pokemon, MTG, etc.)

| Grade | Front | Back |
|-------|-------|------|
| 10 Pristine | 52/48 | 52/48 |
| 10 Gem Mint | 55/45 | 65/35 |
| 9 Mint | 57/43 | 70/30 |
| 8.5 | 62.5/37.5 | 85/15 |
| 8 | 65/35 | 85/15 |
| 7 | 70/30 | 85/15 |
| 6 | 75/25 | 85/15 |
| 5 | 80/20 | 85/15 |
| 3 | 90/10 | 85/15 |

**Key difference:** TCG cards are stricter on back centering than sports cards.

---

## Centering Score Mapping (1000-Point)

### Front Centering → Score (TCG)

| Max Offset | Score | Grade Equivalent |
|------------|-------|------------------|
| ≤52% | 995 | Pristine |
| ≤55% | 970 | Gem Mint 10 |
| ≤60% | 920 | Mint 9 |
| ≤62.5% | 860 | NM-MT+ 8.5 |
| ≤65% | 825 | NM-MT 8 |
| ≤67.5% | 775 | NM+ 7.5 |
| ≤70% | 725 | NM 7 |
| ≤72.5% | 675 | EX-MT+ 6.5 |
| ≤75% | 625 | EX-MT 6 |
| ≤80% | 525 | EX 5 |
| >80% | 400 | Below 5 |

### Back Centering → Score (TCG - more lenient)

| Max Offset | Score | Grade Equivalent |
|------------|-------|------------------|
| ≤52% | 995 | Pristine |
| ≤65% | 970 | Gem Mint 10 |
| ≤75% | 920 | Mint 9 |
| ≤85% | 825 | NM-MT 8 |
| >85% | 700 | Lower |

---

## Defect Point Deductions (Reverse-Engineered)

Based on DIG report patterns and code analysis:

### Surface Defects (Most Impactful)

| Defect | Point Deduction |
|--------|-----------------|
| Minor imperfection (tiny scratch, light print line) | -20 to -50 |
| Visible surface wear (scuff, visible scratch) | -50 to -150 |
| Major surface defect (crease, dent, stain) | -150 to -400 |
| Multiple surface defects/play wear | -300+ |

### Corner Wear

| Defect | Point Deduction |
|--------|-----------------|
| Light corner touch | -20 to -40 |
| Visible corner wear | -50 to -100 |
| Significant corner fraying | -100 to -200 |

### Edge Wear

| Defect | Point Deduction |
|--------|-----------------|
| Minor edge wear | -20 to -40 |
| Visible edge wear | -50 to -100 |
| Edge chipping/whitening | -100 to -200 |

### Centering Off

| Centering | Point Deduction | Result |
|-----------|-----------------|--------|
| 56-60/44-40 | -50 to -100 | Mint 9 range |
| 61-65/39-35 | -100 to -150 | NM-MT 8-8.5 range |
| 66-70/34-30 | -150 to -250 | NM 7-7.5 range |

### Front vs Back Multiplier

- **Front defects:** 1.5x deduction multiplier
- **Back defects:** 1.0x deduction multiplier

---

## The DINGS System

### What are DINGS?

**DINGS = "Defects Identified of Notable Grade Significance"**

- Only defects that **directly impacted the grade** are classified as DINGS
- Minor flaws that don't affect grade are NOT listed
- Not all DINGS are equal weight - severity matters

### Typical DINGS Patterns

| Final Grade | Typical DINGS Count | Common Types |
|-------------|---------------------|--------------|
| 10 | 0 | None |
| 9 | 1 | Centering only |
| 8 | 4 | Back corner/edge issues, no surface |
| 7 | 5 | Front surface + ink + edge, back corners |
| 6 | 4 | Front surface, back corner/edge |
| 5 | 6+ | Front+back surface, all corners+edges |

---

## Compounding Algorithm

### Key Principle: "Scores COMPOUND, not average"

TAG does NOT average subgrades. Instead:
- Every deduction across all 8 categories is applied
- **Final grade cannot exceed lowest significant subgrade**
- Dramatically lower subgrades heavily weight the result

### Approximate Formula

```
Final Score ≈ min(frontCenter, backCenter, condition) × 0.75
              + average(all subgrades) × 0.25
```

### Examples

| Subgrades | Simple Average | TAG Result | Why |
|-----------|----------------|------------|-----|
| C:9.5, Co:9, S:9, E:8.5 | 9.0 | **8.5** | Pulled down by lowest (8.5 edges) |
| C:10, Co:10, S:10, E:9 | 9.75 | **9** | Cannot exceed lowest significant |
| All 9.5+ | 9.5+ | **10 Gem** | Meets Gem Mint threshold |

### Critical Impact
- A card with 8.5-level corner wear = **8.5 overall** (regardless of other scores)
- A card with 9-level centering cannot achieve Gem Mint 10
- The 1000-point system allows granular differentiation within same grade

---

## Pristine vs Gem Mint Thresholds

### Pristine 10 (990-1000 points)

| Attribute | Requirement |
|-----------|-------------|
| **Centering** | Near perfect (51/49 front, 54.5/45.5 back sports; 52/48 both TCG) |
| **Corners** | Four sharp, crisp corners, virtually no visible wear |
| **Edges** | Virtually flawless, very minor fill/fray under magnification only |
| **Surface** | Flawless, only Non-Human Observable Defects (NHODs) |
| **Rarity** | Less than 1% of graded cards |

**NHODs:** Defects invisible to human eye, only visible under extreme magnification (40x+).

### Gem Mint 10 (950-989 points)

| Attribute | Requirement |
|-----------|-------------|
| **Centering** | 55/45 front, 70/30 back (sports) |
| **Corners** | Four sharp corners, may have 2 light touches max |
| **Edges** | Minor fill/fray, very minor wear under high-res only |
| **Surface** | Slight print imperfection under hi-res, very small pit, light scratch not penetrating gloss |

### What Drops Below Pristine (990)?

- Any centering worse than 51/49 front (sports) or 52/48 (TCG)
- Visible corner wear (even light fraying)
- Visible surface scratches/scuffs
- Any visible edge wear
- Multiple minor issues combined

---

## Defect Tolerances by Grade

### Grade 10 (Pristine - 990-1000)
- **Corners:** Four sharp, crisp corners, virtually no visible wear
- **Edges:** Virtually flawless, very minor fill/fray artifacts only under magnification
- **Surface:** Flawless, only NHODs acceptable
- **Centering:** Near perfect

### Grade 10 (Gem Mint - 950-989)
- **Corners:** Four sharp corners, minor fill/fray artifacts acceptable
- **Edges:** Minor fill/fray, very minor wear under high-res only
- **Surface:** Slight print imperfection under hi-res, very small pit, light scratch not penetrating gloss
- **Centering:** 55/45 front, 70/30 back (sports)

### Grade 9 (Mint - 900-949)
- **Corners:** Four sharp, up to two very light touches
- **Edges:** Minor edge wear, light fraying
- **Surface:** Few small pits/scratches (not penetrating gloss), minor print imperfections
- **Centering:** 57/43 front, 75/25 back

### Grade 8-8.5 (NM-MT)
- **Corners:** Sharp but potentially touched, some fray artifacts
- **Edges:** Minor edge wear, light fraying, small surface wear
- **Surface:** Minor scuffing, print lines, small pits
- **Centering:** 62.5-65/35 front

### Grade 7-7.5 (NM)
- **Corners:** Losing sharpness, visible wear on multiple corners
- **Edges:** Chipping and fraying visible
- **Surface:** Light dents, scuffing, gloss wear
- **Centering:** 67.5-70/30 front

### Grade 6-6.5 (EX-MT)
- **Corners:** Three+ significantly frayed, rounding starting
- **Edges:** Minor notches, significant fraying
- **Surface:** Light stains/wrinkles, scuffing, off focus

### Grade 5-5.5 (EX)
- **Corners:** All four rounded and dirty
- **Edges:** Heavy chipping and notches
- **Surface:** Larger wear areas, multiple wrinkles/stains, gloss loss

---

## DIG Report (Digital Imaging & Grading)

Every TAG card includes a detailed report showing:
- Overall TAG Score (1-1000 and 1-10)
- Breakdown of each attribute score
- All identified defects with locations
- High-res images with marked defects
- Population rankings

### DIG+ Premium adds:
- 1000-point sub-scores for each category
- 360-degree slab video
- Downloadable high-res images

---

## No 9.5 Grade

**TAG uses half points: 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5**

**NO 9.5 exists** - Instead:
- Grade 9 = Mint (900-949)
- Grade 10 = Gem Mint (950-989) OR Pristine (990-1000)

Why no 9.5? TAG says cards exceeding Mint are Gem Mint, and cards exceeding Gem Mint are Pristine.

---

## Key Insights

1. **8 subgrades evaluated independently** - front/back for each of 4 categories
2. **Front defects weighted 1.5x more** than back defects
3. **Compounding, not averaging** - lowest subgrade dominates
4. **Two types of 10** - Pristine (990-1000) vs Gem Mint (950-989)
5. **DINGS system** - only grade-affecting defects listed
6. **No 9.5 grade exists** - goes from 9 Mint to 10 Gem Mint
7. **TCG vs Sports** have different centering requirements
8. **Proprietary ML formula** - exact weights not publicly disclosed

---

## Sources

- [TAG Grading Scale](https://taggrading.com/pages/scale)
- [TAG Grading Rubric](https://taggrading.com/pages/rubric)
- [TAG DIG Report Help](https://help.taggrading.com/en/articles/6747781-what-is-the-tag-dig-report)
- [TAG Score Methodology](https://taggrading.com/pages/score)
- [TAG Conversion Guide](https://taggrading.com/pages/conversion)
- [Rarecandy - Collector's Guide to TAG](https://rarecandy.com/blog/collectors-guide-grading-with-tag)
- [Figoca - TAG Grading Review](https://figoca.com/grading-companies/tag)
- [How to Get Pristine 10](https://help.taggrading.com/en/articles/10573667-how-do-i-get-a-pristine-10-grade)
