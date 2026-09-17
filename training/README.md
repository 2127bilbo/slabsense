# training

Corner and edge score models trained on the TAG dataset (spec §7). Reads the tables built by `scripts/tag-dataset`; never modifies them.

## Setup (once)
```powershell
cd training
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install torch==2.9.1 torchvision --index-url https://download.pytorch.org/whl/cu128
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
copy config.example.toml config.toml
.\.venv\Scripts\python.exe -c "import torch; print(torch.cuda.get_device_name(0))"
```
R2 credentials come from the same env vars the dataset package uses (`B2_KEY_ID`, `B2_APP_KEY`).

## Commands (from `training/`, venv python)
| Command | What it does |
|---|---|
| `python -m trainlib.cache_cli --task corners --splits train:500,val:100` | pull those cards' crops into the local cache (resumable) |
| `python -m trainlib.train --task corners --run-name smoke --epochs 3 --limit-cards 500 --val-limit-cards 100 --workers 2` | train; writes `runs/corners/smoke/{log.csv,best.pt,last.pt,args.json}` (`--workers 2`: 6 workers exhausted system RAM on a 4070 box with other apps open) |
| `python -m trainlib.evaluate --task corners --checkpoint runs/corners/smoke/best.pt --split val` | per-grade MAE table → `eval_val.csv` |
| `... --split test --final-eval` | the frozen test split; only for an accepted model |

Cache location: `cache_dir` from `config.toml` (`scripts/tag-dataset/data/cache/` by default). Two caching modes, chosen per task from `tables.TASKS[task]["cache_resize"]`:
- **Full resolution** (`cache.cache_path`, `cache_dir/<key>`): the downloaded file, byte-for-byte. Used for corners (~105 GB for all cards) and, with `cache_cli --no-resize`, for any task.
- **Pre-resized** (`cache.resized_path`, `cache_dir/resized/<w>x<h>/<key>.jpg`): the downloaded bytes decoded, rotated so the long side is horizontal, resized to the task's input size, and saved as JPEG quality 95 with 4:4:4 chroma subsampling (`subsampling=0` — Pillow's default 4:2:0 would average 2x2 color blocks, throwing away color detail at hairline edge/corner marks). `cache_cli` uses this automatically for edges (input size 1024×192, ~30 GB for all 222,008 edge crops, vs 833 GB full-resolution). `--no-resize` forces full-resolution caching instead. If the edge model's input size changes later, the resized cache must be rebuilt at the new size — old `resized/<old-w>x<old-h>/` files are not reused or migrated.

`tables.filter_cached(df, cache_dir, task)` counts a row as cached if either file exists, so a resized-only edge cache is not reported as all-missing.

`evaluate` without `--limit-cards` loads the whole split and then drops every row whose crop is not cached, so match `--limit-cards` to what was cached or cache the full split first.

The 2026-09-16 wear/deduction/angle corner smoke (`run-name smoke2`) had to be launched as a detached OS process with `--workers 0`, outside the interactive shell: the sandboxed shell's own memory guard killed both `--workers 2` and in-shell `--workers 0` runs on a box that had only ~5 GB free at the time (unrelated apps — dozens of `camoufox` processes, several `node` processes, browsers — were holding the rest of the 31.8 GB). `--workers 2` (or higher) is still the right choice once RAM is actually available; `--workers 0` is slower per epoch (in-process loading) but is the fallback when the host is this constrained.

## Metrics
Corner and edge models predict typed per-slot targets, not raw fill/fray scores:
- `wear` (binary): whether TAG recorded a ding at that slot (`ding_count > 0`). Metrics: rank-based
  AUROC (no sklearn dependency; NaN if a batch/split has only one class), precision and recall at a
  0.5 score threshold, and the positive count (`npos_wear`).
- `deduction` (regression): the summed marker deduction at that slot (TAG points, 0–1000), masked
  where no marker exists at that slot. Metric: MAE in TAG points over unmasked rows.
- `angle` (corners only, regression): `score_angle`, masked on back corners where TAG never records
  it. Metric: MAE in TAG points.

`score_fill`/`score_fray` (per-corner and per-edge) are **not** training targets: across 27,751 certs
they sit below 900 points on only 0.1% of corner rows and 8 of 222,008 edge rows, so there is almost no
variance for a regressor to learn from. They stay in the parquet tables for reference. The model emits
raw logits; `models.to_scores` applies sigmoid to get a 0–1 probability (binary) or score (regression),
and `models.masked_loss` combines masked BCE-with-logits (binary) and masked Huber-on-sigmoid
(regression, β = 0.05) into one loss, normalized by the total number of unmasked elements across all
targets. Metrics are reported overall (per epoch, in `log.csv`) and per grade (`evaluate`'s
`eval_<split>.csv`), with `ALL` as the last row.

