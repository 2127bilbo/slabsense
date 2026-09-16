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
