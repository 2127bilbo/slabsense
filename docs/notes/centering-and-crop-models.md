# Centering model and card-crop model: notes and todo

Written 2026-09-17. Two separate models, both deferred until the surface work lands.

## 1. Centering model (border-to-edge distances)

**What it predicts.** TAG's per-side centering numbers: the distance in pixels
from the card edge to the printed border on the left, right, top and bottom
of each side. Manifest columns: `dte_front_left/right/top/bottom`,
`dte_back_left/right/top/bottom` (all 27,751 cards, clean labels, no
marker noise).

**Why a model instead of code only.** Rule-based edge finding breaks on holo
foil, textured borders, dark art touching the frame, and slab reflections;
each rule fixes one case and breaks another. A model trained on 27k cards
learns all of them plus TAG's convention for where the border "is".

**Shape.** Same stack as the surface-score regressor (`training/trainlib`,
`train.py`, `ScoreRegressor`): input = color whole-card image at 896×1248
(the exact cache Step 8 builds for `surface_rgb`, so no new images), output =
4 regression targets per side (DTE px / 1000 as the target scale, MAE
reported in pixels). One new `TASKS` entry (`centering_rgb`) with a rows
builder from the manifest, like `surface_side_rows`. About 1 h of code +
tests, ~5 h box time for 10 epochs.

**Hybrid at inference.** Model predicts the four distances; a narrow
classical edge search around each prediction snaps to the exact pixel where
the image allows. Large disagreement between the two = bad photo flag.

**Phone caveat.** TAG images are deskewed and square to the frame; a phone
photo is not. Centering on phones needs the crop model below first, then
the phone-photo fine-tune later.

**Todo**
- [ ] add `centering_rgb` task (rows builder, 4 targets, tests) after Step 8 starts
- [ ] local smoke on the 4070 (300 cards, 2 epochs)
- [ ] handoff step for the box (reuses the `surface_rgb` resized cache)
- [ ] accept: val MAE in pixels vs a baseline of predicting the dataset median DTE
- [ ] classical snap + disagreement flag (inference service)

## 2. Card-crop model (outer edge / four corners in a photo)

**What it predicts.** The four corners of the card in a user's photo, so the
app can perspective-warp to a clean no-background crop (cleaner than TAG's
orange-trim crop) with no manual alignment. Runs first in the phone
pipeline; everything else sees the deskewed crop.

**Why separate from centering.** TAG images never show a card at an angle on
a background, so they cannot teach "find the card in a photo". Labels come
from photos.

**Labels**
- Real: every confirmed alignment from the app's manual centering tool =
  four corners for that photo. Today only ~30 exist (saved-to-collection
  only; buckets were cleared). Change the app to store every confirmed
  alignment (photo downscaled to ~1,500 px long side, ~300–400 KB, plus the
  four corners as fractions in a fixed order TL, TR, BR, BL), before the
  save-to-collection decision.
- Synthetic: TAG's deskewed cards pasted onto photographed backgrounds at
  random angle/scale/lighting = unlimited exact-corner examples. Train on
  these first; fine-tune with real alignments.
- The ~30 real ones are the first honest test set, not training data.

**Shape.** Four keypoints from a downscaled photo (small network, could run
on-phone), then a classical edge snap around each corner, then the warp.

**Photo shoot protocol (evening of 2026-09-17).** Target 300 photos now, 500–1,000
over the next weeks via testers. Variety over count: ~50 cards × ~6 conditions.
- Backgrounds: wood, dark cloth, white paper, cluttered desk, patterned; a
  couple close to the card's border color.
- Lighting: window daylight, single side lamp, overhead room light, a couple
  with glare, a couple with a hand/phone shadow.
- Angle/distance: flat and square, tilted 15–30°, rotated a little, some
  with the card filling only half the frame.
- Card types: yellow-border, dark/black border, full art, holo; a few in
  sleeves/top loaders; a few slabbed if available.
- Two phones if possible.
- Save the FULL ORIGINAL photo untouched + one JSON per photo with the four
  corners as fractions of width/height (TL, TR, BR, BL), image size, and the
  phone model. Do not store the cropped result in place of the original.
- Bonus: any TAG-graded card you own, shot in every condition, cert number
  in the file name. Those become the first phone-domain labels for every
  other model (corners, edges, surface, centering).
- Keep wrong alignments too, flagged; they are hard test cases.

**Todo**
- [ ] app: store every confirmed alignment (photo + corners JSON) to a bucket
- [ ] photo folder from the user's own cards (originals + JSON)
- [ ] synthetic composite generator from TAG deskewed cards (plan to write)
- [ ] corner keypoint model (plan to write), evaluated on the real photos
- [ ] fine-tune once a few hundred real alignments exist
- [ ] inference: corner snap + perspective warp = the app's crop
