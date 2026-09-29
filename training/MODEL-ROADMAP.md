# Model roadmap — every model the app needs, where each stands, what "as good as it gets" takes

Written 2026-09-29 for the owner and the training session. Numbers are the ones recorded in
`training/README.md`, `docs/GRADING_SYSTEM.md` and the harness results; nothing here is new
measurement. TAG's grade has four components per side — centering, corners, edges, surface —
and the app has one model family per component plus two that serve them (card outline, rollup).
"Perimeter" in the owner's list is the card outline; TAG has no separate perimeter score.

The PC-hosted rig that runs these models under controlled capture is planned in `docs/RIG-PLAN.md`.

## The list

| # | Model | In the app today | Status |
|---|---|---|---|
| 1 | Card outline (the "perimeter" model) | `card-v1`: live outline in the viewfinder, auto snap, pre-placed card line in the centering tool, capture check | Accepted for raw cards; holders out of scope |
| 2 | Centering | `centering_rgb-v2b`: pre-places the artwork line from the card crop | Accepted; limited by crop-edge sensitivity |
| 3 | Corners | `corners-v3-phone`: 8 corner slots → CORNER defects on every path | Accepted; the strongest model |
| 4 | Edges | `edges-v2-phone`: 8 edge slots → EDGE defects on every path | Accepted but weak (recall) |
| 5 | Surface | No detector live. Free path: legacy pixel detectors. Paid paths: Claude finds defects, the TAG deduction regressor sets severity | The biggest gap |
| 6 | Rollup (subgrades → TAG grade) | Engine math: min×0.75 + mean×0.25 with caps, hand-calibrated on DIG | Works; not learned |
| 7 | Company offsets (TAG → PSA / CGC / SGC / BGS) | Verbatim published scales + centering limits; no learned offset | Rule-based; no paired data |

Not grading models, but in the same pipeline and already live: card identification (OCR + pixel
re-rank over the bucket card DB) and the surface deduction regressor (severity from TAG's marker
deductions, `api/_lib/surfaceDeduction.js`).

## What limits every model at once: the phone domain

Every model was trained on TAG's scans (orange backdrop, flat, sharp, even light) and is used on
phone photos (any table, bowed cards, softer focus, glare, holo). Phone augmentation closed most
of the gap for corners and edges, but the only ground truth we have on phone photos is the
owner's eye. The single highest-value dataset is **raw cards photographed in the app before they
go to TAG, paired with their DIG reports** (Settings → Keep Originals For Training is already
built for this). 150 to 300 cards across grades 4–10 gives: threshold calibration per model in
the real domain, a fine-tune set, and an honest phone-domain number for every model below. It
takes weeks of submissions, so it should start now and run in the background of everything else.

## 1. Card outline

**Today.** 6 MB mobilenetv3 U-Net, 512 px letterbox, mask → line fit → corners, logit zero-crossing
refinement. On the 147 hand-labelled phone photos: raw cards corner error 0.37 % of the long side
(p95 1.05 %), bowed 0.50 %, holders 6.7 % (traces the sleeve or slab). ~25 ms/frame on WebGPU,
~150–250 ms on WASM.

**Why it is not enough.** Centering needs the card line within ~1 px at 1248 px (≈0.1 %), and the
model delivers ~5 px. The full-resolution gradient refinement made it worse (shadows, holo edges).

**To get it as good as it gets.**
- A second-stage edge refiner: a small model that takes a strip along each predicted side at
  full resolution and returns the sub-pixel edge, trained from the same synthetic composites (the
  exact edge is known). Target 0.15 % corner error.