## Results
| Date | Task | Targets | Cards (train/val) | Epochs | s/epoch | Peak VRAM | Best val loss | auroc_wear | mae_deduction | mae_angle |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-09-16 | corners | wear / deduction / angle | 500/100 | 3 | 107, 88, 105 | 5.93 GiB | 0.2424 (epoch 2) | 0.828 (final epoch) | 160 pts (final epoch) | 2.6 pts (final epoch) |
| 2026-09-16 | edges | wear / deduction | 500/100 | 3 | 320, 308, 305 | 4.07 GiB | 0.2811 (epoch 3) | 0.779 (final epoch) | 323 pts (final epoch) | n/a (no angle target) |
| 2026-09-16 | edges (resized cache) | wear / deduction | 500/100 | 3 | 85, 67, 66 | 4.07 GiB | 0.2798 (epoch 2) | 0.765 (final epoch) | 330 pts (final epoch) | n/a (no angle target) |
| 2026-09-16 | corners v1 (full) | wear / deduction / angle | 22,202/2,790 (all cards) | 12 | 530–553 | 11.41 GiB | 0.18695 (epoch 5) | 0.919 (val, best.pt) | 105 pts (val, best.pt) | 2.41 pts (val, best.pt) |
| 2026-09-16 | edges v1 (full) | wear / deduction | 22,202/2,790 (all cards) | 12 | 673–734 | 7.73 GiB | 0.19654 (epoch 10) | 0.895 (val, best.pt) | 161 pts (val, best.pt) | n/a (no angle target) |
| 2026-09-16 | corners v2 (full, EMA 0.999 + drop-path 0.2 + strong aug) | wear / deduction / angle | 22,202/2,790 (all cards) | 8 | 541–549 | 11.55 GiB | 0.18282 (epoch 6) | 0.924 (val, best.pt) | 103.7 pts (val, best.pt) | 2.42 pts (val, best.pt) |
| 2026-09-16 | edges v2 (full, EMA 0.999 + drop-path 0.1 + strong aug) — REJECTED, v1 stays | wear / deduction | 22,202/2,790 (all cards) | 12 | 691–734 | 7.86 GiB | 0.20536 (epoch 12) | 0.883 (val, best.pt) | 170 pts (val, best.pt) | n/a (no angle target) |

**Metric definitions changed on 2026-09-16** with the corner/edge target
redesign (`docs/superpowers/plans/2026-09-16-corner-edge-targets.md`):
corners now predict `wear` (binary), `deduction` (regression), and `angle`
(regression) — see Metrics above. `score_fill`/`score_fray` are no longer
training targets (near-zero variance across the dataset); the old
"Best val MAE" / "Low-subset MAE" columns from the pre-redesign fill/fray
smoke no longer apply and are replaced by the columns above. Checkpoint
selection is now by `val_loss` (the combined masked BCE + Huber loss), not
by MAE.

`recall_wear`/`precision_wear` at the fixed 0.5 threshold are **not
informative** after only 3 short epochs: `precision_wear` is NaN and
`recall_wear` is 0.0 because none of the model's sigmoid outputs crossed 0.5
yet, even though ranking quality is good (`auroc_wear` 0.828 and rising each
epoch: 0.810 → 0.826 → 0.828). Use AUROC as the wear metric for now; a full
run should either tune the decision threshold from validation data or add a
`pos_weight` to the BCE term so precision/recall at 0.5 become meaningful.

Full per-grade eval (`runs/corners/smoke2/eval.log`,
`runs/corners/smoke2/eval_val.csv`, 800 val rows across 100 cards):
`auroc_wear` ranges 0.5–0.95 across grades (small per-grade `n`, from 8 to
80 rows), `mae_deduction` from ~54 to ~660 points, `mae_angle` from ~0.7 to
~7.5 points; `ALL` row: `auroc_wear` 0.826, `mae_deduction` 157 pts,
`mae_angle` 2.9 pts, `npos_wear` 184 of 800.

Smoke run on an RTX 4070 SUPER, `convnext_tiny` (pretrained), batch size 32.
Run outside the interactive shell as a detached process with `--workers 0`
(see the Commands section note above) because the sandboxed shell's memory
guard killed worker-based attempts on a box with only ~5 GB free at the
time.

Cache: 4,796 of 4,800 files downloaded, 2.2 GB in 85 s, about 26 MB/s. The 4
files that never downloaded (cert Z9219918 front side) return a confirmed
permanent HTTP 404/403 from the source, not a transient cache miss; every
run since has correctly reported `dropped 4 rows with no cached crop` for
train, handled by `tables.filter_cached` before building loaders.

`train.err` shows a benign `UserWarning: Detected call of
lr_scheduler.step() before optimizer.step()` on the very first AMP step —
`GradScaler` skips the first `optimizer.step()` when it detects `inf`
gradients while calibrating its loss scale, so the scheduler's `.step()`
runs first that one time. This is expected AMP warm-up behavior, not a bug,
and does not recur after step 1.

### Full runs v1 (2026-09-16)

Both tasks trained on the full dataset (all cards; 177,604 corner / 177,602
edge train rows, 22,320 val rows) on a rented RTX 5880 Ada (48 GB), 12
epochs, `convnext_tiny` (pretrained), corners batch 64 / edges batch 32,
`--workers 8`. Checkpoints selected by `val_loss`; `ALL` rows from
`trainlib.evaluate` on `best.pt`. The `test` split was read exactly once per
task, after the val numbers were accepted (corners ≥ 0.85 AUROC and < 160
MAE; edges ≥ 0.80 and < 330). Artifacts in `training/weights/<task>/v1/`
(`best.pt` kept out of git; corners sha256 `aef5ec98…dec2866`, edges
`bb4037fb…df66779`).

