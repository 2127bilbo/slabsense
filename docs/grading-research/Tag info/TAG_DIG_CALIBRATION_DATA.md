# TAG DIG Report Calibration Data

Compiled from research agents - April 2026

## Overview

TAG (Technical Authentication & Grading) uses a 1000-point scoring scale that correlates to industry-standard 1-10 grades. Each TAG graded card includes a Digital Imaging & Grading (DIG) Report accessible via QR code on the slab.

## TAG Score to Grade Mapping

| Score Range | Grade | Label | Description |
|-------------|-------|-------|-------------|
| 990-1000 | 10 | Pristine | Virtually flawless, <1% of cards |
| 950-989 | 10 | Gem Mint | Exceptional quality, minimal defects |
| 900-949 | 9 | Mint | Very minor defects only under magnification |
| 850-899 | 8.5 | NM-MT+ | Near Mint to Mint Plus |
| 800-849 | 8 | NM-MT | Near Mint to Mint |
| 750-799 | 7.5 | NM+ | Near Mint Plus |
| 700-749 | 7 | NM | Near Mint |
| 650-699 | 6.5 | EX-MT+ | Excellent-Mint Plus |
| 600-649 | 6 | EX-MT | Excellent-Mint |
| 550-599 | 5.5 | EX+ | Excellent Plus |
| 500-549 | 5 | EX | Excellent |
| 450-499 | 4.5 | VG-EX+ | Very Good-Excellent Plus |
| 400-449 | 4 | VG-EX | Very Good-Excellent |
| 350-399 | 3.5 | VG+ | Very Good Plus |
| 300-349 | 3 | VG | Very Good |
| 250-299 | 2.5 | Good+ | Good Plus |
| 200-249 | 2 | Good | Good |
| 150-199 | 1.5 | Fair | Fair |
| 100-149 | 1 | Poor | Poor |

## Centering Tolerances by Grade

### TCG Cards (Pokemon, MTG, etc.)

| Grade | Front L/R | Front T/B | Back L/R | Back T/B |
|-------|-----------|-----------|----------|----------|
| Pristine 10 | 51/49 | 51/49 | 52/48 | 52/48 |
| Gem Mint 10 | 55/45 | 55/45 | 65/35 | 65/35 |
| Mint 9 | 57/43 | 57/43 | 75/25 | 75/25 |
| NM-MT+ 8.5 | 60/40 | 60/40 | 80/20 | 80/20 |
| NM-MT 8 | 65/35 | 65/35 | 95/5 | 95/5 |
| NM+ 7.5 | 67.5/32.5 | 67.5/32.5 | 95/5 | 95/5 |
| NM 7 | 70/30 | 70/30 | 95/5 | 95/5 |
| EX-MT+ 6.5 | 72.5/27.5 | 72.5/27.5 | 95/5 | 95/5 |
| EX-MT 6 | 75/25 | 75/25 | 95/5 | 95/5 |
| EX 5 | 80/20 | 80/20 | 95/5 | 95/5 |
| VG-EX 4 | 85/15 | 85/15 | 95/5 | 95/5 |
| VG 3 | 90/10 | 90/10 | 95/5 | 95/5 |
| Good 2 | 95/5 | 95/5 | 95/5 | 95/5 |

### Sports Cards

| Grade | Front L/R | Back L/R |
|-------|-----------|----------|
| Pristine 10 | 51/49 | 54.5/45.5 |
| Gem Mint 10 | 55/45 | 70/30 |
| Mint 9 | 57/43 | 75/25 |
| NM-MT 8 | 65/35 | 95/5 |

## Eight Subgrade Categories

TAG DIG reports include 8 subgrades, each scored 0-1000:

1. **Front Centering** - L/R and T/B image positioning
2. **Back Centering** - L/R and T/B image positioning
3. **Front Corners** - Sharpness, wear, whitening
4. **Back Corners** - Sharpness, wear, whitening
5. **Front Surface** - Scratches, print lines, stains
6. **Back Surface** - Scratches, print lines, stains
7. **Front Edges** - Chipping, fraying, whitening
8. **Back Edges** - Chipping, fraying, whitening

## DINGS System

**DINGS** = Defects Identified of Notable Grade Significance

These are the primary defects that impacted the card's grade. Any flaw that, if absent, would not affect the overall grade is not classified as a DING.

### Common DING Categories

**Corner Defects:**
- Corner Touch - Light wear visible
- Corner Whitening - White showing on corner edges
- Corner Fraying - Fibrous appearance
- Corner Soft - Loss of sharpness
- Corner Missing - Material absent

**Edge Defects:**
- Edge Chipping - Material loss along edge
- Edge Whitening - White showing along edge
- Edge Fraying - Fibrous appearance
- Edge Notch - Indent or nick

**Surface Defects:**
- Surface Scratch - Linear mark in surface
- Print Line - Factory printing defect
- Refractor Line - Defect in foil cards
- Surface Stain - Discoloration
- Surface Pit - Small indentation
- Surface Crease - Fold mark
- Gloss Loss - Wear to surface finish

**Centering Issues:**
- Off-Center Front - Image not centered
- Off-Center Back - Image not centered

## Documented Card Examples

