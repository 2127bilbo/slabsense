# Handoff: card model (Step 10) and centering v2 (Step 11)

**For the Claude instance taking this over.** Two pieces of work, in order.
Step 10 is a new model; Step 11 is a retrain of an existing one. Both are
self-contained here; `training/README.md` is background and
`training/HANDOFF-rented-gpu.md` Steps 0–2 and 9 are the box setup and the
conventions (one run at a time, monitor `log.csv`, never read the test split
to choose between versions, copy artifacts home, report numbers, do not
retune thresholds on the box). When both are done the app session
(the one that wrote this) takes the ONNX files and wires them in.

Written 2026-09-21 from measurements on the app side. Everything quoted as a
number below was measured; nothing is a guess.

---

## Why (what the app needs and does not have)

The app grades a card from two phone photos. Today the user places the card's
outer edge and the artwork frame by hand in the centering tool, after a pixel
detector makes a first guess. Three models are live or tested:

| model | input | output | status |
|---|---|---|---|
| corners v3-phone, edges v2-phone | TAG-framed crops of the card rectangle | wear, deduction per slot | live on every grade path since 2026-09-20 |
| centering_rgb v1 | the card rectangle, 896×1248 | the four card-edge-to-frame distances, per-mille | exported and tested, **not live** (Step 11 explains why) |
| *card model* | the whole photo | where the card is | **does not exist** — Step 10 |

What the owner wants, in order: the photo is taken as straight as possible;
a model separates the card from any background; it traces the card's outline
even when the photo is crooked, the card is rotated, the perspective is off,
or the card has a natural bow (old cards do); the card is squared and
flattened; the app gets a **tight crop** (card edge exactly at the border) for
the centering and corner/edge models, and a **graded image** with a small
margin of real background around the card, like TAG's orange trim, so nothing
on the card is ever trimmed. Then the existing models run on the tight crop.

These stay separate models. The card model looks at the whole photo at low
resolution to find a shape; the centering model needs the card at high
resolution to measure borders that are one or two percent of its width. The
card model can be tiny and fast; it sits in front of the others.

---

## Step 10: the card model

### 10.0 What it is

A binary segmentation model: input a photo letterboxed to 512×512, output a
one-channel card mask at 512×512 (logits). Everything geometric — corners,
bowed edges, the rectifying warp, the two crops — is done from the mask by
the app, not by the model. A mask handles a bowed card naturally (its outline
is four gentle curves); four-corner regression would not.

Backbone: a timm `mobilenetv3_large_100` or `convnext_nano` encoder with a
light U-Net-style decoder to 1/4 resolution, bilinearly upsampled to full
size. Target size on disk: under 10 MB fp16. Speed target in the browser:
under 50 ms on WebGPU, under 1 s on WASM, at 512×512.

Loss: BCE with logits + Dice, equal weight. Metric: IoU, and the two numbers
the app actually cares about (10.4).

### 10.1 Data: synthetic composition, no manual labelling

The TAG dataset already gives 55,499 colour scans (`rgb` view, front and
back) with the card's rectangle measured per image in
`training/derived/centering_boxes_rgb.parquet` (`x0,y0,x1,y1` in the
full-resolution image; `ok` true for 99.2 %). Each scan has TAG's flat orange
trim (~46 px) around the card. That is the label source: cut the card out by
its box, and its mask is known exactly.

Two refinements to the cutout, both cheap:

- **Real rounded corners.** The box is the bounding box; inside its four
  corners there are small orange regions beyond the card's rounded tip.
  Flood-fill them from the box corners (the same fill as
  `trainlib/phone_aug.recolour_backdrop`, tolerance 60, grow 2) and set them
  transparent in the cutout's alpha. The mask must trace the real corner, not
  the box corner, or the app's corner crops will be framed on the wrong point.
- **Keep an alpha fringe.** Anti-alias the cutout's edge (1–2 px) so composited
  edges do not look razor-cut; real photos never are.

