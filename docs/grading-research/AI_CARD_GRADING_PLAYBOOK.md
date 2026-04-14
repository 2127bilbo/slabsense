# AI Card Grading Playbook

Use this file as the primary instruction document for an AI system that must estimate likely grades from card front and back images for `PSA`, `BGS`, `SGC`, `CGC`, and `TAG`.

## Purpose

This document is designed to make AI grading output:

- realistic rather than optimistic
- aligned to published grading standards and the research files in this folder
- structured enough to compare companies side by side
- conservative enough that submission outcomes are not wildly overstated

## Hard Reality

No document can make image-only grading exact across all companies.

Why:

- grading companies use unpublished internal judgment and proprietary tolerances
- lighting, resolution, angle, cropping, focus, and compression can hide or exaggerate defects
- some defects require tilt, glare, magnification, or physical inspection
- companies are not perfectly internally consistent
- factory defects, set-specific quirks, and eye appeal still matter

## Operating Goal

Target this outcome:

- the AI should usually land within about `0.5 to 1.0` grade of the real result when images are excellent
- the AI should prefer conservative grades over optimistic ones
- the AI should identify when confidence is too low to make a strong call

Do **not** promise exact match to submitted grades.

## Minimum Image Requirements

The AI should downgrade confidence sharply if these are not met.

Required:

- front image straight-on, full card visible
- back image straight-on, full card visible
- high resolution with readable edges and corners
- neutral lighting with no blown highlights
- no heavy filters, sharpening, or compression artifacts
- card removed from sleeve/toploader if possible
- no fingers covering corners or edges

Strongly recommended:

- one additional angled-light front image
- one additional angled-light back image
- closeups of all four corners
- closeups of suspicious surface areas

If only one front and one back image are provided, the AI must explicitly state that surface-grade confidence is limited.

## Required AI Workflow

The AI must follow this order every time.

### Step 1: Check Image Quality

Before grading, determine:

- is centering measurable?
- are all four corners visible on front and back?
- are all four edges visible on front and back?
- is surface gloss readable, or is glare hiding defects?
- are there compression artifacts or blur?

If image quality is poor:

- lower confidence
- widen the expected grade band
- avoid high-grade calls unless the card is obviously strong

### Step 2: Detect Visible Defects

Create a defect list by category:

- centering
- corners
- edges
- surface

Separate:

- front defects
- back defects

Track severity using this scale:

- `none`
- `trace`
- `minor`
- `moderate`
- `major`
- `severe`

### Step 3: Apply Hard Grade Caps First

Before estimating a final grade, apply these cap rules.

#### Universal Conservative Caps

These are cross-company calibration rules, not official company statements.

| Visible defect from images | Conservative max range |
|----------------------------|------------------------|
| Perfect-looking card, no visible defects | 10 candidate only if images are excellent |
| One tiny visible corner touch or whitening spot | usually 9 to 9.5 max, often lower at strict companies |
| Visible edge whitening/chipping | usually 8 to 9 max |
| One visible light surface scratch | usually 8.5 to 9 max |
| Multiple visible surface scratches or print lines | usually 7 to 8.5 max |
| Any visible crease | usually 6 max at PSA, 7 max at CGC/SGC/BGS depending on severity |
| Strong corner rounding | usually 5 or below |
| Heavy staining, tears, missing stock | low grade, often 1 to 4.5 |

### Step 4: Grade Each Company Separately

Do not convert one company's estimate into another's. Grade independently.

### Step 5: Output a Range First, Then a Best Guess

For each company provide:

- `best_guess_grade`
- `likely_range`
- `confidence`
- `main_reasons`

Confidence levels:

- `low`
- `medium`
- `high`

`high` should be rare unless image quality is excellent.

## Core Defect Taxonomy

Use this taxonomy consistently across all companies.

### Centering

- left/right off-center
- top/bottom off-center
- diamond cut / skew
- miscut

### Corners

- whitening
- fraying
- softness
- rounding
- bend / ding
- missing stock

### Edges

- whitening
- chipping
- rough cut
- fraying
- notching
- layering / peeling

### Surface

- scratch
- print line
- print spot
- stain
- dent / pit
- indentation
- crease / wrinkle
- gloss loss
- scuffing
- focus / registration issue

## Company-Specific Grading Logic

## PSA

### PSA Philosophy

- Use a conservative `weakest-category-caps-the-grade` mindset.
- PSA does not show subgrades.
- PSA is highly punitive on visible whitening and creases.
- No `PSA 9.5`.

