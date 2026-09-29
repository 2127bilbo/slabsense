# Centering on e-Reader-style cards (Expedition / Aquapolis / Skyridge, and the 30th Celebration Crystal Lugia reprint)

Written 2026-09-28. Question: how does TAG measure centering on cards whose printed design is
asymmetric by construction (the dot-code strip on the left and bottom of e-Reader cards), and does
our centering model / tool agree? Everything below is either (a) an official published statement,
quoted verbatim with its source, or (b) a measurement taken from TAG's own DIG report data for
27,751 cards (`scripts/tag-dataset/data/dataset/manifest.parquet`). Nothing here is forum hearsay.

## 1. What the companies publish (official wording)

**TAG** (rubric, https://taggrading.com/pages/rubric, captured verbatim in
`sources/TAG_scale_and_rubric_verbatim.md`): per grade, e.g. Gem Mint 10 - "Front image centered
within a tolerance of ~55/45 and back image within ~70/30 (Sports), or ~65/35 (TCG)." TAG's public
pages (scale, rubric, DIG explainer, help-center article "What is the TAG DIG report?") state the
tolerances and that centering is one of eight subgrades; **they do not publish the measurement
method** (where on the edge it is measured, what counts as "print"), and say nothing about
asymmetric designs or e-Reader cards.

**PSA** (https://www.psacard.com/gradingstandards, captured verbatim in
`sources/PSA_gradingstandards_verbatim.md`): "PSA determines centering by comparing the measurements
of the borders from left to right and top to bottom. The centering is designated as the percent of
difference at the most off-center part of the card." Nothing about asymmetric designs.

**No official TAG or PSA text says centering is taken from "two corners".** The closest official
statement is PSA's "most off-center part of the card" (the worst point along the edge, not an
average, and not a corner rule).

## 2. What TAG actually does on e-Reader cards (from TAG's own DIG numbers)

TAG's DIG report gives four "distance to edge" values per side (units 0.01 mm). The dataset has
183 Expedition, 154 Aquapolis and 135 Skyridge fronts.

| set | n | TAG mean L / R / T / B | L+R | mean L/R | mean T/B | mean centering subgrade |
|---|---|---|---|---|---|---|
| Expedition Base Set | 183 | 186 / 202 / 220 / 191 | 387 | 47.9/52.1 | 53.3/46.7 | 940 |
| Aquapolis | 154 | 187 / 203 / 224 / 189 | 390 | 47.9/52.1 | 54.5/45.5 | 935 |
| Skyridge | 135 | 189 / 207 / 204 / 207 | 396 | 47.6/52.4 | 49.8/50.2 | 954 |
| Base Set | 2392 | 216 / 212 / 245 / 244 | 427 | 50.5/49.5 | 50.1/49.9 | 956 |
| Fossil | 674 | 217 / 214 / 248 / 247 | 430 | 50.4/49.6 | 50.0/50.0 | 956 |
| Neo Genesis | 466 | 213 / 212 / 246 / 244 | 424 | 50.1/49.9 | 50.1/49.9 | 966 |
| Celebrations Classic Collection | 126 | 195 / 181 / 212 / 217 | 376 | 51.9/48.1 | 49.4/50.6 | 950 |

Two things follow directly:

1. **The dot-code strip counts as print.** On e-Reader fronts TAG's left distance is ~30 units
   *smaller* than the right (L+R totals ~390 vs ~427 on ordinary WOTC cards). If TAG measured to the
   art frame and ignored the strip, the left distance would be several times larger, not smaller.
   The strip sits nearer the card edge than the frame on the opposite side, so every e-Reader card
   reads ~47/53 L/R by TAG's algorithm; the bottom strip does the same to T/B on Expedition and
   Aquapolis (~53/47). The 22 original Aquapolis Crystal Lugia (149/147) in the data average
   L/R/T/B = 196/224/236/181, i.e. 46.7/53.3 and
   56.7/43.3; the best copy's centering subgrade is 966.