| Task | Split | Rows | auroc_wear | precision_wear | recall_wear | npos_wear | mae_deduction | mae_angle |
|---|---|---|---|---|---|---|---|---|
| corners v1 (epoch 5) | val | 22,320 | 0.9194 | 0.698 | 0.753 | 5,390 | 105.0 | 2.41 |
| corners v1 (epoch 5) | test | 22,072 | 0.9225 | 0.702 | 0.761 | 5,308 | 106.7 | 2.37 |
| edges v1 (epoch 10) | val | 22,320 | 0.8947 | 0.604 | 0.251 | 2,110 | 161.3 | n/a |
| edges v1 (epoch 10) | test | 22,072 | 0.8937 | 0.601 | 0.262 | 2,068 | 170.4 | n/a |

Observations for the next iteration (no retuning was done on the box):

- **Corners overfit after epoch 5.** val_loss bottomed at 0.187 (epoch 5)
  and then rose every epoch to 0.529 at epoch 12 while train_loss fell to
  0.025; auroc_wear peaked at 0.919 and slid to 0.849 by the end. 12 epochs
  is too many for corners at this LR schedule; ~5–6 epochs, stronger
  augmentation/regularization, or early stopping would all be cheaper.
- **Edges did not overfit.** val_loss fell monotonically to 0.1965 at epoch
  10 and plateaued (0.1978, 0.1981) as the cosine LR reached zero; train
  and val loss stayed within ~0.015 of each other throughout.
- Unlike the smoke, corners `recall_wear` at the 0.5 threshold is meaningful
  (0.75–0.76); edges recall is still low (0.25–0.26) at 9.5% positives, so
  threshold tuning / `pos_weight` still applies there.
- Test tracks val closely for both tasks (AUROC within 0.003), so checkpoint
  selection on val did not leak.
- Cache: corners 199,924 of 199,936 train+val crops (12 permanent upstream
  misses), edges 199,922 (14 misses); test split 22,072 of 22,072 for both.
  With 48–64 download workers R2 sustained ~105 files/s (corners) and
  ~29 files/s ≈ 97 MB/s (edges, full-res in → 1024x192 out) from the box.
  Note the handoff's cache step only pulled `train,val`; the `test` split
  must be cached too before `--split test --final-eval` (fixed on the box
  by a separate `--splits test` pull).


### Edge smoke (2026-09-16)

Same 500/100-card sample and seed as the corner smoke, `wear`/`deduction`
targets only (edges have no `angle` target). Cache: 4,795 of 4,800 strips
downloaded in 162 s (about 29 files/s, ~17 GB) — 4 unavailable upstream for
the same cert Z9219918 front side as the corners cache, plus 1 further
transient failure (`train.log` reports `dropped 5 rows with no cached
crop`). Trained with `--batch-size 16 --workers 0`; the run was CPU-bound,
not GPU-bound (3.75 MB strips decoded in-process on the CPU, GPU utilization
only 2–7% during training) — this is why edge epochs (305–320 s) run far
longer than corner epochs (88–107 s) despite a smaller batch size and lower
peak VRAM (4.07 GiB vs 5.93 GiB). `precision_wear`/`recall_wear` at 0.5 are
NaN/0.0 for the same reason as corners (no sigmoid output above threshold
yet after 3 short epochs); use `auroc_wear` instead. Per-grade eval
(`runs/edges/smoke/eval.log`, `eval_val.csv`): several grades show NaN
AUROC where `npos_wear` is 0 for that grade in this 100-card sample (no
positive edge-wear rows to rank against); `ALL` row: `auroc_wear` 0.780,
`mae_deduction` 323 pts, `npos_wear` 80 of 800.

### Edge smoke on resized cache (2026-09-16)

Same 500/100-card sample; crops cached pre-resized to 1024×192 (JPEG q95,
4:4:4) instead of full resolution. Cache: 4,796 of 4,800 strips in 146 s
(~33 files/s), 708 MB on disk for the 4,796 strips (≈148 KB each →
~33 GB projected for all ~222k edge crops, matching the ~30 GB estimate
already used in the rented-GPU recipe below). Training (`--batch-size 16
--workers 0`) dropped to 85/67/66 s per epoch — versus 320/308/305 s on the
full-resolution cache — because the GPU is now ~50% busy instead of 2–7%;
peak VRAM unchanged at 4.07 GiB. Best val loss 0.2798 at epoch 2; final
epoch `auroc_wear` 0.765, `npos_wear` 80/800, `mae_deduction` 330 pts;
per-grade `ALL` row (`runs/edges/smoke3/eval.log`): `auroc_wear` 0.761,
`mae_deduction` 329 pts.

Accuracy matched the full-resolution run within the noise of a 3-epoch
smoke (0.765 vs 0.779 AUROC; 329 vs 323 pts MAE) at 4.6x the speed, so **all
edge runs use the resized cache from here on**.