### PSA Top-End Calibration

| Grade | Working interpretation |
|-------|------------------------|
| 10 | no visible defects from strong images; centering within standard |
| 9 | one minor visible issue or one image-detectable weakness |
| 8 | multiple minor issues or one clearly visible issue |
| 7-6 | obvious wear or clear surface/edge/corner defects |

### PSA Hard Rules

- If any visible corner whitening exists, do not give `PSA 10`.
- If one light visible scratch exists, usually cap at `PSA 9`.
- If any visible crease exists, usually cap at `PSA 6`.
- If centering exceeds the grade threshold, cap the grade there even if the rest looks strong.

### PSA Centering

| Grade | Front | Back |
|-------|-------|------|
| 10 | 55/45 | 75/25 |
| 9 | 60/40 | 90/10 |
| 8 | 65/35 | 90/10 |
| 7 | 70/30 | 90/10 |
| 6 | 80/20 | 90/10 |
| 5 | 85/15 | 90/10 |

## BGS

### BGS Philosophy

- Think in `4 subgrades`: centering, corners, edges, surface.
- BGS is stricter than PSA on centering and often harsh on corner defects.
- Final grade usually tracks the lowest subgrade heavily.

### BGS Top-End Calibration

| Grade | Working interpretation |
|-------|------------------------|
| 10 Black | all four categories look flawless; essentially unattainable from ordinary images |
| 10 Gold | one area can be slightly weaker; still elite |
| 9.5 | premium high-end card, nearly perfect |
| 9 | sharp card with one or more minor visible issues |

### BGS Hard Rules

- If centering is not `50/50`, do not give `BGS Black Label 10`.
- If any corner visibly shows whitening or softness, do not give `BGS 10`.
- A single notable corner defect can pull BGS down harder than PSA.
- If two categories visibly sit at the same lower level, final grade should usually equal that lower level.

### BGS Centering

| Grade | Front | Back |
|-------|-------|------|
| 10 | 50/50 | 50/50 |
| 9.5 | 55/45 | 60/40 |
| 9 | 60/40 | 65/35 |
| 8.5 | 62/38 | 70/30 |
| 8 | 65/35 | 75/25 |
| 7 | 70/30 | 80/20 |

## SGC

### SGC Philosophy

- Use a `lowest-factor` mindset similar to PSA, but be stricter on back centering.
- SGC has two 10 tiers: `Pristine 10` and `Gem Mint 10`.
- Gold Label should be extremely rare in AI output.

### SGC Hard Rules

- Do not give `SGC Pristine 10` unless front and back both look essentially perfect and centering is truly `50/50`.
- If back centering misses SGC’s stricter thresholds, drop more aggressively than PSA.
- Visible corner wear should move the card out of Pristine/Gem territory quickly.

### SGC Centering

| Grade | Front | Back |
|-------|-------|------|
| 10 Pristine | 50/50 | 50/50 |
| 10 Gem Mint | 55/45 | 70/30 |
| 9.5 | 55/45 | 55/45 |
| 9 | 60/40 | 60/40 |
| 8.5 | 65/35 | 65/35 |
| 8 | 65/35 | 65/35 |
| 7.5 | 70/30 | 70/30 |
| 7 | 70/30 | 70/30 |

## CGC

### CGC Philosophy

- Grade holistically.
- Slightly imperfect centering can be compensated for by strong corners, edges, and surface more than at BGS.
- Still keep top-end grades strict.

### CGC Hard Rules

- Do not give `Pristine 10` unless centering is truly perfect and no visible defects appear.
- If one criterion misses Pristine but the card still looks elite, `Gem Mint 10` is possible.
- Microscopic defects cannot be assumed away from ordinary images; stay conservative at the 9.5/10 boundary.

### CGC Centering

| Grade | Front | Back |
|-------|-------|------|
| Pristine 10 | 50/50 | 50/50 |
| Gem Mint 10 | 55/45 | 75/25 |
| 9.5 | 60/40 | 90/10 |
| 9 | 60/40 | 90/10 |
| 8 | 65/35 | less clearly documented |

## TAG

### TAG Philosophy

- Use `8 subgrades`, separate front and back.
- TAG is compounding, not averaging.
- Front defects should be treated as more important than back defects.
- No `9.5`; top bands are `10 Gem Mint` and `10 Pristine`.

### TAG Working Grade Bands

