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

**Verified on a real cert, 2026-09-30** — TAG C2022763, Lugia 149/147, "30th Celebration Classic
Collection - Aquapolis", variation **Secret Rare** (the gold-foil-border version, not the plain
yellow-border print), graded 10 PRISTINE (992 centering, corners/edges/surface 1000; size score
952, card 2.48645 × 3.46321 in), pulled through `tagdataset.tagapi` on 2026-09-30:

| side | TAG DTE mm (l, r, t, b) | TAG ratios | centering v2b on TAG's deskewed image (trimmed crop) | v2b mm (l, r, t, b) |
|---|---|---|---|---|
| front | 1.66, 1.69, 1.81, 1.76 | 49.6/50.4 L/R, 50.7/49.3 T/B | **39.7/60.3 L/R, 43.4/56.6 T/B** | 2.69, 4.10, 2.41, 3.14 |
| back | 2.12, 2.19, 2.45, 2.39 | 49.2/50.8, 50.6/49.4 | 49.4/50.6, 49.8/50.2 | 3.06, 3.13, 3.49, 3.52 |

What TAG did: all four front distances are ~1.7 mm and nearly equal, so TAG's boundary on this
card is a near-symmetric line ~1.7 mm inside the edge on every side — inside the gold foil border,
not at the blue art frame (which sits ~4 mm in on the right) and not at the gold dash strip
(~2.8 mm on the left). On the Secret Rare the whole border is a foil pattern to the edge, and TAG
treats the pattern's boundary as the print edge, so the card reads ~50/50 and grades Pristine.

What our model did: the back is within 0.8 pt of TAG (ordinary back design). The front is 10 to
13 points off: v2b measured the left to ~2.7 mm (near the dash strip, as on the originals) and the
right to 4.1 mm (the art frame), i.e. it applied the e-Reader convention it learned from the
originals to a border it has never seen. On the engine that is a centering subgrade around 8.5–9
against TAG's 10 Pristine. **This is a model gap specific to the Secret Rare foil border, not an
e-Reader rule question.** The plain-border 30th Lugia is still unverified (no cert seen yet).

Also seen: the card model's mask misplaced the top-left corner of this gold-foil card on TAG's
orange trim by ~80 px (holo foil against orange gives a weak edge), which on its own turned the
chained reading into 30/70; the numbers above use a backdrop-trim crop instead. Foil-to-the-edge
cards need to be in the card model's synthetic set too.

**All graded copies, 2026-09-30.** TAG's pop report lists 28 graded 149/147 Secret Rare Lugia
(1 × 10 PRISTINE, 23 × 10 GEM MINT, 3 × 9, 1 × 8.5 at the time of the pull); it is the only Lugia
149/147 variation in that set, so the "plain-border 30th Lugia" of the earlier note does not
exist as a separate TAG listing. All 28 were pulled (TAG's rate limit needs ~25 s between
calls); `scripts/harness/lugia-30th.mjs` downloads their deskewed images and
runs centering v2b on a backdrop-trimmed crop (`scripts/harness/lugia-30th-certs.json`,
`results/2026-09-30-lugia-30th.json`):

| side | n | mean abs. L/R diff | mean abs. T/B diff | both within 2 pts | TAG mean L/R, T/B | model mean L/R, T/B |
|---|---|---|---|---|---|---|
| front | 28 | 7.8 | 7.8 | 0 / 28 | 49.4, 49.6 | 41.9, 56.4 |
| back | 28 | 0.9 | 2.5 | 11 / 28 | 49.6, 49.6 | 49.8, 52.0 |

The front error is a **systematic bias**, not noise: the model reads the left ~7 points low and the
top ~7 points high on every copy, because it measures to different features than TAG does on this
foil border. TAG's own front ratios vary from 44.9 to 54.0 L/R and 40.7 to 55.9 T/B across the copies (the
three 9s and the 8.5 are the off-centre ones), so the design is
not "always 50/50" — TAG measures real off-centre copies as off-centre, and the model's bias sits
on top of that. The back is an ordinary card back and agrees on L/R (0.9); its T/B runs ~2.5 high,
a smaller bias worth watching on other 2026 backs.

Fix path: these certs are the training examples. Collect the TAG certs of this variation (the pop report lists them:
`my.taggrading.com/pop-report/Pokemon/2026/Pokémon Mega Evolution/Lugia/149/147?setName=30th
Celebration Classic Collection - Aquapolis&variation=Secret Rare`), pull their DIG reports and
images with the fetcher, add them to the centering training set (and the foil-border cards to the
card model's cutouts), and re-check with the harness. Until then, on this card the manual tool is
the right reading: place the inner line ~1.7 mm in on all sides, at the boundary of the foil
border pattern, which is where TAG measures.

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
- Open item (updated 2026-09-30): the Secret Rare foil-border 30th Lugia is now confirmed against
  TAG (section 3) and the model is 10+ points off on it — a training-data gap. Still open: the
  plain-border 30th Lugia on a real TAG cert, and a real phone photo of either through the model.