Edge strips will be cached **pre-resized to 1024×192** before any full run,
because the full-resolution edge object set in the bucket is 833 GB — far
too large to cache as-is on a single training box.

## Bucket storage facts

The R2 bucket totals about 1.63 TB:

| Object set | Size |
|---|---|
| Edges (full resolution) | 833 GB |
| SFX | 338 GB |
| Front/back (whole-card images) | 251 GB |
| Corners (full resolution) | 105 GB |
| Dings | 105 GB |

R2 storage cost is roughly $24/month at this size. Corners can be cached
full-resolution on a rented box (~105 GB); edges cannot (833 GB) and must be
cached pre-resized to 1024×192 (~30 GB once the resize-on-cache work lands),
per the note above.

## Full runs on a rented GPU

Once a smoke run looks right locally, the full run (all cards, more epochs)
happens on a rented GPU rather than the local 4070 — corners' full-resolution
cache alone is ~105 GB and a full 12-epoch run over all cards takes hours,
not minutes.

1. **Rent**: a V100 32 GB (16 GB also works for corners/edges) with Ubuntu,
   CUDA driver ≥ 12.8, and ≥ 300 GB disk (headroom for the corners cache,
   the resized edges cache, checkpoints, and the venv).
2. **Set up**:
   ```bash
   git clone <repo-url> && cd SlabSense && git checkout tag-dataset
   cd training
   python3.12 -m venv .venv
   .venv/bin/python -m pip install --upgrade pip
   .venv/bin/python -m pip install torch==2.9.1 torchvision --index-url https://download.pytorch.org/whl/cu128
   .venv/bin/python -m pip install -e ".[dev]"
   cp config.example.toml config.toml   # then set cache_dir = "/data/cache"
   export B2_KEY_ID=...
   export B2_APP_KEY=...
   ```
3. **Cache from R2** (egress from R2 is free, and the box has a datacenter
   link, so this is much faster than the local smoke pulls): corners
   full-resolution (~105 GB) and edges pre-resized (~30 GB once Task 6
   lands):
   ```bash
   .venv/bin/python -m trainlib.cache_cli --task corners --splits train,val --workers 8
   .venv/bin/python -m trainlib.cache_cli --task edges --splits train,val --workers 8
   ```
   8 workers is fine on a rented box (unlike the local 4070 box, there are
   no competing desktop apps eating RAM — see the `--workers 0`/`--workers 2`
   notes above, which are local-box-specific workarounds, not a rented-box
   default).
4. **Train**:
   ```bash
   .venv/bin/python -m trainlib.train --task corners --run-name v1 --epochs 12 --batch-size 64 --workers 8
   .venv/bin/python -m trainlib.train --task edges --run-name v1 --epochs 12 --batch-size 32 --workers 8
   ```
   A V100 has no bf16 support; the training loop already uses fp16
   `autocast` with `GradScaler`, which is exactly what a V100 needs — no
   code change required.
5. **Evaluate**: run `evaluate --split val` first; only once a model is
   accepted, run `--split test --final-eval` exactly once (the frozen test
   split is never read otherwise). Copy `best.pt` and the resulting
   `eval_test.csv` to `training/weights/<task>/v1/` and commit them there.
6. **Expected cost/time** at $0.40/h: corners 3–5 h full-resolution cache,
   under $5; edges 2–4 h once cached at the resized 1024×192 (down from the
   4–6 h estimate against the full-resolution 833 GB set), also under $5.
   Sync `runs/<task>/v1/log.csv` back to this repo for the README.

### v2 recipe: regularized runs

The v1 corner run overfit hard: train loss fell from 0.21 to 0.025 over
12 epochs while val loss rose from 0.19 to 0.53 after epoch 5 (best epoch 5,
auroc_wear 0.919, mae_deduction 105). With 177k crops the ConvNeXt-Tiny
memorizes the training set once the one-cycle rate starts to decay, so v2
adds regularization and shortens the schedule. Three flags, all off by
default so v1 commands behave exactly as before:

| Flag | v2 value | What it does |
|---|---|---|
| `--drop-path 0.2` | 0.2 | stochastic depth in the backbone (timm `drop_path_rate`); adds no parameters, so checkpoints stay interchangeable |
| `--ema-decay 0.999` | 0.999 | keeps an exponential moving average of the weights, updated every step; the EMA copy is what gets evaluated each epoch and saved in `best.pt`/`last.pt` (`ckpt["ema_decay"]` records it) |
| `--aug strong` | strong | training transform adds a random 88–100% window before the resize, widens brightness/contrast jitter to ±20%, and adds ±20% saturation jitter. No rotation (the corner angle target must survive) and no blur (it would erase hairline marks) |

```bash
.venv/bin/python -m trainlib.train --task corners --run-name v2 --epochs 8 --batch-size 64 --workers 8 --drop-path 0.2 --ema-decay 0.999 --aug strong
.venv/bin/python -m trainlib.train --task edges   --run-name v2 --epochs 8 --batch-size 32 --workers 8 --drop-path 0.2 --ema-decay 0.999 --aug strong
```