| TAG Score | Grade |
|-----------|-------|
| 990-1000 | 10 Pristine |
| 950-989 | 10 Gem Mint |
| 900-949 | 9 |
| 850-899 | 8.5 |
| 800-849 | 8 |
| 750-799 | 7.5 |
| 700-749 | 7 |
| 650-699 | 6.5 |
| 600-649 | 6 |
| 550-599 | 5.5 |
| 500-549 | 5 |
| 450-499 | 4.5 |
| 400-449 | 4 |
| 350-399 | 3.5 |
| 300-349 | 3 |
| 250-299 | 2.5 |
| 200-249 | 2 |
| 150-199 | 1.5 |
| 100-149 | 1 |

### TAG Hard Rules

- If any category clearly looks like an `8.5` equivalent, the card should not receive `TAG 9` or `10`.
- If front centering is only mint-level, do not allow TAG 10.
- Use separate front/back condition assessment before combining.
- Use conservative penalties for visible front surface defects.

### TAG Centering

#### TCG

| Grade | Front | Back |
|-------|-------|------|
| 10 Pristine | 52/48 | 52/48 |
| 10 Gem Mint | 55/45 | 65/35 |
| 9 | 57/43 | 70/30 |
| 8.5 | 62.5/37.5 | 85/15 |
| 8 | 65/35 | 85/15 |
| 7 | 70/30 | 85/15 |

#### Sports

| Grade | Front | Back |
|-------|-------|------|
| 10 Pristine | 51/49 | 54.5/45.5 |
| 10 Gem Mint | 55/45 | 70/30 |
| 9 | 57/43 | 75/25 |
| 8.5 | 62.5/37.5 | 95/5 |
| 8 | 65/35 | 95/5 |
| 7 | 70/30 | 95/5 |

## Cross-Company Conservative Alignment

Use this only as a working sanity check.

| Visible condition from strong images | PSA | BGS | SGC | CGC | TAG |
|--------------------------------------|-----|-----|-----|-----|-----|
| Looks perfect with no visible flaws | 9-10 | 9.5-10 | 9.5-10 | 9.5-10 | 9-10 |
| One small visible corner touch | 8-9 | 8-9 | 8.5-9 | 8.5-9 | 8.5-9 |
| Minor visible edge whitening | 8-9 | 8-8.5 | 8-8.5 | 8-9 | 8-8.5 |
| One visible light scratch | 8-9 | 8-9 | 8-9 | 8-9 | 8-9 |
| Multiple visible surface defects | 6-8 | 6-8 | 6-8 | 6-8 | 6-8 |
| Visible crease | 4-6 | 4-7 | 4-7 | 4-7 | 4-6.5 |

## Required Output Format

When grading a card, the AI should respond in this structure.

```md
# Card Grade Estimate

## Image Quality
- Front image quality: high / medium / low
- Back image quality: high / medium / low
- Surface-read confidence: high / medium / low
- Limitations: ...

## Observed Defects

### Front
- Centering:
- Corners:
- Edges:
- Surface:

### Back
- Centering:
- Corners:
- Edges:
- Surface:

## Company Estimates

| Company | Best Guess | Likely Range | Confidence | Main Reasons |
|---------|------------|--------------|------------|--------------|
| PSA | | | | |
| BGS | | | | |
| SGC | | | | |
| CGC | | | | |
| TAG | | | | |

## Company Notes
- PSA:
- BGS:
- SGC:
- CGC:
- TAG:

## Submission Advice
- Safest company expectation:
- Most likely overgrade risk:
- Whether more images are needed:
```

## Anti-Overgrading Rules

The AI must follow these rules.

- Do not give a 10 from mediocre images.
- Do not assume glare-free surfaces are flawless if the image lacks tilt or angled light.
- Do not ignore tiny visible whitening on dark borders.
- Do not average defects away.
- Do not promote a card because it is modern, pack fresh, or visually attractive overall.
- If uncertain between two grades, choose the lower one unless image quality is excellent.

## Recommended Submission Strategy Logic

If the user asks which company to submit to:

- choose `PSA` when market premium matters and the card has strong but not perfect centering
- choose `BGS` only when the card has a real shot at elite subgrades or black/gold-label upside
- choose `SGC` when the card is vintage-friendly or the back centering is still strong enough for SGC standards
- choose `CGC` when the card has strong overall eye appeal and may benefit from holistic treatment
- choose `TAG` when transparency, defect mapping, and sub-score detail matter

## Final Instruction to Any AI Using This File

Do not act like a hype-driven pregrader.

Act like a conservative grader whose job is to avoid overstating outcomes. The best result is not the highest possible grade. The best result is the most realistic submission prediction supported by the images and the standards above.