2. **TAG applies no design correction.** At the same measured deviation, e-Reader cards receive the
   same centering subgrade as ordinary WOTC cards (slightly lower, if anything):

| max deviation (pts) | WOTC non-e n | subgrade | e-Reader n | subgrade |
|---|---|---|---|---|
| (0, 2] | 499 | 985.6 | 20 | 988.1 |
| (2, 4] | 3233 | 972.6 | 89 | 971.5 |
| (4, 6] | 3504 | 959.6 | 151 | 955.4 |
| (6, 8] | 1825 | 945.2 | 121 | 932.9 |
| (8, 10] | 631 | 931.3 | 55 | 917.2 |
| (10, 15] | 284 | 905.0 | 31 | 870.9 |
| (15, 30] | 34 | 759.5 | 5 | 798.8 |

   So an e-Reader design simply pays for its asymmetry: 53% of e-Reader fronts measure >= 5 pts
   off versus 27% of ordinary WOTC fronts, and their average centering subgrade is ~15 points
   lower.

## 3. The 30th Celebration Crystal Lugia (Classic Collection, 2026)

Layout (from the TCGplayer product scan): the e-Reader frame geometry is kept - art and text boxes
sit right/up of centre - the e-Reader logo is replaced by the 30th logo, and the dot-code strips are
reproduced as **printed gold dash strips in the same positions** on the left and bottom. A tool that
measures edge-to-frame will call the left and bottom borders very thick; a tool that measures
edge-to-print (TAG's behaviour on the originals) lands on the dash strip and reads close to 50/50.

TAG-graded examples are **not yet in our data** (latest `date_graded` 2026-06-08; the set released
2026-09-16), so how TAG's vision treats the gold dashes is *inferred from the originals, not
observed*. Verify as soon as TAG certs exist for this card: pull their DIG reports (the fetcher takes
a certs file) and check whether L/R/T/B match the originals' pattern.

## 4. Our centering model (v2b) on these cards

Scored on the 37 e-Reader cards in the val split (74 sides), against TAG's labels, with an 80-side
ordinary-WOTC control (`training/eval_logs/centering-v2b-ereader-val-2026-09-28.csv`):

| group | ratio MAE L/R | ratio MAE T/B | within 2 pts | front mean L/R: TAG -> model | front mean T/B: TAG -> model |
|---|---|---|---|---|---|
| e-Reader (74 sides) | 1.36 | 1.26 | 0.73 | 47.3 -> 47.1 | 52.9 -> 53.4 |
| WOTC control (80 sides) | 1.20 | 0.59 | 0.84 | 51.0 -> 50.7 | 50.0 -> 49.8 |

The model reproduces TAG's strip-inclusive convention (it trained on 393 e-Reader cards with TAG's
labels), with somewhat less precision than on plain cards. On the two original Crystal Lugias
checked individually it lands within 0.1 pt of TAG on L/R. On the 30th Celebration TCGplayer render
(a render, not a photo, so indicative only) it reads 49.5/50.5 L/R and 51.1/48.9 T/B, i.e. it treats
the gold dash strip as print; mirrored (strip on the right) it reads 56/44, showing the behaviour is
learned from the left-strip layout, not symmetric.

## 5. What "right" means for SlabSense

- Measure edge to the outer edge of printed content, the way TAG's numbers show TAG does. On
  e-Reader layouts the inner line goes at the outer edge of the strip on the left and bottom and at
  the frame on the top and right. Do **not** add a per-design "expected offset" correction: TAG's
  data shows none, so a corrected reading would disagree with the TAG grade.
- The manual tool's readout is whatever the user draws; the guidance above is what needs surfacing
  for these cards. The model already follows the convention.
- Open item: confirm on real TAG DIG reports of the 30th Crystal Lugia once they exist, and on a
  real phone photo of one through the model (the render is not evidence of photo behaviour).