Accept v2 only if its val `ALL` row beats v1 on auroc_wear and
mae_deduction; otherwise v1 stays the shipped model. The test split is read
once per accepted checkpoint, after val acceptance, and never to choose
between versions.

## Surface detector

A Faster R-CNN detector that finds and classifies surface defects (creases,
dents, pits, print lines, scratches, stains, tears) as boxes on each card
side, plus a separate gradient-boosted regressor that predicts the TAG
deduction (0–1000 points) for a given box's class and geometry. Reads
`surface.parquet` (spec §7); never modifies it.

### Surface detector v2 and v3 (2026-09-17)

| Run | Data | Epochs | s/epoch | map50 (sfx val tiles) | CREASE AP50 | SCRATCH AP50 |
|---|---|---|---|---|---|---|
| v1 | both views, 7 classes | 8 | 3,900 | 0.105 (sfx view row) | 0.337 | 0.058 |
| v2 | sfx only, negatives from grades 8+, class-balanced | 8 | 1,180 | 0.109 | 0.438 | 0.092 |
| v3 | as v2, CREASE + SCRATCH only | 12 | 847 | 0.291 | 0.470 | 0.112 |

v2 matched v1's sfx view, so the noise is in the positive markers rather
than the negatives or the color view. v3 puts all capacity on the two
classes with signal: creases reach 0.47 (recall 0.48 at score 0.5),
scratches stay label-limited at 0.11. Per-side scores for the surface
subgrade come from the separate surface-score regressors (handoff Step 8);
v3 is the candidate for drawing crease boxes, pending its full-card
false-alarm rate. Test split not read for any surface checkpoint.

### Surface v1 diagnosis (2026-09-17, epoch 6 of 8)

`log.csv` at epoch 6: map50 0.072, precision 0.29 / recall 0.20 at score 0.5;
AP50 CREASE 0.34, DENT 0.03, PIT 0.01, PRINT_DEFECT 0.04, SCRATCH 0.06,
STAIN 0.03. A 400-tile diagnostic on positive val tiles (`/workspace/diag`):
map50 0.12 at IoU 0.5, 0.18 at IoU 0.3, 0.21 at IoU 0.1 (boxes are loose,
so localization is part of the gap); recall at score >= 0.05 and IoU 0.3 is
0.49 overall (CREASE 0.81, DENT 0.30, SCRATCH 0.30, PIT 0.05), and only 53%
of labeled boxes have *any* prediction overlapping them, so about half the
labels are simply not found. Drawn tiles show why: TAG's markers often
enclose faint or, in the rgb view, invisible defects, and unmarked visible
defects sit on "clean" sides that the negatives teach as background. Train
tiles: 103,127 (35,707 with boxes, 67,420 box-free); boxes are large enough
(median min-side 80 px; pits 9 px) that the 1024 tiling is not the cause.
v2 (handoff Step 7.9): sfx only, negatives only from cards graded 8+,
class-balanced sampling (`--views sfx --neg-grades ... --balance`).

### v2 outcome (2026-09-16)

- **Corners v2 accepted.** EMA + drop-path 0.2 + strong augmentation over 8
  epochs: best val loss 0.18282 (epoch 6) vs v1 0.18695; auroc_wear 0.924 vs
  0.919; mae_deduction 103.7 vs 105.0; mae_angle 2.42 vs 2.41. The
  regularization removed the late-epoch collapse (val loss stayed within
  0.002 of its best through epoch 8) but bought only half a point of AUROC,
  so the corner model is near what ConvNeXt-Tiny at 384 px extracts from
  these labels; the next lever is a larger backbone or input resolution, not
  more regularization. Test split (read once): auroc_wear 0.9265,
  precision/recall 0.718/0.735, mae_deduction 105.1, mae_angle 2.37 (v1 test:
  0.9225 / 106.7 / 2.37). Weights in `training/weights/corners/v2/`.
- **Edges v2 rejected, v1 stays.** Drop-path 0.1 + EMA + strong augmentation
  over 12 epochs: auroc_wear 0.883 vs v1 0.895, mae_deduction 170 vs 161,
  val loss 0.2054 vs 0.1965, still improving at epoch 12. Edges never
  overfit in v1, so the extra regularization only slowed convergence. If
  edges get another pass, the candidates are longer training at the v1
  recipe, a wider input strip, or a larger backbone.

### Classes and exclusions

`SURFACE_CLASSES = ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"]`
(label 0 is background). `load_surface_split` filters `surface.parquet`
markers before they ever reach a tile:

- keeps only rows whose `engine_type` is one of the seven classes above —
  `ESW_CSW` (edge/corner wear, handled by the edge model) and `PLAY_WEAR`
  are dropped;
- drops zero-width/zero-height rows;
- drops boxes covering more than 25% of the card face (`MAX_BOX_AREA = 0.25`)
  — these are whole-card annotation frames, not localized defects;
- clips `deduction` to `[0, 1000]` TAG points.

Measured on the 2026-09-16 full-table pass: **25,575 kept boxes on 14,768
sides**, with **2,557 whole-card frames excluded** by the area filter
(`ESW_CSW` and `PLAY_WEAR` rows excluded by class before that filter even
runs).