### Pokémon Illustrator (1998) - TAG's 100,000th Card
- **Score:** 955 (Gem Mint 10)
- **Front Centering:** 54.81/45.19 (L/R), 48.15/51.85 (T/B)
- **Front Edges:** 1000/1000
- **Back Edges:** 1000/1000
- **Front Corners:** 1000/1000
- **Front Centering Subgrade:** 950 (lowest subgrade)
- **DINGS:** None affecting grade
- **Note:** Centering at 54.81/45.19 prevented Pristine (requires 51/49)

### Typical Gem Mint 10 (950-989)
- Four sharp corners with minimal wear
- Centering within 55/45 front, 65/35 back
- No visible surface defects to naked eye
- Clean edges with minimal whitening
- May have minor print defects visible under magnification

### Typical Mint 9 (900-949)
- May have 1-2 light corner touches
- Centering within 57/43 front
- Very minor surface wear possible
- Light edge touches acceptable
- Single DING typically present

### Typical NM-MT 8 (800-849)
- Up to 2 light corner touches on front
- Multiple corner touches on back
- Centering within 65/35 front, 95/5 back
- Minor surface wear visible
- Light print lines acceptable

## Compounding Algorithm

TAG uses a compounding algorithm where the lowest subgrade dominates:

```
Final Score = min(subgrades) × 0.75 + avg(subgrades) × 0.25
```

This means:
- A card with seven 990 subgrades and one 850 subgrade will NOT be Pristine
- The lowest subgrade heavily weights the final score
- Front defects are weighted more heavily than back defects

## Front vs Back Weighting

- **Front defects:** Weighted ~1.5x more than back
- **Back defects:** Weighted ~1.0x
- **Centering:** Front centering more strict than back
- **Surface:** Front surface defects more impactful

## DIG Report Components

Every TAG DIG Report includes:

1. **TAG Score** (100-1000)
2. **Industry Grade** (1-10)
3. **Eight Subgrades** (detailed breakdown)
4. **DINGS List** (defects affecting grade)
5. **High-Resolution Images** (front/back raw card)
6. **Defect Annotations** (visual markers on images)
7. **Centering Metrics** (precise percentages)
8. **Population Data** (how many graded at this condition)
9. **Leaderboard Rank** (card's rank vs others)
10. **Chronology** (when graded)

## Service Tiers

- **TAG V:** Authentication only ($8-12)
- **TAG X:** Standard 1-10 grade + DIG report ($12-15)
- **TAG S:** Full 1000-point score + 8 subgrades + ranking ($24-30)

## Technology

TAG uses **Photometric Stereoscopic Imaging** to:
- Capture cards from multiple angles
- Detect defects invisible to human eye
- Measure centering with decimal precision
- Identify Non-Human Observable Defects (NHODs)
- Provide objective, repeatable grading

## Implementation Notes for SlabSense

### Centering Score Calculation
```python
def centering_to_score(max_offset, card_type="tcg", side="front"):
    """
    Convert centering offset to TAG-style score.
    max_offset: larger of L/R or T/B deviation from 50%
    """
    if card_type == "tcg":
        if side == "front":
            thresholds = [
                (51, 995),   # Pristine
                (55, 970),   # Gem Mint
                (57, 920),   # Mint
                (60, 860),   # NM-MT+
                (65, 825),   # NM-MT
                (67.5, 775), # NM+
                (70, 725),   # NM
                (72.5, 675), # EX-MT+
                (75, 625),   # EX-MT
                (80, 525),   # EX
                (85, 425),   # VG-EX
                (90, 325),   # VG
            ]
        else:  # back
            thresholds = [
                (52, 995),
                (65, 970),
                (75, 920),
                (80, 860),
                (95, 700),
            ]
    # Look up score from thresholds
    for threshold, score in thresholds:
        if max_offset <= threshold:
            return score
    return 400  # Below lowest threshold
```

### Grade Determination
```python
def score_to_grade(score):
    """Convert TAG score to grade and label."""
    thresholds = [
        (990, 10.0, "Pristine"),
        (950, 10.0, "Gem Mint"),
        (900, 9.0, "Mint"),
        (850, 8.5, "NM-MT+"),
        (800, 8.0, "NM-MT"),
        (750, 7.5, "NM+"),
        (700, 7.0, "NM"),
        (650, 6.5, "EX-MT+"),
        (600, 6.0, "EX-MT"),
        (550, 5.5, "EX+"),
        (500, 5.0, "EX"),
        (450, 4.5, "VG-EX+"),
        (400, 4.0, "VG-EX"),
        (350, 3.5, "VG+"),
        (300, 3.0, "VG"),
        (250, 2.5, "Good+"),
        (200, 2.0, "Good"),
        (150, 1.5, "Fair"),
        (100, 1.0, "Poor"),
    ]
    for threshold, grade, label in thresholds:
        if score >= threshold:
            return grade, label
    return 1.0, "Poor"
```

## Sources

- TAG Grading Official: taggrading.com
- TAG DIG Reports: taggrading.com/pages/dig
- TAG Grading Scale: taggrading.com/pages/scale
- TAG Grading Rubric: taggrading.com/pages/rubric
- TAG Help Center: help.taggrading.com
- Collector's Guide - Rare Candy: rarecandy.com/blog/collectors-guide-grading-with-tag
- TAG Company Profile - TCFever: tcfever.com/guides/grading/tag
- TAG Review - figoca: figoca.com/grading-companies/tag
