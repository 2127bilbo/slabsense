# Card Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A small binary segmentation model that finds the card in a whole phone photo (512×512 letterboxed input → card mask), trained entirely on synthetic compositions of TAG's scans onto backgrounds, and evaluated on real hand-labelled photos, so the app can trace, square and crop the card without the user lining anything up.

**Architecture:** Five new modules under `trainlib/`: `card_cutouts.py` (cut each TAG scan to its measured card box with real rounded-corner alpha, cached as RGBA PNG at long side 1024); `card_backgrounds.py` (procedural textures + the owner's real surface photos); `card_compose.py` (the 10.1 pipeline: place, rotate, homography, bow, shadow, degrade, distractors, letterbox → image, mask, metadata); `card_model.py` (timm `mobilenetv3_large_100` encoder + light U-Net decoder to 1/4 resolution, bilinear to 512, BCE+Dice); `card_metrics.py` (mask → largest component → contour → four-corner fit → IoU / corner error / failure rule); plus `train_card.py`, `evaluate_card.py`, `card_cutouts` and `card_val` CLIs, and `export_card_model.py`. Composition is on the fly in DataLoader workers; nothing synthetic is cached.

**Tech Stack:** Python 3.12, torch 2.9.1+cu128, timm, OpenCV (`opencv-python-headless`, new dependency), numpy, Pillow, pandas/pyarrow, scipy, onnx/onnxruntime (export extra), pytest.

**Spec:** `training/HANDOFF-card-and-centering.md` Step 10 (10.0–10.6). Every number in this plan comes from there. Deviations ruled here: (1) OpenCV is added for the homography and bow warps (PIL's mesh transform cannot express a smooth displacement field); (2) cutouts are cached (55k × ~250 KB ≈ 14 GB) because cutting from the 27-MP originals per sample would make the compositor the bottleneck; the handoff's "no cache" refers to the composed samples, which stay on the fly.

## Global Constraints

- Python `>=3.12,<3.13`; tests via `cd training && .venv/Scripts/python -m pytest -q` (140 pass now; `filterwarnings = ["error"]`). Add `"opencv-python-headless>=4.9"` to `dependencies` in `training/pyproject.toml`.
- Never `git add` `scripts/tag-dataset/tagdataset/cli.py` or `download.py`; never `.pt`/`.joblib`/`.onnx`/images; never `git stash`. Commit only the files each task names. `training/data/` is git-ignored (add it if not).
- Cutout cache: `<cache_dir>/cutouts/<cert>_<side>.png`, RGBA, long side 1024 (LANCZOS), alpha 255 on the card, 0 on the trim beyond the rounded corners, feathered by a 1.5-px Gaussian on the alpha edge. Source: the full-resolution `rgb` image (R2 key from the manifest, or the local full-res cache), cropped to the `ok` box from `derived/centering_boxes_rgb.parquet`. Rounded corners: from each of the four box corners, flood-fill pixels within sum-abs-diff 60 of the corner pixel (4-connectivity), only if that corner pixel is within 200 of TAG orange (247,126,44), only if the component stays under 2% of the crop; those pixels get alpha 0.
- Composition canvas 1024×1024, output letterboxed to 512×512. Sample record: `image` uint8 HWC 512×512×3, `mask` uint8 512×512 (0/255), `meta` dict with `quad` (the four corners of the un-bowed card in output pixels, TL TR BR BL), `bowed` (bool), `letterbox` (`scale`, `pad_x`, `pad_y`, `src_w`, `src_h` — output = src·scale + pad), `card_long_side` (px in output).
- Composition parameters (exact, per sample, from a `numpy.random.Generator`): background crop/scale to canvas, random flip, brightness ±30%, colour temperature ±10% (scale R and B by (1+t) and (1−t), t ~ U(−0.1, 0.1)); card long side covers U(0.30, 0.95) of the canvas; rotation: with p 0.85 U(−25°, +25°), else one of 90/180/270; homography: each corner moved independently by U(−8%, +8%) of the card's long side in x and y; bow p 0.5 applied before the homography: displacement along one axis of amplitude U(0.5%, 2.5%) of the long side following a half-sine across the other axis; shadow p 0.6 (offset 1–3% of card size along a random direction, Gaussian blur σ = 1% of card size, darkness U(0.10, 0.40) multiplied into the background under the shifted mask); glare p 0.3 (soft white ellipse, axes 10–35% of the card, opacity U(0.20, 0.60), centred anywhere on the card); blur p 0.6 radius U(0, 1.5) px at 512 scale (×2 at canvas scale); sensor noise Gaussian σ U(1, 6) on 0–255; JPEG quality U{55..90}; brightness/contrast ±25%; resolution loss p 0.3 (downscale U(0.4, 0.8) and back); distractors p 0.3: one of {a second cutout scaled 0.3–0.8 of the main card, placed so it overlaps the main card by at most 40% and is composited BEFORE the main card (under it) with p 0.5 else partly out of frame; a sleeve-coloured rectangle (random low-saturation colour) partly under the card; a skin-coloured blob (ellipse, colour from {(224,172,105),(198,134,66),(141,85,36)} ± 15) at a random corner of the frame}. Letterbox pads with the mean colour of the canvas's outer 8-px ring.
- Model: `CardSegNet(encoder="mobilenetv3_large_100", pretrained=True)`: timm `features_only=True, out_indices=(1, 2, 3, 4)` (strides 4, 8, 16, 32; channels 24, 40, 112, 960 at 512 input); decoder: 1×1 lateral convs to 64 ch at each level, top-down sum with bilinear ×2, two 3×3 conv+BN+ReLU blocks at the stride-4 level, 1×1 to 1 logit, bilinear ×4 to 512×512. Output `[N,1,512,512]` logits. Loss `bce_dice(logits, target)` = BCEWithLogits + (1 − Dice on sigmoid), equal weight. Input normalisation: x/255 then ImageNet mean/std (same `MEAN`/`STD` as `data.py`).
- Training defaults: 60,000 samples per epoch (an `IterableDataset` with a per-worker seed = `base_seed + epoch·1000 + worker_id`), 12 epochs, batch 32, AdamW lr 3e-4 weight decay 1e-4, cosine decay to 0 after 500 warm-up steps, EMA 0.999, AMP, grad-norm clip 5. Synthetic val: 2,000 samples from val-split cards with fixed seed 12345, regenerated identically each epoch (map-style dataset seeded per index). Log columns: `epoch,train_loss,val_loss,lr,seconds,iou,corner_err_pct,fail_rate`. Best checkpoint by val `iou`. Checkpoint keys: `model` (EMA weights), `encoder`, `epoch`, `iou`, `input_size` (512).
- Metrics (`card_metrics.py`): `mask_to_quad(mask_bool) -> (quad[4,2] float or None, contour)`: largest 4-connected component; `cv2.findContours` external; `cv2.approxPolyDP` with ε = 2% of the contour perimeter; if that yields 4 points use them, else fit four lines by splitting the convex hull at its four extreme points (max x+y, x−y, −x−y, −x+y) and intersecting adjacent least-squares lines; order TL, TR, BR, BL by angle from the centroid. `iou(mask_pred, mask_true)`; `corner_error_pct(quad_pred, quad_true, long_side)` = mean of the four matched corner distances / long side × 100; `is_failure(quad, frame_wh)` = no quad, or area < 15% of the frame, or rectified aspect (short/long of the side lengths' means) outside 0.66–0.78. Real-val loader: `training/data/card-val/<scanId>/{front,back}.jpg` + `labels.json` (`sides.<side>.corners.{tl,tr,bl,br}.{x,y}` as fractions of the stored jpg; `rotation` must be 0 — if non-zero, skip the side, count it, and report the count).
- Acceptance (real val): IoU ≥ 0.97, mean corner error ≤ 0.8% of the long side, 95th percentile ≤ 2%, failure rate ≤ 2%. Provisional (fewer than 100 real photos): synthetic-val IoU ≥ 0.98, report must say the real test is owed.
- Export: `export_card_model.py` mirroring `export_onnx.py`: fp32 opset 17 dynamic batch; fp16 via `convert_float_to_float16(keep_io_types=True, op_block_list=[LayerNormalization, GlobalAveragePool, Gemm, Div, Erf, Flatten, Concat, Resize, Sigmoid])`; int8 dynamic; parity on 200 synthetic val samples (mean abs logit diff, IoU agreement); contract sidecar `card-<run>.json` with `inputs.image` `[N,3,512,512]` NCHW normalisation and letterbox rule, `outputs.mask` `[N,1,512,512]` logits (sigmoid > 0.5 is card), and the inverse-letterbox note. Sizes must be under 10 MB fp16 — if the mobilenet decoder exceeds it, report; do not swap encoders silently.

---

## File structure

| File | Responsibility |
|---|---|
| `training/trainlib/card_cutouts.py` | cutout with rounded-corner alpha; cache builder CLI |
| `training/trainlib/card_backgrounds.py` | procedural textures, real-surface pool, sampling |
| `training/trainlib/card_compose.py` | one synthetic sample; letterbox helpers |
| `training/trainlib/card_data.py` | `SyntheticCards` iterable dataset, `SyntheticVal` map dataset, `RealCardVal` |
| `training/trainlib/card_model.py` | `CardSegNet`, `bce_dice` |
| `training/trainlib/card_metrics.py` | quad fit, IoU, corner error, failure rule |
| `training/trainlib/train_card.py`, `evaluate_card.py` | loop and evaluation CLIs |
| `training/export_card_model.py` | ONNX export + sidecars |
| `training/tests/test_card_*.py` | one test file per module |
| `training/README.md`, `training/HANDOFF-rented-gpu.md` | section + Step 12 |

---

### Task 1: Cutouts

**Files:**
- Create: `training/trainlib/card_cutouts.py`
- Modify: `training/pyproject.toml` (opencv), `.gitignore` (`training/data/`)
- Test: `training/tests/test_card_cutouts.py`

**Interfaces:**
- Produces: `rounded_alpha(rgb: np.ndarray uint8 HxWx3) -> np.ndarray uint8 HxW` (255 card / 0 trim, feathered); `make_cutout(full_img: PIL.Image, box: tuple, long_side=1024) -> PIL.Image RGBA`; `cutout_path(cache_dir, cert, side) -> Path`; CLI `python -m trainlib.card_cutouts --splits train,val,test [--limit-cards N] [--workers 16] [--from-cache]` reading the manifest + boxes (ok rows only), fetching each `rgb` image through `cache_cli._LazyReader`-style access (local full-res file if present, else R2), writing the PNG atomically, resumable, printing counts.

- [ ] **Step 1: Failing tests**

```python
import numpy as np
from PIL import Image
from conftest import orange_card_png
from trainlib import card_cutouts as cc

def test_rounded_alpha_removes_orange_corner_notches():
    # card with rounded corners: orange trim margin 20 + orange quarter-circle notches of radius 30 at the box corners
    w, h, m, r = 300, 400, 20, 30
    arr = np.zeros((h, w, 3), np.uint8); arr[...] = (247, 126, 44)
    arr[m:h-m, m:w-m] = (200, 190, 60)
    yy, xx = np.mgrid[0:h, 0:w]
    for cy, cx in ((m, m), (m, w-1-m), (h-1-m, m), (h-1-m, w-1-m)):
        cyy = cy + (r if cy == m else -r); cxx = cx + (r if cx == m else -r)
        notch = ((xx - cxx)**2 + (yy - cyy)**2 > r*r) & (abs(xx - cx) < r) & (abs(yy - cy) < r) & (xx >= m) & (xx < w-m) & (yy >= m) & (yy < h-m)
        arr[notch] = (247, 126, 44)
    box = (m, m, w - m, h - m)
    crop = arr[box[1]:box[3], box[0]:box[2]]
    a = cc.rounded_alpha(crop)
    assert a.shape == crop.shape[:2] and a[a.shape[0]//2, a.shape[1]//2] == 255
    assert a[0, 0] == 0 and a[0, -1] == 0 and a[-1, 0] == 0 and a[-1, -1] == 0     # notches transparent
    assert a[5, a.shape[1]//2] == 255                                                # straight edge stays opaque
    assert 0 < a[0, r] < 255 or a[1, r] in (0, 255)                                  # feathered somewhere near the edge

def test_make_cutout_scales_to_long_side_and_keeps_alpha():
    img = Image.open(__import__("io").BytesIO(orange_card_png(400, 600, margin=50)))
    out = cc.make_cutout(img, (50, 50, 350, 550), long_side=200)
    assert out.mode == "RGBA" and max(out.size) == 200 and out.size == (120, 200)
    assert np.asarray(out)[100, 60, 3] == 255
```

- [ ] **Step 2: Run, expect `ModuleNotFoundError`.**
- [ ] **Step 3: Implement** `rounded_alpha` (per-corner flood fill via `scipy.ndimage.label` on the sum-abs-diff ≤ 60 mask, skip if the corner pixel is > 200 from TAG orange, discard components > 2% of the crop; alpha = 255 − 255·fill; feather with `cv2.GaussianBlur(alpha, (0,0), 1.5)`), `make_cutout` (crop, alpha, resize LANCZOS so the long side is `long_side`, `Image.merge("RGBA")`), the cache path, and the CLI with a `Pool` (module-level worker), counts `written/skipped/failed/missing`. Reuse `load_surface_split` for the side list and `cache.cache_path` for local files; R2 via `r2.reader_from_config` lazily.
- [ ] **Step 4: Run tests → pass; full suite.**
- [ ] **Step 5: Commit** `feat(training): card cutouts with rounded-corner alpha`.

---

### Task 2: Backgrounds

**Files:** Create `training/trainlib/card_backgrounds.py`; Test `training/tests/test_card_backgrounds.py`.

**Interfaces:** `procedural(rng, size=1024) -> np.ndarray uint8 HxWx3` choosing uniformly among `flat, gradient, wood, weave, speckle, paper` (each a function `(rng, size)`); `RealPool(folder)` listing `*.jpg/*.jpeg/*.png` (empty pool allowed); `RealPool.sample(rng, size)` = random crop of 40–100% of the image, resized to `size`, random flip; `sample_background(rng, size, pool: RealPool | None)`: with p 1/3 procedural, 1/3 real (if the pool is non-empty, else procedural), 1/3 "clutter" = procedural with 1–3 down-scaled cutouts from a provided `clutter_cutouts` list pasted at random (the caller passes cutout images; if none, plain procedural); then brightness ±30% and colour temperature ±10%.

- [ ] Tests: each procedural generator returns the right shape/dtype and is not constant (std > 2); `RealPool` on an empty temp folder samples procedural without error; `RealPool` with two synthetic images returns `size×size`; `sample_background` with a fixed seed is reproducible.
- [ ] Implement; run; commit `feat(training): card-model backgrounds (procedural + real pool)`.

---

### Task 3: Compositor

**Files:** Create `training/trainlib/card_compose.py`; Test `training/tests/test_card_compose.py`.

**Interfaces:**
- `letterbox(img: np.ndarray, size=512, pad_colour) -> (out, tf)` with `tf = {"scale", "pad_x", "pad_y", "src_w", "src_h"}`; `unletterbox_points(pts, tf) -> pts` (inverse); `apply_letterbox_points(pts, tf)`.
- `bow_field(w, h, axis, amplitude_px, rng) -> (map_x, map_y)` for `cv2.remap`: displacement along `axis` of `amplitude · sin(π · u)` where `u` runs 0→1 across the other axis.
- `random_homography(quad, max_shift_px, rng) -> (H 3x3, new_quad)`.
- `compose(rng, cutout: PIL RGBA, background: np.ndarray, distractor_cutouts: list, canvas=1024, out=512) -> dict(image, mask, meta)` implementing the Global Constraints order exactly: place (scale + rotate), bow (p 0.5) on the RGBA + a float mask, homography, composite with alpha, shadow, glare, blur, noise, JPEG, brightness/contrast, resolution loss, distractors (a distractor composited under the main card is drawn before the main card; "partly out of frame" ones after), letterbox. The `quad` in `meta` is the four card corners after rotation+homography (un-bowed), mapped through the letterbox. `mask` = alpha > 127 of the transformed main cutout, resized to `out` with INTER_AREA then > 127.

- [ ] Tests: (1) with all probabilities forced off (`compose(..., degrade=False)` flag for tests) the mask equals the transformed alpha exactly and the mask's bounding polygon IoU with `meta["quad"]` polygon ≥ 0.98; (2) a bowed sample (`force_bow=True`) has mask-vs-quad IoU < 0.985 and the mask's contour is not 4-point-approximable at ε 2% (use `cv2.approxPolyDP` and assert > 4 points); (3) letterbox round-trip of random points is exact to 1e-6; (4) a full random `compose` with seed 0 is reproducible and returns the documented shapes/dtypes; (5) a distractor sample's mask never includes distractor pixels outside the main card (compose with `force_distractor="under"` and check mask == main alpha).
- [ ] Implement with OpenCV (`cv2.warpAffine`/`warpPerspective` with `BORDER_TRANSPARENT` on RGBA, `cv2.remap` for the bow, `cv2.GaussianBlur`, `cv2.imencode('.jpg')` for JPEG). Keep one function per step so the tests can force them.
- [ ] Commit `feat(training): synthetic card compositor (rotation, homography, bow, shadow, degradation, distractors, letterbox)`.

---

### Task 4: Datasets, model, trainer

**Files:** Create `training/trainlib/card_data.py`, `training/trainlib/card_model.py`, `training/trainlib/train_card.py`; Test `training/tests/test_card_model.py`, `training/tests/test_train_card.py`.

**Interfaces:**
- `card_data.SyntheticCards(cutout_paths: list[Path], bg_pool, samples_per_epoch, base_seed, epoch)`: `IterableDataset`; each worker seeds `np.random.default_rng(base_seed + epoch*1000 + worker_id)` and yields `samples_per_epoch // num_workers` items as `(image tensor float [3,512,512] normalised, mask tensor float [1,512,512], meta)`; `set_epoch(e)`. `SyntheticVal(cutout_paths, bg_pool, n=2000, seed=12345)`: map-style, sample `i` composed with `default_rng(seed + i)`. `RealCardVal(folder)`: yields `(image tensor, mask tensor from the corner polygon, meta with quad and long side, path)`, letterboxed the same way; skips and counts sides with `rotation != 0`.
- `card_model.CardSegNet`, `bce_dice`, `count_params`.
- `train_card.main(argv)`: `--run-name --epochs 12 --samples-per-epoch 60000 --batch-size 32 --workers 16 --lr 3e-4 --ema-decay 0.999 --seed 42 --cutouts-limit N --backgrounds training/data/backgrounds --no-pretrained --device --val-n 2000`; cutout list = all `*.png` under `<cache_dir>/cutouts/` for train-split certs (val for the synthetic val set), from the splits parquet; writes `runs/card/<run>/{args.json, log.csv, best.pt, last.pt}`, log columns per the Global Constraints (`iou`, `corner_err_pct`, `fail_rate` computed on the synthetic val via `card_metrics`), prints peak GPU memory.

- [ ] Tests: model forward on `[2,3,64,64]` gives `[2,1,64,64]` (the decoder must work at any multiple of 32); `bce_dice` of perfect logits → near 0; `SyntheticVal` with two fake cutouts (from `orange_card_png` via `card_cutouts.make_cutout`) returns tensors of the right shape and is reproducible per index; `train_card.main` one epoch on CPU with `--samples-per-epoch 8 --batch-size 2 --workers 0 --val-n 4 --no-pretrained --input-size 64` (add `--input-size` for tests only; it scales canvas/out proportionally) writes the artifacts and a `log.csv` with the documented columns.
- [ ] Commit `feat(training): card segmentation model, synthetic datasets, trainer`.

---

### Task 5: Metrics and evaluation

**Files:** Create `training/trainlib/card_metrics.py`, `training/trainlib/evaluate_card.py`; Test `training/tests/test_card_metrics.py`, `training/tests/test_evaluate_card.py`.

**Interfaces:** per the Global Constraints. `evaluate_card.main`: `--checkpoint --real training/data/card-val [--synthetic-n 2000] [--batch-size 16] [--workers 4] [--device]`; prints and writes next to the checkpoint `eval_synth.csv` (per-sample iou, corner_err_pct, failure) and, if the real folder exists and is non-empty, `eval_real.csv` plus a summary line `real: n=<N> iou=<mean> corner_err_mean=<x> corner_err_p95=<y> fail_rate=<z> skipped_rotation=<k>`; the exit status is 0 either way; the acceptance verdict (accept / provisional / reject) is printed from the rules in the Global Constraints.

- [ ] Tests: a synthetic rectangle mask at a known rotation → `mask_to_quad` recovers the corners within 1.5 px; a bowed mask (built by warping a rectangle with `bow_field`) → still returns a quad whose corner error vs the true un-bowed corners is < 1.5% of the long side; `is_failure` on a square (aspect 1.0) → True, on a 0.71 rectangle covering 40% of the frame → False, on a tiny quad → True; `evaluate_card.main` on a tiny random checkpoint with a fake real folder of 2 scans (write jpgs + labels.json with the app schema) writes both CSVs and prints `provisional` (n < 100).
- [ ] Commit `feat(training): card-model metrics (quad fit, IoU, corner error, failure rule) and evaluation`.

---

### Task 6: Export

**Files:** Create `training/export_card_model.py`; Test `training/tests/test_export_card_model.py` (skipped with a clear reason if `onnx`/`onnxruntime` are missing).

- [ ] Mirror `export_onnx.py`'s structure: load the checkpoint, build `CardSegNet(pretrained=False)`, fp32 export (opset 17, dynamic batch, input name `image`, output `mask`), fp16 with the block list in the Global Constraints, int8 dynamic quantisation, parity on 200 `SyntheticVal` samples (mean abs logit diff; fraction of pixels where fp16 and torch disagree on `sigmoid > 0.5`; must be < 0.5%), contract sidecar and parity sidecar, sha256 for each file. Test on a tiny untrained model with `--parity-rows 4 --input-size 64`.
- [ ] Commit `feat(training): card model ONNX export with contract and parity sidecars`.

---

### Task 7: Smoke on the 4070, docs, handoff Step 12

- [ ] Build 400 train-card + 100 val-card cutouts locally (`card_cutouts --splits train:400,val:100 --workers 8`; downloads ~1,000 rgb originals ≈ 4.5 GB unless already in the local cache). Record counts and time.
- [ ] Train a smoke detached: `train_card --run-name smoke --epochs 2 --samples-per-epoch 4000 --batch-size 8 --workers 6 --val-n 200` with `--backgrounds training/data/backgrounds` (may be empty: procedural only). Record s/epoch, samples/s, peak VRAM, and whether the loader kept up (`nvidia-smi` utilisation during the epoch). If the compositor is the bottleneck at 6 workers, say so with numbers.
- [ ] Evaluate: `evaluate_card --checkpoint runs/card/smoke/best.pt --real training/data/card-val` (real folder may be empty → synthetic only). Export with `export_card_model` and record file sizes and parity.
- [ ] Look at 12 composed training samples and 12 synthetic-val samples written by a small script (image + mask overlay) and describe what you see; if the mask and card disagree anywhere, stop and report.
- [ ] README "Card model" section: what it is, the cutout cache, the compositor parameters (pointer to the plan), backgrounds folder, real-val folder and export command, metrics, smoke numbers, the local samples/s and what that implies for `--workers` on the box.
- [ ] Handoff Step 12: cutouts on the box (`--splits train,val,test --from-cache --workers 32`, ~14 GB, from the full-res originals already there), copy `training/data/backgrounds/` and `training/data/card-val/` up from the PC (`scp -r`), train `--run-name v1 --epochs 12 --samples-per-epoch 60000 --batch-size 32 --workers 16`, evaluate (synthetic + real), acceptance / provisional rule, export, WebGPU check note (app session), bring-home list, budget (12 epochs at the measured samples/s scaled ×3 for the 5880).
- [ ] Commit `docs(training): card model smoke, README section, handoff Step 12`.

---

## Self-review

**Spec coverage.** 10.0 model/loss/metric: Tasks 4, 5. 10.1 composition steps 1–7: Task 3 (all seven, with the exact probabilities in the Global Constraints). 10.2 three background sources: Task 2. 10.3 real val set from the app's folder and schema: Task 5 loader. 10.4 metrics and acceptance: Task 5 + the constraints. 10.5 export, fp16 block list, contract, bring-home: Task 6 + Task 7 handoff. 10.6 is the app's.

**Placeholder scan.** Tasks 2–7 give tests as specifications rather than verbatim code because they are mostly procedural/visual; the implementer writes them to the stated assertions. Task 1 carries verbatim tests.

**Type consistency.** `meta["quad"]` is TL TR BR BL float pixels in output space everywhere (compose, SyntheticVal, RealCardVal, metrics); `letterbox` tf dict keys are fixed in the constraints; the checkpoint keys are fixed; `CardSegNet` input/output names `image`/`mask` in the export match the contract.