### Tiling

Both views are cut into native-resolution 1024×1024 tiles (`TILE = 1024`,
`STRIDE = 896`, `trainlib/tiles.py`) rather than downscaling the whole
~4391×6063 card to a detector's usual long side (1280): the 2026-09-16 box
size measurement found median sizes of **11 px (pits)**, **160 px
(scratches)**, **280 px (dents)**, **390 px (creases)**, and **3175×24 px
(print lines)** — downscaling to 1280 would shrink an 11 px pit to about
2 px, below what any detector head can resolve. A tile is kept if it
contains ≥ 50% of a marker's area (`MIN_VISIBLE = 0.5`); a clean side
contributes one random empty tile (`--neg-per-side`, default 1) so the
detector sees true negatives.

### Views

Each side has two co-registered images in the same pixel frame: `sfx`
(raking-light relief image) and `rgb` (normal color photo). All seven
classes are trained in `sfx`; **`DENT` is dropped from `rgb`**
(`RGB_EXCLUDED_LABELS`) because dents are only visible under raking light —
training the model to find them in flat lighting would teach it to guess
from context instead of evidence.

### Cache layout

Under `cache_dir` (`config.toml`): `tiles/train.parquet` /
`tiles/val.parquet` / `tiles/test.parquet` index tiles (columns
`tile_path, cert, side, view, grade_label, x0, y0, tile_w, tile_h, n_boxes,
boxes`), and `tiles/<split>/<cert>_<side>_<view>_<x0>_<y0>.jpg` are the tile
images (JPEG q95, no chroma subsampling). Source card images cache under the
usual full-resolution `cache.cache_path` layout shared with corners/edges.

`surface_cache_cli pull`/`tile` may name the `test` split in `--splits`
without `--final-eval` — they only move pixels into the cache and never
compute a metric, so the frozen-test-split-read rule that gates
`evaluate_surface --split test` and `deduction_model --final-eval` doesn't
apply to them.

### Commands (from `training/`, venv python)

| Command | What it does |
|---|---|
| `python -m trainlib.surface_cache_cli pull --splits train:300,val:60 --workers 8` | pull those cards' `sfx`+`rgb` front/back images from R2 into the cache (resumable) |
| `python -m trainlib.surface_cache_cli tile --splits train:300,val:60 --workers 8` | cut cached images into 1024 tiles + write the tile index parquet |
| `python -m trainlib.train_surface --run-name smoke --epochs 2 --batch-size 4 --workers 2 --warmup-iters 50` | train; writes `runs/surface/smoke/{log.csv,best.pt,last.pt,args.json}` |
| `python -m trainlib.evaluate_surface --checkpoint runs/surface/smoke/best.pt --split val --batch-size 4 --workers 2 --full-cards 20` | per-grade, per-view, per-class tables + a full-card (tile-merged) pass, written next to the checkpoint |
| `python -m trainlib.deduction_model --out weights/surface/smoke/deduction.joblib` | fit the box→deduction regressor on the full train/val tables (CPU, no images needed) |

`train_surface`'s `log.csv` reports `val_loss_proxy = 1 - map50` — it is not
a loss, so don't read it for the corner/edge "val_loss rises" overfit signal;
watch `map50` itself instead. `evaluate_surface`'s full-side `fp_per_side`
column is class-aware: a box predicted with the wrong class on top of a real
defect counts as a false positive, not a match.

### Why torchvision, not Ultralytics

The detector is `torchvision.models.detection.fasterrcnn_resnet50_fpn_v2`
(COCO-pretrained, small anchors down to 16 px) rather than Ultralytics
YOLOv8. Ultralytics is AGPL-3.0, which would require either open-sourcing
SlabSense or buying a commercial license to ship it; torchvision is BSD, so
it carries no such obligation.

### Results

| Date | Run | Tiles (train/val) | Epochs | s/epoch | Peak VRAM | map50 (ALL) | map50 (sfx) | map50 (rgb) | Precision/Recall (ALL) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-16 | smoke (300/60 cards, batch 4) | 1,462/261 | 2 | 113.2, 100.9 | 4.00 GiB | 0.0292 | 0.0517 | 0.0102 | 0.333 / 0.014 |

Per-class AP50 (best.pt, epoch 2, non-NaN only; PIT/STAIN/TEAR had 0 val
ground-truth boxes in this 60-card sample and report NaN): CREASE 0.0667,
DENT 0.0000, PRINT_DEFECT 0.0000, SCRATCH 0.0500.

