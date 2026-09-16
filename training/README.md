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

## Metrics
MAE in TAG points (0–1000) overall and on targets below 900 (`mae_low_points`), per grade. Back-corner angle scores are always missing in TAG data and are masked.

## Results
| Date | Task | Cards (train/val) | Epochs | s/epoch | Peak VRAM | Best val MAE | Low-subset MAE |
|---|---|---|---|---|---|---|---|
| 2026-09-16 | corners | 500/100 | 3 | 61, 34, 34 | 5.93 GiB | 1.14 pts | 213.5 pts (n=1) |

Smoke run on an RTX 4070 SUPER, `convnext_tiny` (pretrained), batch size 32.

Cache: 4,796 of 4,800 files downloaded, 2.2 GB in 85 s, about 26 MB/s (4 files
unavailable upstream — cert Z9219918 front side, see below).

Trained with `--workers 2`, not the Commands table's default of 6: two
attempts at `--workers 6` were killed by the host's own low-memory guard
(unrelated processes — several `node` and `claude` sessions, a browser,
Discord — already had the machine's 31.8 GB near its working limit), not a
CUDA OOM or a training crash. Dropping to `--workers 2` resolved it; batch
size stayed at 32 throughout.

4 rows dropped: cert Z9219918 front side unavailable upstream (confirmed
permanent HTTP 404/403 from the source, not a transient cache miss) — handled
by `tables.filter_cached`, applied in `train.main` and `evaluate.main` before
building loaders. The low-subset MAE is based on a single masked target below
900 points in this 100-card val sample, so it isn't statistically meaningful
at this scale; the full per-grade table is in `runs/corners/smoke/eval.log`
and `runs/corners/smoke/eval_val.csv`.