Compose one training sample as follows, every parameter random per sample
(`numpy.random.Generator`, seeded per epoch for reproducibility):

1. **Background.** From a background pool (10.2). Random crop and scale to
   the working canvas (e.g. 1024×1024, then downscaled to 512 at the end so
   edges and textures survive), random flip, brightness ±30 %, colour
   temperature ±10 %.
2. **Card placement.** Scale the cutout so the card's long side covers 30–95 %
   of the canvas. Rotate by ±25° (p = 0.85), or 90°/180°/270° (p = 0.15).
   Apply a random homography: move each corner independently by up to 8 % of
   the card size, so the card is seen slightly from the side.
3. **Bow (p = 0.5).** Before the homography, displace the card along one axis
   with a smooth curve (half-sine across the other axis, amplitude 0.5–2.5 %
   of the card's long side), warping mask and pixels together. This is the
   old-card arc; the app's rectification must straighten exactly this.
4. **Composite** with the alpha, then add a soft shadow under one or two
   edges (p = 0.6, offset 1–3 % of card size, blur, darkness 10–40 %).
5. **Photo degradation, in this order:** glare blob (p = 0.3, a soft white
   ellipse at 20–60 % opacity anywhere on the card), Gaussian blur radius
   0–1.5 px at 512 scale (p = 0.6), sensor noise, JPEG quality 55–90,
   brightness/contrast ±25 %, and a resolution loss (downscale to 0.4–0.8 and
   back, p = 0.3).
6. **Distractors (p = 0.3):** a second card cutout partly in frame or partly
   under the main card, a sleeve-coloured rectangle, a hand-coloured blob at a
   corner. The mask marks only the main card.
7. **Letterbox** to 512×512 (pad to square with the background's own edge
   colour), and keep the letterbox transform in the sample record.

Volume: on-the-fly composition, no cache. 60,000 samples per epoch, 12
epochs, batch 32, AdamW lr 3e-4 with cosine decay, EMA 0.999, AMP. Expect
under an hour per epoch on the rented box; if the compositor is the
bottleneck, use 16 loader workers.

A held-out synthetic val set (2,000 samples from val-split cards, fixed
seed) tracks training. It is **not** the acceptance test.

### 10.2 Background pool

Synthetic robustness is decided by the backgrounds. Use three sources, mixed
about equally:

- **Procedural**: flat colours, two-tone gradients, wood-grain (sinusoidal
  stripes with noise), fabric weave (fine crossed lines), speckle/carpet,
  paper with creases. Cheap and endless.
- **Real surfaces, owner-provided**: the owner will photograph 40–60 empty
  surfaces they and their testers actually use — desks, tables, mats, floors,
  the same lighting they scan under. These matter most; put them in
  `training/data/backgrounds/` (not in git). Augment heavily.
- **Cards as clutter**: TAG scans of *other* cards, scaled down, as the
  distractors in 10.1 step 6.

Do not pull an internet image dataset for this; the licensing is not worth
the trouble and the owner's real surfaces are the ones that matter.

### 10.3 Real validation set (the acceptance test)

Synthetic accuracy proves nothing about phone photos. The acceptance test is
**real photos with hand-placed corners**. The app already has the tool for
that: the centering tool's outer line is exactly the card's outline, placed
by the owner. Since 2026-09-21 the app has a per-device toggle, Settings →
"Keep Originals For Training", that stores the original front and back
photos and the four confirmed corners with every saved card
(`<user>/<scan>/training/{front.jpg,back.jpg,labels.json}` in the
`card-images` bucket; corners as 0–1 fractions of the photo, see
`src/lib/training-labels.js`). Every card the owner scans with it on is a
labelled real sample. The faster route, and the one the owner uses: shoot
cards with the phone's own camera and label on the PC with
`npm run models:label-card-val -- --photos <folder>` (the app's bounds
detector suggests the outline; Enter accepts, drag a corner to fix; B/V/X
tag bowed / sleeved / deliberately bad). Both sources write the same
`training/data/card-val/<name>/{front.jpg,labels.json}` layout (photo long
side capped at 2000 px like an app upload; corners as 0–1 fractions;
`tags` present on tool-labelled samples). `npm run models:export-card-val`
pulls the in-app captures into the same folder. Not in git; copy the folder
to the box.

Target: at least 150 real photos (front and back count separately), covering
the owner's usual surfaces, some crooked, some rotated 90°, a few bowed
cards, a few in sleeves, and at least 20 taken deliberately badly (angle,
shadow, low light). The export script above writes the folder the training code should read.

If fewer than 100 real photos exist when the model is ready, train and
report on the synthetic val set, mark the model **provisional**, and say so.

### 10.4 Metrics and acceptance

From the predicted mask, derive the card outline the way the app will
(10.6): largest connected component, contour, and a four-corner fit.
Report, on the real val set:

- **IoU** of the mask against the polygon of the hand-placed corners.
- **Corner error**: mean distance between each predicted corner and the
  hand-placed one, as a percentage of the card's long side. This is the
  number that decides whether the centering model gets a usable crop:
  1 % of the card's long side is ~35 px on a 2000 px upload, and the
  centering model measures borders of 20–60 px, so the target is tight.
- **Failure rate**: photos where no card is found, or the fitted quad is
  not card-shaped (aspect ratio outside 0.66–0.78 after rectification, or
  area under 15 % of the frame).

Accept when, on the real val set: IoU ≥ 0.97, mean corner error ≤ 0.8 % of
the long side, 95th percentile ≤ 2 %, failure rate ≤ 2 %. If the real set
is missing, provisional acceptance is IoU ≥ 0.98 on synthetic val, and the
report must say the real test is still owed.

### 10.5 Export and what to bring home

`training/export_onnx.py` is specific to the ScoreRegressor models; write
`training/export_card_model.py` alongside it with the same shape: fp32
export (opset 17, dynamic batch), fp16 with the safe block list
(`LayerNormalization,GlobalAveragePool,Gemm,Div,Erf,Flatten,Concat` plus
`Resize` and `Sigmoid` — keep anything that is not a conv or matmul in
fp32), int8 for the record, parity on 200 val samples, and a contract
sidecar:

```
inputs.image   float32 [N,3,512,512], NCHW, x/255 then ImageNet mean/std, letterboxed
outputs.mask   float32 [N,1,512,512] logits; sigmoid > 0.5 is card
letterbox      how the app must pad (pad colour: replicate edge), and that
               the mask maps back to the photo through the inverse letterbox
```

Test the fp16 export **on WebGPU** in a browser, not only in Node: the
edges v2-phone export produced a deterministic NaN on one real tile on WebGPU
with nothing out of fp16 range in the stored activations (an in-kernel
accumulation). The scratch bench for that is described in
`training/README.md`, "Shipped 2026-09-20".

Bring home: `runs/card/v1/{best.pt,args.json,log.csv,eval_*.log,eval_*.csv}`
into `training/weights/card/v1/`, the three `.onnx` plus the two sidecars into
`training/weights/onnx/`, and the compositor code committed under `trainlib/`
with tests (a synthetic sample's mask matches its transformed cutout; the
letterbox round-trips; a bowed sample's mask is not a quadrilateral).

### 10.6 What the app will do with it (for context, not your job)

Photo → letterbox → mask → largest component → contour. Straight card: fit
four lines to the contour's four sides (RANSAC), intersect for corners,
perspective-warp to a rectangle. Bowed card: sample the contour into four
polylines, build a grid warp that maps each side's curve to a straight line,
warp. From the same warp produce the tight crop (card edge at the border)
and the graded image (a 3 % margin of the real background around the card).
The centering tool opens with the outer line already placed; the owner
confirms or nudges. The centering model then places the inner line.

The same model also replaces the live viewfinder's card box and the
post-capture "issues detected" check, which today use a texture-variance
detector that grabs patterned tables and cannot see rotation (owner,
2026-09-22: the box jumps on hand jitter and flags good photos). At ~30 ms a
frame on WebGPU it can run live; the classical detector stays as the
fallback for phones without WebGPU. Speed target in 10.0 is set with this
in mind.

---

## Step 11: centering v2 — stop shrinking toward 50/50

### 11.0 What is wrong with v1

`centering_rgb v1` was measured on the app side against TAG's DIG centering
on 1,011 harness sides (`scripts/harness/centering-model.mjs`,
`scripts/harness/results/2026-09-21-centering-model.json`):

| | mean L/R error | mean T/B error | both within 1 pt | within 2 pts |
|---|---|---|---|---|
| v1, held out (203 sides) | 1.90 | 1.43 | 21 % | 56 % |
| v1, all | 1.66 | 1.56 | 26 % | 58 % |

Good, but it **compresses off-centre cards toward 50/50**:

| TAG says the card is off by | v1 says | n |
|---|---|---|
| 0–2 points | 1.6 | 165 |
| 2–5 | 2.7 (TAG 3.5) | 461 |
| 5–10 | 4.6 (TAG 6.8) | 314 |
| 10–20 | 8.0 (TAG 12.7) | 68 |

Fed to the grading engine with the corner/edge dings held fixed, that moves
the grade on 15 % of cards, almost always lenient (72 lenient, 2 harsh), and
lifts the TAG 9–10 bucket error from 0.17 to 0.33. A single post-hoc gain
of 1.22 on (ratio − 50), fitted on the training split, gets held-out
within-2-points to 65 % but does not remove the effect (5–10 bucket: 5.3 vs
6.75). It is a training-loss problem: a Huber loss on four distances that
are mostly near their mean learns to hedge toward the mean.

### 11.0b Cache: rebuilding the centering crop cache on a fresh box

`trainlib.cache_cli --task centering_rgb --splits train,val,test --from-cache
--workers 32` (the same command used for `surface_sfx`/`surface_rgb`, Step 8)
resizes the 896×1248 card crop from the **rgb** whole-card original. It does
not require a separate bulk pull first: `cache_cli --from-cache` falls back
to a per-key R2 download for any original that is not already local
(`trainlib/cache.py`'s `_LazyReader` builds the R2 client lazily on first
use), so on a fresh box it simply downloads each missing rgb original as it
resizes it and writes only the 48 GB of 896×1248 cropped card images to
disk — never the full set of originals. Rgb-only is ~55k files, about
**220 GB through the network, ≈ $9, ≈ 20–40 min (55k keys at 25–50 files/s)**. This fallback
still needs `source /workspace/env.sh` (the `B2_KEY_ID`/`B2_APP_KEY` env
file from Step 7.1) so the lazily-built R2 client can authenticate.

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
.venv/bin/python -m trainlib.cache_cli --task centering_rgb --splits train,val,test --from-cache --workers 32
```

Disk: 100 GB free is enough (48 GB of crops plus headroom); no separate
`surface_cache_cli pull` step is needed for this task.

### 11.0c Pre-step: copy the v1 checkpoint to the box

`weights/centering_rgb/v1/best.pt` is gitignored (`.gitignore:67`) and is
**not** present on a fresh box — nothing scp's it up as part of the earlier
steps. The chain below reads it (baseline evals) before it trains v2, so
without this step the chain dies partway through, after the cache step has
already spent time and money. From the local machine, before starting the
box:

```bash
ssh -p <port> root@<host> mkdir -p /workspace/SlabSense/training/runs/centering_rgb/v1
scp -P <port> "G:/Grading App/SlabSense/training/weights/centering_rgb/v1/best.pt" \
  root@<host>:/workspace/SlabSense/training/runs/centering_rgb/v1/best.pt
```

The chain's first line is a guard that fails fast (before the cache step
spends money) if this copy was skipped:

```bash
test -f runs/centering_rgb/v1/best.pt || { echo "missing v1"; exit 1; }
```

### 11.1 Changes

The three flags below exist in `trainlib.train` as of the `tag-dataset`
branch (verified 2026-09-21: local smoke on the 4070, see
`training/README.md` "Centering v2"), each gated on the task having a
`ratio_pairs` spec so corners/edges are untouched:

- **Ratio weight ruling (2026-09-21, re-measured on the v1 checkpoint at
  real val batches, gradient share not loss-value ratio):** at the smoke's
  ~25 pm distance error the ratio term's loss *value* is ~40× the distance
  term's, but that ratio only shrinks the closer training gets to
  convergence — the Huber distance term is quadratic near its minimum so its
  gradient shrinks with the error, while the L1 ratio term's sign gradient
  does not. At v1-level distance error (~2 pm) the **gradient** share kept
  by the distance term is ≈ 9 % at `--ratio-weight 0.02` and only ≈ 2 % at
  `0.1`. So **`0.02` is the primary weight** (the box run uses
  `--ratio-weight 0.02`), not `0.1`: at `0.1` the distance term is expected
  to be drowned out and the distance MAEs to plateau above v1. Keep the
  ratio term as L1 (not Huber) — Huber with the same beta (0.05 = 5 ratio
  points) would be an L2 loss for the ~1.5-point errors nearly every card
  has, which is exactly the mean-seeking behaviour blamed for v1's
  compression, and it should not be reintroduced on the quantity the engine
  consumes. If v2 hits the distance MAEs but the ratio metrics do not move
  at `0.02`, one follow-up `v2b` with `--ratio-weight 0.1` is allowed;
  nothing else.
- `--ratio-weight` (default 0.0/off in the code; use 0.02 here) — one-line: adds an L1 term on the
  predicted vs. target `l/(l+r)`/`t/(t+b)` ratios to the training loss.
- `--balance-deviation` — one-line: oversamples off-centre training sides via
  a `WeightedRandomSampler`, capped-uniform per bucket on TAG's larger-axis
  deviation (see the README's "Centering v2" sampler note for the shares).
- `--aug phone` — one-line: adds blur/JPEG/downscale-upscale softness at
  train time, without the backdrop recolour or loose-crop padding that
  `phone` mode uses for corners/edges (the crop edge is authoritative here).

Exact train command for the real run:

```bash
.venv/bin/python -m trainlib.train --task centering_rgb --run-name v2 --epochs 10 --batch-size 8 \
  --workers 8 --drop-path 0.1 --ema-decay 0.999 --aug phone --ratio-weight 0.02 --balance-deviation
```

Fallback, only if v2's distance MAEs pass but its ratio metrics do not move:

```bash
.venv/bin/python -m trainlib.train --task centering_rgb --run-name v2b --epochs 10 --batch-size 8 \
  --workers 8 --drop-path 0.1 --ema-decay 0.999 --aug phone --ratio-weight 0.1 --balance-deviation
```

Keep the v1 recipe (`convnext_tiny`, 896×1248 card crop, EMA 0.999,
drop-path 0.1, light aug, edge jitter ±3 %, 10 epochs, batch 8) and change
three things:

1. **Ratio term in the loss.** In `trainlib/models.masked_loss`, for the
   `centering_rgb` task only, add an L1 term on the two ratios computed from
   the predicted distances, `l/(l+r)` and `t/(t+b)`, against the same ratios
   from the targets, weighted by `--ratio-weight` (ruled value: 0.02 — see
   "Ratio weight ruling" above; check the two terms in the log, the ratio
   term will still dominate the *loss value* at 0.02, that is expected). The
   ratio is what the engine consumes; the loss should say so.
2. **Deviation-balanced sampling.** Bucket training sides by TAG's larger
   axis deviation (0–2, 2–5, 5–10, 10–20, 20+) and sample with capped
   per-bucket weights `min((N/5)/n_k, 3.0)` so the five buckets draw roughly
   evenly (bucket 0 is only ~15 % of rows on the real train split, so an
   equal-total-weight rule against it would instead triple how often it is
   drawn — see the README's "Centering v2" sampler note). Report the
   realised per-epoch bucket counts in the log.
3. **Phone softness.** Apply `phone_aug.soften` and `resolution_loss` (blur,
   JPEG, downscale-upscale) at the probabilities used in Step 9, but **not**
   the backdrop recolour or loose-crop padding: the crop is authoritative
   here by design, and the edge jitter already covers small crop error.

Do not change the input size or the targets. Keep edge jitter: it is what
makes "measure from the crop edge" consistent, and the card model will
supply that crop.

Run name `v2`. Add a `--phone-sim` evaluation as in Step 9.2 (blur 1.0 px,
downscale 0.5, no backdrop change) and run it on v1 first for the baseline.

### 11.2 Evaluation and acceptance

Evaluate on val and, once, on test, both clean and phone-sim. In addition
to the four MAEs, add to `trainlib/evaluate.py` for this task:

- the two ratio MAEs (L/R and T/B, in ratio points),
- **compression slope**: regress the PREDICTED deviation on TAG's deviation
  (both as |ratio − 50|, pooled over both axes; `np.polyfit(tag_dev,
  pred_dev, 1)[0]`) — a compressing model reads below 1. This is the
  pred-on-TAG direction, not the reverse (TAG-on-pred): the reverse
  direction is pulled back toward 1 by the prediction noise and can pass a
  "≥ 1" bar even while compressing hard (measured app-side: v1 is 1.03
  TAG-on-pred but 0.555 pred-on-TAG on the same 1,011 sides). v1 on the
  local 60-card val sample after this fix is 0.699 clean / 0.662 phone-sim
  (measured in this repo; see the README "Centering v2" baseline table) —
  the 0.95 acceptance bar below is a real bar against that, not the pre-fix
  ~0.94-reads-as-passing number.
  Report the slope and the per-bucket means as in the table above,
- percentage of sides with both ratios within 1 and within 2 points.

Accept v2 when, on val (clean): mean distance MAE not worse than v1 (l 1.75,
r 1.87, t 1.09, b 1.21), ratio MAE ≤ 1.4 on both axes, compression slope
≥ 0.95, per-bucket means within 10 % of TAG's for the 5–10 and 10–20
buckets, both-within-2 ≥ 68 %; and phone-sim within 0.3 ratio points of
clean. If v2 misses, report and leave v1; do not tune on the numbers.

Eval commands, in order (v1's box-baseline pair first, since the local
4070's v1 numbers in the README were only a 60-card sample — the rented
box's full 2,790-card val split is the real baseline to compare v2 against;
`runs/centering_rgb/v1/best.pt` is where 11.0c copied the v1 checkpoint):

```bash
.venv/bin/python -m trainlib.evaluate --task centering_rgb --checkpoint runs/centering_rgb/v1/best.pt \
  --split val --workers 8 --batch-size 16
.venv/bin/python -m trainlib.evaluate --task centering_rgb --checkpoint runs/centering_rgb/v1/best.pt \
  --split val --workers 8 --batch-size 16 --phone-sim
.venv/bin/python -m trainlib.evaluate --task centering_rgb --checkpoint runs/centering_rgb/v2/best.pt \
  --split val --workers 8 --batch-size 16
.venv/bin/python -m trainlib.evaluate --task centering_rgb --checkpoint runs/centering_rgb/v2/best.pt \
  --split val --workers 8 --batch-size 16 --phone-sim
# only if v2 is accepted on val:
.venv/bin/python -m trainlib.evaluate --task centering_rgb --checkpoint runs/centering_rgb/v2/best.pt \
  --split test --final-eval --workers 8 --batch-size 16
```

A single chained job so the GPU never idles between cache, baseline evals,
training, and v2 evals:

```bash
cd /workspace/SlabSense/training
nohup bash -c '
  test -f runs/centering_rgb/v1/best.pt || { echo "missing v1"; exit 1; }
  source /workspace/env.sh
  set -e
  .venv/bin/python -m trainlib.cache_cli --task centering_rgb --splits train,val,test --from-cache --workers 32
  .venv/bin/python -m trainlib.evaluate --task centering_rgb --checkpoint runs/centering_rgb/v1/best.pt --split val --workers 8 --batch-size 16
  .venv/bin/python -m trainlib.evaluate --task centering_rgb --checkpoint runs/centering_rgb/v1/best.pt --split val --workers 8 --batch-size 16 --phone-sim
  .venv/bin/python -m trainlib.train --task centering_rgb --run-name v2 --epochs 10 --batch-size 8 --workers 8 --drop-path 0.1 --ema-decay 0.999 --aug phone --ratio-weight 0.02 --balance-deviation
  .venv/bin/python -m trainlib.evaluate --task centering_rgb --checkpoint runs/centering_rgb/v2/best.pt --split val --workers 8 --batch-size 16
  .venv/bin/python -m trainlib.evaluate --task centering_rgb --checkpoint runs/centering_rgb/v2/best.pt --split val --workers 8 --batch-size 16 --phone-sim
' > /workspace/centering_v2_chain.log 2>&1 &
```

The `test -f` guard runs before `set -e` so it always fires (11.0c's scp
must have already happened; the chain deliberately dies here rather than
after the paid cache step if it was skipped). If v2's distance MAEs pass
but its ratio metrics do not move, run the `v2b` train command from
"Ratio weight ruling" above by hand, followed by its own pair of val evals
(`--checkpoint runs/centering_rgb/v2b/best.pt`) — do not fold `v2b` into
this unattended chain, since whether to run it is a judgment call on v2's
numbers.

Skip the `cache_cli` line if 11.0b's cache already exists on the box (check
`df -h /workspace` and for `centering_rgb` crops under the cache dir first).
Run the `test`-split eval separately, by hand, only after reading the val
numbers and deciding to accept v2 — never inside this unattended chain, so
the frozen test split is never read automatically.

Budget: no bulk pull needed (11.0b); cache ≈ 20–40 min on a fresh box;
train 10 epochs at ~16.5 min/epoch (the v1 rate) ≈ 2.8 h; evals (four val
passes plus, if accepted, one test pass) ~20 min; **≈ $4 of GPU time + the
~$9 of R2 bandwidth from 11.0b if the cache is not already warm**.

### 11.3 Export and what to bring home

`training/export_onnx.py --task centering_rgb --checkpoint
runs/centering_rgb/v2/best.pt --run-name v2 --parity-rows 200 --batch-size
4` (the `export` extra is needed: `uv pip install --python .venv/bin/python
-e ".[dev,export]"`). Test the fp16 on WebGPU as above. Bring home the run
folder AND the box-computed v1 baseline evals — they land under
`runs/centering_rgb/v1/eval_val*.csv` / `.log` (gitignored on the box) and are
lost with the instance otherwise; copy them into
`training/weights/centering_rgb/v1/` as `eval_val_box.csv`, `eval_val_box_buckets.csv`,
`eval_val_phonesim_box.csv`, `eval_val_phonesim_box_buckets.csv`. Bring home the run
folder into `training/weights/centering_rgb/v2/` and the ONNX files plus
sidecars into `training/weights/onnx/`.

---

## Report format (both steps)

Per model: the acceptance table with v1 (or nothing) beside the new model,
clean and phone-sim where applicable, the test numbers once, the epoch that
produced `best.pt`, the export parity line, and the WebGPU check. Then the
app session runs `scripts/harness/centering-model.mjs --file
centering_rgb-v2.fp16.onnx`, wires the card model into the crop step, and
recalibrates nothing until both are measured in the app.
