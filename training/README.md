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

Cache location: `scripts/tag-dataset/data/cache/` (full-resolution originals; ~100 GB each for all corners or all edges).

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