- 118 more labelled photos are waiting (the HEICs on the owner's desktop): label them with
  `npm run models:label-card-val` and re-run `scripts/harness/card-chain.mjs`.
- Bowed cards: a mesh (8–12 points per side) instead of a quad, so the crop un-bows the card.
  Twenty of 147 photos are bowed; it matters for corners and edges too, since a bowed crop puts
  the corner tile off the corner.
- Holders: optional v2 with synthetic sleeves and slabs, filler only (owner's decision: users take
  cards out).

## 2. Centering

**Today.** v2b, 896×1248 crop + side → four card-edge-to-frame distances. On TAG scans: L/R error
1.37, T/B 1.52 points, 65 % within 2. Chained from the card model on phone photos: 43 % within 2,
73 % within 5. Compression slope 0.878 / 0.825 (still shrinks off-centre cards toward 50/50).

**Why it is not enough.** It measures from the crop edge, so any crop error moves the answer one
for one, and a border is only ~3 % of the card. The slope means a 60/40 card reads about 58/42.

**To get it as good as it gets.**
- **v3 that sees the card edge**: input a loose crop with margin (the card plus ~6 % of table
  each side, as the card model provides), predict both the card edge and the frame positions per
  side, or the ratios directly. The crop error then stops mattering. Train with crops jittered by
  the card model's real error distribution, not uniform noise.
- Higher input resolution on the border band (the frame and edge are what matter; the art is
  not) — a two-crop input (top/bottom bands and left/right bands at native resolution) is cheaper
  than a bigger whole-card image.
- Direct-ratio head or L1-on-ratio to finish the slope work (v2b's ratio-weight 0.1 got 0.70 →
  0.88; the 0.95 gate is still open).
- e-Reader / dot-code cards already measured TAG's way; keep that rule in the label builder.
- Acceptance: on phone photos through the full chain, ≥ 85 % within 2 points of the hand-placed
  measurement; on TAG scans, slope ≥ 0.95.

## 3. Corners

**Today.** v3-phone, 384 px corner tile → wear (sigmoid), deduction, angle. Clean AUROC 0.923,
phone-sim 0.922, recall 0.77 at 0.5; app threshold 0.20 because phone photos score 0.1–0.2
lower than scans. Held-out grade error with the pair: 1.24 (was 2.98 without models).

**Why it is not enough.** On the owner's worn Gengar the back corners fire but the front corners
still read near clean at phone sharpness: the fibre texture the model keys on is not there.
Thresholds are calibrated on scans, not phones.

**To get it as good as it gets.**
- Phone ground truth (above) → per-domain threshold, then a fine-tune epoch on the paired set.
- Tile from the refined card outline (item 1) so the tile is centred on the true corner; a bowed
  or skewed crop today puts table in the tile.
- Sharpness-aware input: feed the tile at the photo's native resolution rather than a resample
  of a 1400 px crop when the photo is larger (most phones give 3000+ px on the card).
- Acceptance: on the phone-paired set, corner subgrade within 5 points of TAG on 80 % of sides,
  no clean 10 corner scored as worn.

## 4. Edges

**Today.** v2-phone, 1024×192 strip → wear, deduction. AUROC 0.894, phone-sim 0.875, recall 0.18
(scans 0.25 at 0.5). A TAG-marked side scores median 0.29; at the app threshold 0.20 it catches
63 % of marked sides and fires on 10 % of clean ones. TAG's edge subgrade tracks its ding markers
(rank correlation 0.88), not fill/fray pixels.

**Why it is not enough.** The strip is a 5× downscale of a ~5000 px scan; a fray of 2–4 px is
gone before the model sees it. This is a resolution problem, not a data problem.

**To get it as good as it gets.**
- **Edges HR**: tile the strip into 4–6 segments at native resolution (or 2× the current), score
  each, aggregate by max for wear and sum for deduction. Handoff Step 9.4 already sketches the
  double-resolution run.
- Target the ding markers directly (count and deduction per edge) alongside wear.
- Blur and backdrop augmentation as for v2-phone; phone ground truth for the threshold.
- Acceptance: recall ≥ 0.6 at ≤ 10 % false-positive sides on held-out scans; on the phone-paired
  set, edge subgrade within 5 points of TAG on 75 % of sides.

## 5. Surface

**Today.** Nothing learned runs on the free path; creases and scratches come from the legacy
pixel detectors (classical crease detection was ruled out: 29 % recall at 88 % false-positive
sides). Paid paths: Claude reports defects, the TAG deduction regressor turns each into a
severity. Rejected so far: box detectors v1–v3 (creases only, ~6 false boxes per side, half of
TAG's markers never matched) and whole-side score regressors (TAG's back surface score does not
follow the back image).

**Why it is the biggest gap.** Surface is where low grades come from, and it is the subgrade the
owner's harness shows the software grade being lenient on. The assets are there: ~27,000 certs
with typed markers (type, box, deduction, manual/automatic) at native resolution.

**To get it as good as it gets.**
- **Tile classifier at native resolution**: 512 px tiles over the card, label = which marker types
  fall in the tile and their summed deduction (weak supervision from the boxes, so loose boxes
  stop hurting). Outputs per tile: crease / scratch / dent / stain / print defect / tear presence
  and a deduction. Aggregate per side: max presence per type, summed deduction → surface
  subgrade through the engine's existing cuts.
- Relabel pass: keep TAG's `Manual` markers as strong labels, treat `automatic` ones as weak;
  drop marker types the app does not score.
- Use the relief (`sfx`) image where TAG has it for creases and dents at train time, RGB only at
  inference (the phone has no relief image) — distil, do not depend on it.
- Glare and holo are the phone-domain enemy for surface specifically; the phone-paired set is
  mandatory before shipping this on the free path.
- Serving: 20–40 tiles per side at ~10 ms on WebGPU is fine; WASM phones get a "surface from
  the paid grade only" fallback.
- Acceptance: crease recall ≥ 0.8 at ≤ 0.5 false creases per clean side; per-side surface
  subgrade within 10 points of TAG on 75 % of held-out sides; no grade-10 side losing more
  than 5 points.

## 6. Rollup

**Today.** The engine compounds the eight subgrades with a fixed rule and caps, calibrated by hand
against DIG reports. It reproduces TAG's grade well on the harness but every constant is a guess.

**To get it as good as it gets.**
- Fit a small tabular model (gradient-boosted trees, monotone constraints) from TAG's own eight
  per-side scores to TAG's final grade on all ~27,000 certs; that is the true rollup, with the
  caps learned rather than assumed. Export as JSON trees like the deduction regressor and walk
  them in `gradingEngine.js`.
- Then feed it our predicted subgrades and measure the grade error end to end on the phone-paired
  set; that number is the product's accuracy.
- Acceptance: on TAG's own subgrades, grade exact on ≥ 90 % of held-out certs; end to end on
  phone photos, within half a grade on ≥ 80 %.

## 7. Company offsets

**Today.** PSA, CGC, SGC and BGS grades come from their published scales and centering limits
(verbatim captures in `docs/grading-research/sources/`), applied to the same subgrades.

**Why it stays rule-based for now.** A learned offset needs the same card graded by TAG and by
the other company. That crossover data is scarce and not public in bulk.

**To get it as good as it gets.**
- Collect crossovers deliberately: the owner's own cards submitted to two companies, plus any
  public cert pairs (crossover posts with both cert numbers). Even 100 pairs per company gives a
  per-grade offset with error bars.
- Until then, keep the rules and show the range, not a point, for non-TAG companies.

## Order of work

1. **Start the phone-paired collection now** (owner: scan raw cards with Keep Originals on, then
   submit to TAG). Everything else calibrates against it.
2. **Edges HR** — resolution fix, contained, biggest measured weakness of a live model.
3. **Centering v3 + card-edge refiner** — removes the crop-edge sensitivity the chain harness
   exposed; label the 118 HEICs alongside.
4. **Surface tile classifier** — largest gap, largest effort; needs the phone-paired set before it
   ships on the free path.
5. **Rollup model** — cheap once the subgrades are trustworthy.
6. **Company offsets** — data collection only until pairs exist.

Each item gets its own handoff step in `training/HANDOFF-rented-gpu.md` when it is scheduled, with
the acceptance numbers above as the gate.