Cache: 1,200 train + 240 val images pulled in 52 s. Tiling: train 1,462
tiles (561 positive, 605 boxes; 742 `sfx` / 720 `rgb`), val 261 tiles (74
positive, 74 boxes; 131 `sfx` / 130 `rgb`); 605 MB total on disk under
`cache_dir/tiles/`. No OOM at batch size 4 (peak VRAM 4.00 GiB, well under
the 4070's ~10 GB free). `map50` near zero after 2 epochs is expected — this
smoke checks plumbing, not accuracy (see Task 9 brief). The first
`--full-cards 20` pass found 0 cached sides: it took the first 20 sorted
certs of the whole val split, none of which were in the random 60-card local
pull. `full_side_eval` now takes the first N cards whose images are *all*
cached, so a partial local cache still exercises the path. Re-run with
`--full-cards 5` on the same checkpoint: 20 side-views (10 `sfx`, 10 `rgb`),
17 GT boxes, `map50` 0.0004, `fp_per_side` 0.25 (rgb 0.30, sfx 0.20) —
meaningless as accuracy after 2 epochs, but the tile merge / NMS / matching
path is proven on real images.

Deduction regressor (`HistGradientBoostingRegressor`, fit on the full
20,757-box train table, evaluated on the full val table — independent of
the image cache):

| class | n | mae | baseline_mae |
|---|---|---|---|
| CREASE | 877 | 60.1 | 93.8 |
| DENT | 496 | 58.8 | 97.2 |
| PIT | 78 | 25.8 | 42.9 |
| PRINT_DEFECT | 539 | 72.9 | 162.7 |
| SCRATCH | 442 | 82.0 | 106.2 |
| STAIN | 58 | 75.5 | 184.4 |
| TEAR | 2 | 146.0 | 137.5 |
| ALL | 2,492 | 65.8 | 112.1 |

`mae < baseline_mae` for CREASE, DENT, SCRATCH, PIT as required by Task 9.

## Surface score (per side)

The surface detector (above) finds and classifies individual defect boxes,
but its own diagnosis ("Surface v1 diagnosis") found that about half of
TAG's labeled defects get no matching prediction at all, and boxes are
loose even when found — box-level recall is the detector's known ceiling.
The rollup (spec §7) needs one number per side: TAG's own per-side surface
score (0–1000), which already exists in the manifest independent of any
box the detector does or doesn't find. So a direct regressor is trained on
the whole-card image against that score, as a second, box-free path to the
same subscore, rather than reconstructing it by summing predicted
per-box deductions.

Two tasks, one per view, same target: `surface_sfx` (relief image) and
`surface_rgb` (color image) each take the whole front or back card image
and regress `score` = TAG's per-side surface score, scaled to 0–1
(`data.SCALE = 1000`) like every other regression target in this repo.
Rows come from `tables.surface_side_rows`, one row per cert per side, built
from the manifest's `surface_front`/`surface_back` columns and joined to
the split/grade tables the same way as corners/edges
(`tables.load_task_table("surface_sfx"|"surface_rgb", ...)`); a side with no
image or no score is dropped.

Input size is **896×1248** (portrait, no rotation — `long_side_horizontal:
False`, unlike edges), about **0.2×** of the card's native ~4391×6063 frame.
That downscale keeps whole-card defects that matter for an overall surface
score — creases, dents, tears, stains — visible, while the hairline detail
the box detector needs (pit edges, thin scratches) is exactly what gets
lost; the two models are complementary for that reason, not redundant.
`cache_resize` matches `input_size`, so once cached at 896×1248 no
resize happens at load time.

Cache command for a rented box that already has the full-resolution
card images cached (from the surface detector's pull, `surface_cache_cli
pull`, under `cache_dir/tag-dataset/...`): resize locally, no R2 keys
needed.

```bash
python -m trainlib.cache_cli --task surface_sfx --splits train,val,test --from-cache --workers 32
python -m trainlib.cache_cli --task surface_rgb --splits train,val,test --from-cache --workers 32
```

### Baseline (2026-09-17)

The number a trained model must beat: predicting each val-split side's
score with the **train-split median score of its `grade_label`** (a
per-grade lookup table with no image input), computed once with pandas
from `load_task_table("surface_sfx", ...)` (`surface_sfx` and `surface_rgb`
share the same manifest rows/scores, so this baseline is the same for both
tasks). Train 44,400 rows, val 5,580 rows.

| Baseline | MAE (val, TAG points) |
|---|---|
| Overall-median (single train-wide median, 705.0) | 254.49 |
| Grade-median (per `grade_label`) | **170.49** |

Per-grade MAE, grade-median baseline:

| grade_label | n | mae |
|---|---|---|
| 1 POOR | 124 | 103.05 |
| 1.5 FAIR | 58 | 152.36 |
| 2 GOOD | 112 | 222.21 |
| 2.5 GOOD+ | 104 | 230.37 |
| 3 VG | 286 | 229.34 |
| 3.5 VG+ | 186 | 224.73 |
| 4 VG EX | 498 | 220.21 |
| 4.5 VG EX+ | 360 | 225.63 |
| 5 EXCELLENT | 810 | 206.64 |
| 5.5 EXCELLENT+ | 522 | 205.96 |
| 6 EX MT | 310 | 187.74 |
| 6.5 EX MT+ | 310 | 198.33 |
| 7 NEAR MINT | 306 | 181.19 |
| 7.5 NEAR MINT+ | 310 | 146.15 |
| 8 NM MT | 310 | 122.36 |
| 8.5 NM MT+ | 308 | 109.28 |
| 9 MINT | 312 | 43.63 |
| 10 GEM MINT | 308 | 6.76 |
| 10 PRISTINE | 46 | 0.33 |
| **ALL** | **5,580** | **170.49** |

A full run's val `ALL` `mae_score` must beat 170.49 (and, per the Global
Constraints acceptance rule, be at least 30% better than that baseline, i.e. at or below 119 points) to be accepted.

### Smoke (2026-09-17, RTX 4070 SUPER)

300 train / 60 val cards, `convnext_tiny` (pretrained), batch size 2,
`--workers 0`, `--drop-path 0.1 --ema-decay 0.999 --aug strong`, run
detached outside the interactive shell for the same reason as the corner
smoke (memory guard). Cache: 719 of 720 crops downloaded (1 permanent
upstream miss) in 61 s (~11.7 files/s), 896×1248 JPEG q95 4:4:4. Rows after
`filter_cached`: 599 train / 120 val. No OOM at batch size 2 (peak GPU
memory 3.16 GiB).

| epoch | train_loss | val_loss | lr | seconds | mae_score |
|---|---|---|---|---|---|
| 1 | 0.24549 | 0.27135 | 1.17e-04 | 73.2 | 295.1910 |
| 2 | 0.24151 | 0.26387 | 2.49e-09 | 57.9 | 288.2876 |

Best val loss 0.26387 (epoch 2, `best.pt`). `evaluate --split val
--limit-cards 60` `ALL` row: 120 rows, `mae_score` 288.2876 (matches the
epoch-2 training-time metric exactly, as expected on a fixed val set).
`mae_score` at this 2-epoch/300-card scale is worse than the grade-median
baseline (288 vs 170) — expected for a plumbing smoke, not a signal about
the full run.

### Results

| Date | Task | Cards (train/val) | Rows (train/val) | Epochs | s/epoch | Peak VRAM | Best val loss | mae_score (val ALL) |
|---|---|---|---|---|---|---|---|---|
| 2026-09-17 | surface_sfx smoke | 300/60 | 599/120 | 2 | 73.2, 57.9 | 3.16 GiB | 0.26387 (epoch 2) | 288.2876 |

## ONNX export (on-device copies)

`export_onnx.py` makes ONNX copies of a checkpoint; the `.pt` originals are
never touched. Outputs land in `weights/onnx/` (the `.onnx` files are
gitignored like the checkpoints; the two JSON sidecars are tracked).

```
.venv/Scripts/python.exe export_onnx.py --task corners --checkpoint weights/corners/v2/best.pt --run-name v2 --parity-rows 400
.venv/Scripts/python.exe export_onnx.py --task edges   --checkpoint weights/edges/v1/best.pt   --run-name v1 --parity-rows 400
```

Per run: `<task>-<run>.fp32.onnx` (exact), `.fp16.onnx` (weights halved,
fp32 I/O), `.int8.onnx` (dynamic int8 weights), `<task>-<run>.json` (the
preprocessing/I-O contract the app must follow: resize, ImageNet mean/std,
`sides` 0 = front / 1 = back, sigmoid on `logits`, x1000 for deduction) and
`<task>-<run>.parity.json` (torch vs each ONNX file on cached val rows).
Parity uses `--split val` locally because the test crops are only cached on
the GPU box.

### 2026-09-17 export (corners v2, edges v1)

| file | MB | max abs diff vs torch (400 val rows) | auroc_wear (torch -> onnx) | mae_deduction (torch -> onnx) |
|---|---|---|---|---|
| corners-v2.fp32 | 107.0 | 0.0000 | 0.9361 -> 0.9361 | 100.18 -> 100.18 |
| corners-v2.fp16 | 53.6 | 0.0004 | 0.9361 -> 0.9361 | 100.18 -> 100.18 |
| corners-v2.int8 | 27.1 | 0.0309 | 0.9361 -> 0.9367 | 100.18 -> 100.58 |
| edges-v1.fp32 | 107.0 | 0.0000 | 0.9409 -> 0.9409 | 188.39 -> 188.39 |
| edges-v1.fp16 | 53.6 | 0.0007 | 0.9409 -> 0.9409 | 188.39 -> 188.36 |
| edges-v1.int8 | 27.1 | 0.0379 | 0.9409 -> 0.9405 | 188.39 -> 187.90 |

Browser timing (onnxruntime-web 1.30, headless Chrome on the dev PC, batch
of 1, ms per crop after warm-up; WebGPU needs `--use-angle=d3d11` headless):

| model | WebGPU | WASM (4 threads) |
|---|---|---|
| corners fp16 | 10 | 286 |
| corners fp32 | 11 | 194 |
| corners int8 | 603 (int8 matmul falls back to CPU) | 356 |
| edges fp16 | 11 | 354 |
| edges fp32 | 27 | 261 |
| edges int8 | - | 512 |

Takeaways: ship **fp16** (54 MB per model) for WebGPU phones; int8 only
helps download size, it is slower everywhere in the browser. A card is 8
corner crops + 8 edge crops, so on WASM-only phones expect on the order of
10-30 s per card; on WebGPU well under a second. First-run shader compile
on WebGPU is ~0.6-1.2 s per model.
