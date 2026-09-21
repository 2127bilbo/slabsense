# Handoff: full corner + edge training runs on the rented RTX 5880 Ada

**For the Claude instance taking this over.** You run in this repo on the
user's Windows PC and reach the rented vast.ai box over SSH. Your job is to
set the box up, pull the crop caches from R2, run the two full training runs,
evaluate them, bring the artifacts home, and report. You do not change model
code, targets, or hyperparameters beyond the failure playbook below. If
something outside this document goes wrong, stop and tell the user rather
than improvising.

Read `training/README.md` once for background (targets, cache modes, smoke
results). Everything you need to *do* is in this file.

## Hard rules

- Never `git add` `scripts/tag-dataset/tagdataset/cli.py` or `download.py`
  (they carry the user's uncommitted work). Never `git stash`. Never commit
  a `.pt` file (112 MB each; `training/weights/**/*.pt` is gitignored).
- R2 keys live locally in `scripts/tag-dataset/data/env.ps1` (gitignored).
  They go into `/workspace/env.sh` on the box with `chmod 600`. Never paste
  them into a committed file, a log, or your report.
- The frozen `test` split is read exactly once per task, with
  `--split test --final-eval`, and only after the `val` numbers are accepted.
- The box bills by the hour and by the terabyte. Do not leave it idle for
  hours between steps, and remind the user to destroy the instance once the
  artifacts are safely copied back.

## Budget (tell the user this before starting)

| Item | Amount |
|---|---|
| Box, GPU $0.667/hr + disk | ~$0.78/hr at 250 GB disk, $1.05/hr at 820 GB |
| Corners cache download (train+val, full resolution) | ~95 GB, about $4 at $40/TB |
| Edges cache download (train+val; the resize happens on the box, so the full-resolution originals still cross the network) | ~750 GB, about $30 at $40/TB |
| Corners run, 12 epochs | 2 to 4 h |
| Edges run, 12 epochs | 2 to 4 h |
| Total | roughly $45 to $55, i.e. more than the $13.63 credit |

The user needs to top the account up by about $40 before the edge cache pull,
or the box will be paused mid-download. Disk: 250 GB is enough (95 GB corners
+ 33 GB resized edges + venv + checkpoints); 820 GB is wasted money.

## What the user gives you

1. The SSH command from the vast.ai instance page (`ssh -p <port> root@<host>`),
   and confirmation the key in `~/.ssh` works: `ssh -p <port> root@<host> nvidia-smi`.
2. Nothing else. Keys come from `scripts/tag-dataset/data/env.ps1`; the
   dataset tables come from the local `scripts/tag-dataset/data/dataset/`.

Every remote command below runs as `ssh -p <port> root@<host> "<command>"`;
file copies use `scp -P <port>`.

## Step 0: verify the box (5 min)

```
nvidia-smi                      # driver CUDA version must be >= 12.8; GPU RTX 5880 Ada, 48 GB
df -h /workspace                # >= 200 GB free
nproc; free -g                  # expect >= 16 cores, >= 32 GB RAM
python3 --version               # any; we install 3.12 in a venv below
```

If the driver CUDA is below 12.8 the cu128 torch wheel will not load. Stop
and tell the user; the fix is a different host, not a different wheel.

## Step 1: set up (15 min)

On the box:

```bash
cd /workspace
git clone https://github.com/2127bilbo/slabsense.git SlabSense
cd SlabSense && git checkout tag-dataset
cd training
pip install -q uv
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch==2.9.1 torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv/bin/python -e ".[dev]"
.venv/bin/python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

Expected: `2.9.1+cu128 True NVIDIA RTX 5880 Ada Generation`.

Write the two config files (both gitignored, so they are not in the clone).

`training/config.toml`:

```toml
[paths]
dataset_dir = "../scripts/tag-dataset/data/dataset"
splits_path = "../scripts/tag-dataset/splits/splits.parquet"
cache_dir   = "/workspace/cache"
runs_dir    = "runs"
weights_dir = "weights"

[r2]
config_toml = "../scripts/tag-dataset/config.toml"
```

`scripts/tag-dataset/config.toml`:

```toml
[paths]
db = "data/raw.sqlite"

[bucket]
endpoint = "https://a38acb292e1504136e5279c5e1a787e4.r2.cloudflarestorage.com"
region = "auto"
name = "slabsense-tag-dataset"
prefix = "tag-dataset"
```

Copy the dataset tables from the local PC (about 11 MB total). First
`mkdir -p /workspace/SlabSense/scripts/tag-dataset/data/dataset` on the box, then:

```
scp -P <port> "G:/Grading App/SlabSense/scripts/tag-dataset/data/dataset/manifest.parquet" "G:/Grading App/SlabSense/scripts/tag-dataset/data/dataset/corners.parquet" "G:/Grading App/SlabSense/scripts/tag-dataset/data/dataset/edges.parquet" root@<host>:/workspace/SlabSense/scripts/tag-dataset/data/dataset/
```

The splits file is tracked in git and already on the box.

Keys: read `scripts/tag-dataset/data/env.ps1` locally, then on the box create
`/workspace/env.sh` containing

```bash
export B2_KEY_ID=...
export B2_APP_KEY=...
```

and `chmod 600 /workspace/env.sh`. Every later command runs after
`source /workspace/env.sh` in the same shell.

Sanity check:

```bash
cd /workspace/SlabSense/training && .venv/bin/python -m pytest -q     # expect 60 passed
```

## Step 2: cache the crops from R2

Both pulls are resumable: rerunning the same command skips files already on
disk. Run them detached with logs in `/workspace/`.

Corners first (full resolution, 222,008 files incl. the test split, ~105 GB; the test crops are needed for the one-shot test evaluation in Step 4):

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
nohup .venv/bin/python -m trainlib.cache_cli --task corners --splits train,val,test --workers 16 > /workspace/cache_corners.log 2>&1 &
```

Then edges (downloads full resolution, saves 1024x192 JPEG q95 4:4:4;
222,008 files incl. test, ~33 GB on disk but ~833 GB through the network):

```bash
nohup .venv/bin/python -m trainlib.cache_cli --task edges --splits train,val,test --workers 16 > /workspace/cache_edges.log 2>&1 &
```

Start the edge pull as soon as the corners pull finishes, so it overlaps with
corner training (network vs GPU; they do not contend much). If `nproc` is
below 16, run the edge pull with `--workers 8`.

Monitor every 15 to 30 minutes, not more often:

```bash
tail -2 /workspace/cache_corners.log; du -sh /workspace/cache; df -h /workspace
```

Done when the log's final line reports the count. Expect a small number of
"missing upstream" files (the local smoke saw 4 of 4,800); `filter_cached`
drops those rows at train time, so a small shortfall is normal. A shortfall
above 1% means R2 throttled or the network dropped: rerun the same command,
it resumes.

## Step 3: train

Corners, as soon as the corners cache is complete:

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
nohup .venv/bin/python -m trainlib.train --task corners --run-name v1 --epochs 12 --batch-size 64 --workers 8 > /workspace/train_corners.log 2>&1 &
```

Edges, after the edge cache is complete and the corners run has finished
(one run at a time on the GPU keeps the timing predictable):

```bash
nohup .venv/bin/python -m trainlib.train --task edges --run-name v1 --epochs 12 --batch-size 32 --workers 8 > /workspace/train_edges.log 2>&1 &
```

Each run writes `runs/<task>/v1/{args.json,log.csv,best.pt,last.pt}`. The
first lines of the train log print `train: dropped N rows with no cached crop`
(should be small) and the row counts (expect about 177k train / 22k val).

Monitor every 20 to 30 minutes:

```bash
tail -3 /workspace/SlabSense/training/runs/corners/v1/log.csv; nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader
```

Columns: `epoch,train_loss,val_loss,lr,seconds,auroc_wear,precision_wear,recall_wear,npos_wear,mae_deduction[,mae_angle]`.

Healthy: val_loss falls over the first few epochs; auroc_wear climbs above
the smoke value (corners 0.83, edges 0.77) and keeps climbing; GPU
utilization mostly above 70%. `recall_wear` near 0 is expected at this stage
(probabilities sit below 0.5 on imbalanced targets; threshold tuning is a
later step, not yours).

There is no resume: if the box dies mid-run, the run restarts from epoch 1.
The caches survive on `/workspace` as long as the instance exists.

## Step 4: evaluate and bring it home

Val first (per task, after the run prints `best val loss`):

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
.venv/bin/python -m trainlib.evaluate --task corners --checkpoint runs/corners/v1/best.pt --split val --workers 8 | tee runs/corners/v1/eval_val.log
```

Accept the model if the `ALL` row shows `auroc_wear` at or above 0.85 for
corners (0.80 for edges) and `mae_deduction` below the smoke value (corners
160, edges 330). If it misses those, do not retune; copy the artifacts home
and report the numbers. The user and the main session decide what changes.

Test, exactly once per accepted model:

```bash
.venv/bin/python -m trainlib.evaluate --task corners --checkpoint runs/corners/v1/best.pt --split test --final-eval --workers 8 | tee runs/corners/v1/eval_test.log
```

Same two commands for edges.

Copy back (do not copy `last.pt`). Create `training/weights/corners/v1/`
locally first:

```
scp -P <port> root@<host>:/workspace/SlabSense/training/runs/corners/v1/args.json root@<host>:/workspace/SlabSense/training/runs/corners/v1/log.csv root@<host>:/workspace/SlabSense/training/runs/corners/v1/eval_val.log root@<host>:/workspace/SlabSense/training/runs/corners/v1/eval_val.csv root@<host>:/workspace/SlabSense/training/runs/corners/v1/eval_test.log root@<host>:/workspace/SlabSense/training/runs/corners/v1/eval_test.csv "G:/Grading App/SlabSense/training/weights/corners/v1/"
scp -P <port> root@<host>:/workspace/SlabSense/training/runs/corners/v1/best.pt "G:/Grading App/SlabSense/training/weights/corners/v1/best.pt"
```

Same for edges. Verify `best.pt` is about 112 MB and loads locally with
`training/.venv`:

```
training/.venv/Scripts/python -c "import torch; s=torch.load('training/weights/corners/v1/best.pt', map_location='cpu'); print(s['task'], s['epoch'], s['val_loss'])"
```

## Step 5: report and close

1. Append one row per task to the Results table in `training/README.md`
   (date, task, targets, all cards, 12 epochs, seconds-per-epoch range, peak
   VRAM from the train log, best val loss and epoch, final auroc_wear,
   mae_deduction, mae_angle for corners) plus a short "Full runs v1" section
   with the val and test `ALL` rows.
2. Commit only `training/README.md` and the small files under
   `training/weights/*/v1/` (never `.pt`), message
   `docs(training): v1 full runs on RTX 5880 Ada`.
3. Tell the user the instance can be destroyed, and give them the final
   numbers in a short table.

## Step 6: v2 regularized runs (approved by the user, same box)

v1 overfit after epoch 5 on corners (train loss 0.21 to 0.025, val loss
0.19 to 0.53). v2 adds stochastic depth, a weight EMA, stronger augmentation
and a shorter schedule. Pull the code first, then run both tasks the same
way as v1, one at a time on the GPU:

```bash
cd /workspace/SlabSense && git pull && cd training
uv pip install --python .venv/bin/python -e ".[dev]" && .venv/bin/python -m pytest -q     # expect 64 passed
source /workspace/env.sh
nohup .venv/bin/python -m trainlib.train --task corners --run-name v2 --epochs 8 --batch-size 64 --workers 8 --drop-path 0.2 --ema-decay 0.999 --aug strong > /workspace/train_corners_v2.log 2>&1 &
# after corners v2 finishes:
nohup .venv/bin/python -m trainlib.train --task edges --run-name v2 --epochs 12 --batch-size 32 --workers 8 --drop-path 0.1 --ema-decay 0.999 --aug strong > /workspace/train_edges_v2.log 2>&1 &
```

The edge recipe differs on purpose: edges v1 did not overfit (train loss
0.18 vs val 0.198 at epoch 12, still improving slowly), so it keeps the
12-epoch schedule and a lighter drop-path of 0.1; the EMA and stronger
augmentation are the changes that help it. Corners v1 did overfit, hence
8 epochs and 0.2 there.

No R2 keys are needed for training or evaluation; both read the local cache
under `/workspace/cache`. The key file was removed after v1 and will be
copied back only when the surface pull needs it.

Expect about 9.5 min per corner epoch and 11.5 min per edge epoch, so about
75 min and 140 min respectively. Epoch 1 will look worse than v1's epoch 1
because the EMA copy lags the raw weights early; judge from epoch 3 onward.

Evaluate exactly as in Step 4 with `runs/<task>/v2/best.pt`. Accept v2 for
a task only if its val `ALL` row beats v1 on both auroc_wear (v1: corners
0.919, edges 0.895) and mae_deduction (v1: corners 105.0, edges 161.3). Run
the test evaluation on an accepted v2 once, the same way. If v2 does not
beat v1, report the numbers and leave the artifacts in place; v1 stays.
Leave all `runs/<task>/v2/` artifacts on the box; the main session pulls
them down over SSH.

### Step 7.9: surface v2 (sfx-only, clean negatives, class-balanced)

v1 (epoch 6 diagnosis, 2026-09-17): map50 0.07 overall; only creases found
(AP50 0.34); about half the labeled defects get no prediction at all, boxes
are loose (AP rises from 0.12 to 0.21 when the overlap requirement drops from
0.5 to 0.1), and many rgb-view labels mark defects invisible under flat light.
v2 removes the two label-noise sources that can be removed without new
labels: it trains on the relief view only, keeps box-free negatives only from
cards graded 8 and up (sides of low-grade cards carry unmarked defects that
v1 was taught to call background), and draws rare classes more often.

```bash
cd /workspace/SlabSense && git pull && cd training
.venv/bin/python -m pytest -q     # expect 106 passed
nohup .venv/bin/python -m trainlib.train_surface --run-name v2 --epochs 8 --batch-size 8 --workers 8   --views sfx --neg-grades "8 NM MT,8.5 NM MT+,9 MINT,10 GEM MINT,10 PRISTINE" --balance   > /workspace/train_surface_v2.log 2>&1 < /dev/null &
```

The first log line prints the tile counts; expect roughly 20k positive sfx
tiles plus the high-grade negatives, so about a third of v1's epoch time.
Evaluate as in Step 7.5 with `--views sfx --full-cards 100` and compare
against v1's `sfx` view row and `v1-sfx`. Report; do not read the test
split. The two-view question (what phone photos need) is decided after
this run, from these numbers.

### Step 7.10: crease + scratch detector (`v3`), after v2's eval

v2 (sfx-only, clean negatives, balanced) landed at map50 0.107 on the sfx
val tiles, the same as v1's sfx view: the noise is in the positive boxes
(markers on invisible defects, unmarked defects), not in the negatives. A
box-tightening pass was tried and does not help: TAG's crease and scratch
boxes are already tight where the defect is visible. v3 therefore keeps the
two classes with signal and drops the rest, so all capacity goes to them.

```bash
cd /workspace/SlabSense && git pull && cd training && .venv/bin/python -m pytest -q     # expect 107 passed
nohup .venv/bin/python -m trainlib.train_surface --run-name v3 --epochs 12 --batch-size 8 --workers 8   --views sfx --classes CREASE,SCRATCH --neg-grades "8 NM MT,8.5 NM MT+,9 MINT,10 GEM MINT,10 PRISTINE" --balance   > /workspace/train_surface_v3.log 2>&1 < /dev/null &
```

Tiles whose only boxes were other classes are dropped (not kept as
negatives). Evaluate with `--views sfx --full-cards 100`; the per-class
table will show only CREASE and SCRATCH with `n_gt > 0`, and `map50` is the
mean of those two. Compare CREASE AP50 against v2 (0.44). Report; do not
read the test split.

## Step 8: surface score regressors

**For the Claude instance taking this over.** New models: a whole-card
regressor per view (`surface_sfx`, `surface_rgb`) that predicts TAG's
per-side surface score (0–1000) directly, as a box-free complement to the
surface detector above. Read `training/README.md`'s new "Surface score (per
side)" section first (why, input size, the local smoke, the baseline table).
The local smoke (300 train / 60 val cards, 2 epochs, both on `surface_sfx`)
already ran on the 4070 and passed plumbing checks; your job is the two full
runs.

```bash
cd /workspace/SlabSense && git pull && cd training
.venv/bin/python -m pytest -q     # expect 114 passed (113 + the surface-score dataset test)
```

### Step 8.1: cache (from the local full-res files already on the box)

Both views' whole-card images (`sfx` front/back, `rgb` front/back) are
already cached full-resolution under `/workspace/cache/tag-dataset/` from
the surface detector's pull (Step 7.2) — `--from-cache` resizes them
locally to 896×1248 instead of downloading again. No bytes come from R2 and
the reader is only built if a file is missing locally, so the keys are not
needed unless the log reports a fallback download (then `source
/workspace/env.sh` and rerun; it resumes).

**Step 8 budget**: two resize passes ≈ 30–40 min each (CPU); two training
runs of 10 epochs at 25–45 min/epoch ≈ 5–7 h each; evals ≈ 15 min; total
≈ 12–16 h ≈ $13–17 at the hourly rate. Disk: the two resized caches are
≈ 75–90 GB (the smoke's resized files average 0.73 MB each × 110,996), on
top of the 45 GB tile cache; check `df -h /workspace` first (≈ 230 GB
free after the tiles).

```bash
cd /workspace/SlabSense/training
W=$(( $(nproc) < 32 ? $(nproc) : 32 ))
nohup .venv/bin/python -m trainlib.cache_cli --task surface_sfx --splits train,val,test --from-cache --workers $W > /workspace/cache_surface_sfx_score.log 2>&1 &
# after it finishes:
nohup .venv/bin/python -m trainlib.cache_cli --task surface_rgb --splits train,val,test --from-cache --workers $W > /workspace/cache_surface_rgb_score.log 2>&1 &
```

Expect 55,498 resizes per view (all certs × 2 sides, minus sides with no
score). Monitor with `tail -3 /workspace/cache_surface_sfx_score.log`
every 10–15 minutes. When each finishes, verify before training — a
half-finished resized cache does not fail loudly, because the loader falls
back to decoding the 27-MP originals (slow, and it prints `dropped 0 rows`):

```bash
tail -1 /workspace/cache_surface_sfx_score.log            # failed must be 0 (the 'downloaded' count includes local resizes)
find /workspace/cache/resized/896x1248 -type f -name 'sfx_*' | wc -l    # expect 55,498 (sfx) and 55,498 more for rgb (front.jpg/back.jpg)
df -h /workspace
```

### Step 8.1b: outcome of the first per-side run, and the corrected target

`surface_sfx` v1 (2026-09-17) converged to a constant predictor by epoch 2:
val `mae_score` 232, which is exactly the per-side-median baseline. The
back-side score is the reason: TAG's per-side back score does not follow
the back image (a creased back with no markers scores 1000; unmarked backs
are routinely scored down), so a model looking at the pixels correctly
gives up. The front score and the card-level rollup do track the marked
damage (front: median 1000 with no markers, 279 with 3+; rollup: 1000 vs
364). The corrected tasks are `surface_front_sfx` / `surface_front_rgb`:
front image only, two regression targets `score_front` (= `surface_front`)
and `rollup` (= `rollup_surface`), masked per row when missing. They reuse
the 896×1248 resized cache from Step 8.1 (same front image files), so no
new cache step. Run Steps 8.2–8.4 below with `surface_front_sfx` in place
of `surface_sfx` and `surface_front_rgb` in place of `surface_rgb`; the
log/eval columns are `mae_score_front` and `mae_rollup`. Acceptance: val
`ALL` `mae_rollup` ≤ 119 (grade-median baseline for the rollup is of the
same order as the per-side one; the operator reports both MAEs and the
decision is the main session's). Half the images per epoch, so expect
roughly 12–25 min/epoch. Do not run `surface_sfx`/`surface_rgb` again.

### Step 8.2: train `surface_sfx` v1

```bash
cd /workspace/SlabSense/training
nohup .venv/bin/python -m trainlib.train --task surface_sfx --run-name v1 --epochs 10 --batch-size 8 --workers 8 --drop-path 0.1 --ema-decay 0.999 --aug strong > /workspace/train_surface_sfx_v1.log 2>&1 &
```

Expect 25–45 min/epoch (extrapolated from the 4070 smoke's per-image
cost, not measured on this box — the first epoch here tells the truth). If
`/workspace/train_surface_sfx_v1.log` shows `CUDA out of memory` at batch 8
(expected use ≈ 12 GiB, so it should not), rerun with `--batch-size 4` and
note it; do not change the input size. Monitor with `tail -3
runs/surface_sfx/v1/log.csv` every 20–30 minutes; seconds per epoch are in
that file, peak GPU memory is printed at the end of the nohup log.

### Step 8.3: evaluate `surface_sfx` v1, accept/reject, test once

```bash
.venv/bin/python -m trainlib.evaluate --task surface_sfx --checkpoint runs/surface_sfx/v1/best.pt --split val --workers 8 --batch-size 16 | tee runs/surface_sfx/v1/eval_val.log
```

**Acceptance rule**: the val `ALL` row's `mae_score` must be at least 30%
better than the grade-median baseline measured in the README (170.49), i.e.
**≤ 119 points**. (A no-image lookup by grade already reaches 170, so the
model must clearly beat what the grade alone tells you.) If it misses, do
not retune — leave the artifacts in place and report the numbers; the user
and the main session decide what changes.

Only if accepted, read the frozen test split exactly once:

```bash
.venv/bin/python -m trainlib.evaluate --task surface_sfx --checkpoint runs/surface_sfx/v1/best.pt --split test --final-eval --workers 8 --batch-size 16 | tee runs/surface_sfx/v1/eval_test.log
```

### Step 8.4: `surface_rgb` v1, the same way

```bash
nohup .venv/bin/python -m trainlib.train --task surface_rgb --run-name v1 --epochs 10 --batch-size 8 --workers 8 --drop-path 0.1 --ema-decay 0.999 --aug strong > /workspace/train_surface_rgb_v1.log 2>&1 &
.venv/bin/python -m trainlib.evaluate --task surface_rgb --checkpoint runs/surface_rgb/v1/best.pt --split val --workers 8 --batch-size 16 | tee runs/surface_rgb/v1/eval_val.log
# only if accepted (same rule: mae_score <= 119):
.venv/bin/python -m trainlib.evaluate --task surface_rgb --checkpoint runs/surface_rgb/v1/best.pt --split test --final-eval --workers 8 --batch-size 16 | tee runs/surface_rgb/v1/eval_test.log
```

### Step 8.5: report

Report both tasks' val (and test, if accepted) `ALL` rows and their
per-grade tables (`eval_val.csv`/`eval_test.csv`), plus seconds/epoch
(from `runs/<task>/v1/log.csv`) and peak GPU memory (last line of
`/workspace/train_<task>_v1.log`). Leave all `runs/surface_sfx/v1/` and
`runs/surface_rgb/v1/` artifacts on the box; the main session pulls them
down over SSH the same way as Step 4 (never commit a `.pt` file —
`training/weights/**/*.pt` is gitignored).

## Step 10: centering model (DONE 2026-09-18, for the record)

Ran ahead of Step 9 while its code was being written. `centering_rgb` v1:
`cache_cli --task centering_rgb --splits train,val,test --from-cache
--workers 32` (crop to the card box from `derived/centering_boxes_rgb.parquet`,
resize to 896×1248, 55k images, ~35 min, 48 GB), then `train --task
centering_rgb --run-name v1 --epochs 10 --batch-size 8 --workers 8
--drop-path 0.1 --ema-decay 0.999 --aug light` (~16.5 min/epoch, peak
10.98 GiB). Accepted: val mean MAE 1.48 per-mille vs bar 4.0 and baseline
4.54; test 1.49, read once. Artifacts `runs/centering_rgb/v1/`; pulled home.
The rejected surface caches (`cache/tiles`, `cache/resized/896x1248`) were
deleted afterwards; 219 GB free.

## Failure playbook

| Symptom | Do this |
|---|---|
| `CUDA out of memory` | halve `--batch-size`, rerun with a new `--run-name` (v1b); note it in the report |
| DataLoader worker crashes or `Bus error` | container shared memory is small: rerun with `--workers 4` |
| `RuntimeError: Set B2_KEY_ID and B2_APP_KEY` | `source /workspace/env.sh` in the same shell before the command |
| Cache count far below 222,008 after a rerun | check `df -h`; if the disk is full, stop and tell the user |
| val_loss rises from epoch 2 onward or shows `nan` | kill the run, copy `log.csv` home, report; do not retune |
| Box unreachable | the vast.ai page shows whether it was paused for credit; tell the user |

## Step 7: surface detector

**For the Claude instance taking this over.** This is a new model (defect
boxes, not corner/edge scores) added after v1/v2 of corners and edges. Read
`training/README.md`'s "Surface detector" section first (classes, exclusion
rules, tiling constants, the two views, the local smoke numbers). Everything
you need to *do* is below. The local smoke (300 train / 60 val cards, 2
epochs) already ran and passed plumbing checks; your job is the full run.

**Step 7 budget** (tell the user this before starting): tile ~1 h; train 8
epochs at an extrapolated ~110 min/epoch (from the 4070 smoke — not
measured on this box; the first epoch here tells the truth, update the
estimate then) ≈ 15 h; val eval with `--full-cards 100` ≈ 25 min; test eval
with `--full-cards 300` ≈ 1 h, once; sfx fine-tune, 3 epochs on ~50k sfx
tiles, ≈ 2.5 h plus its eval ≈ 25 min; **total ≈ 20 h, roughly $20 at
~$1/h**. Disk: ≈ 275 GB free after the image pull (545/820 GB used) — enough
for the ~40 GB tile cache.

### Step 7.0: update the code and verify tests

```bash
cd /workspace/SlabSense && git pull && cd training
uv pip install --python .venv/bin/python -e ".[dev]"     # scikit-learn is new (deduction regressor)
.venv/bin/python -m pytest -q     # expect 103 passed
ls ../scripts/tag-dataset/data/dataset/                   # must list surface.parquet (and manifest.parquet)
```

The surface step reads `surface.parquet`, which Step 1 did not copy (it only
needed the corner and edge tables). If it is missing, copy it from the PC the
same way as Step 1 (`scp -P <port> ".../data/dataset/surface.parquet"
root@<host>:/workspace/SlabSense/scripts/tag-dataset/data/dataset/`); the
tile step fails immediately with `FileNotFoundError: ... surface.parquet`
otherwise. As of 2026-09-16 evening it is already on the box, and the tile
step (7.3) was launched by the main session: check `/workspace/tile_surface.log`
before launching it again.

### Step 7.1: bring the key file back

The key file was removed from the box after the v1/v2 corner/edge runs (see
the note at the end of Step 6 above). Bring it back the same way as Step 1:
from the main session, `scp` `scripts/tag-dataset/data/env.ps1` up, or
recreate `/workspace/env.sh` directly:

```bash
# on the box
cat > /workspace/env.sh <<'EOF'
export B2_KEY_ID=...
export B2_APP_KEY=...
EOF
chmod 600 /workspace/env.sh
```

Never paste the actual keys into a committed file, a log, or your report.

### Step 7.2: pull — already DONE on this box, check before repeating

**Pull is already done.** 111,004 images across both views (`sfx` + `rgb`,
front + back) are already cached under `/workspace/cache/tag-dataset/` from
an earlier session. **Skip the `pull` step** unless the `tile` step below
reports a large number of "not cached" side-views (more than a handful) —
only then run:

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
nohup .venv/bin/python -m trainlib.surface_cache_cli pull --splits train,val,test --workers 32 > /workspace/pull_surface.log 2>&1 &
```

(expect ~111,000 images across both views, ~435 GB, ~$17.50 of R2 bandwidth
at $40/TB; the box has ~680 GB free after the corner and edge caches — check
`df -h /workspace` first if you do end up needing this).

### Step 7.3: tile

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
nohup .venv/bin/python -m trainlib.surface_cache_cli tile --splits train,val,test --workers 32 > /workspace/tile_surface.log 2>&1 &
```

Expect roughly 100k train tiles, about 40 GB on disk under
`/workspace/cache/tiles/`. Monitor with `tail -5 /workspace/tile_surface.log`
every 15–30 minutes; the final line per split reports tile/positive/box
counts and how many side-views were "not cached" / "failed" — a large
"not cached" count here is the signal to go back and run the pull step.

### Step 7.4: train v1

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
nohup .venv/bin/python -m trainlib.train_surface --run-name v1 --epochs 8 --batch-size 8 --workers 8 > /workspace/train_surface_v1.log 2>&1 &
```

Expect roughly 110 min per epoch on the 5880 Ada; judge health from the
`map50` column in `runs/surface/v1/log.csv`, not from wall time. Peak VRAM
is expected under 20 GiB (the local 4070 smoke at batch 4 used 4.00 GiB;
batch 8 on a 48 GB card has plenty of headroom). Monitor every 20–30 minutes:

```bash
tail -5 runs/surface/v1/log.csv
nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader
```

If `map50` is still `nan` after epoch 2, stop and report — see the failure
playbook addition below, this is not a tuning problem.

### Step 7.5: evaluate v1 on val, then accept/reject

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
.venv/bin/python -m trainlib.evaluate_surface --checkpoint runs/surface/v1/best.pt --split val --batch-size 8 --workers 8 --full-cards 100 | tee runs/surface/v1/eval_val.log
```

**Acceptance bars** (a first-version bar; report whatever the numbers are
even if they miss):

- val `ALL` row `map50` ≥ 0.50
- `sfx` view `map50` ≥ 0.55
- CREASE, DENT, and SCRATCH each have AP50 ≥ 0.50

If it misses, do not retune — copy the artifacts home and report the
numbers; the user and the main session decide what changes.

### Step 7.6: test, exactly once, only if v1 is accepted

```bash
.venv/bin/python -m trainlib.evaluate_surface --checkpoint runs/surface/v1/best.pt --split test --final-eval --batch-size 8 --workers 8 --full-cards 300 | tee runs/surface/v1/eval_test.log
```

The frozen test split is read exactly once, with `--final-eval`, only after
val is accepted — same rule as corners/edges.

### Step 7.7: gray-card specialist fine-tune (`v1-sfx`)

`sfx` (raking-light) is the more reliable view (it alone carries `DENT` and
is generally higher-contrast for defects); a short fine-tune restricted to
`sfx` tiles, initialized from `v1`'s weights, checks whether specializing
helps that view specifically:

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
nohup .venv/bin/python -m trainlib.train_surface --run-name v1-sfx --epochs 3 --batch-size 8 --workers 8 --init runs/surface/v1/best.pt --views sfx --lr 0.002 --warmup-iters 100 > /workspace/train_surface_v1sfx.log 2>&1 &
```

Evaluate with `--views sfx` so the pass only runs the `sfx` view (the `rgb`
row would be meaningless for a model fine-tuned solely on `sfx` tiles):

```bash
.venv/bin/python -m trainlib.evaluate_surface --checkpoint runs/surface/v1-sfx/best.pt --split val --batch-size 8 --workers 8 --full-cards 100 --views sfx | tee runs/surface/v1-sfx/eval_val.log
```

Compare its `sfx` row against v1's `sfx`-view row from Step 7.5's per-view
table (v1 was evaluated with both views, so the views table has the `sfx`
row to compare against). Accept `v1-sfx` as the shipped `sfx` specialist
only if it beats v1's `sfx` map50; otherwise v1 stays the shipped model for
both views.

### Step 7.8: deduction model (CPU, independent of the image cache)

Val first, same rule as the detector — do not read test before val is accepted:

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
.venv/bin/python -m trainlib.deduction_model --out weights/surface/v1/deduction.joblib
```

This fits on the full train table and reports val per-class MAE vs. the
baseline (the local smoke's val numbers, for comparison, are in
`training/README.md`'s Surface detector Results section). Only if the val
MAE beats the baseline for CREASE, DENT, SCRATCH, and PIT, rerun once with
`--final-eval` added (this refits the same model and additionally reads the
frozen test split exactly once):

```bash
.venv/bin/python -m trainlib.deduction_model --out weights/surface/v1/deduction.joblib --final-eval
```

`deduction_val.csv` and `deduction_test.csv` land next to the `.joblib` and
are small enough to commit if the user wants them kept.

Leave all `runs/surface/v1/`, `runs/surface/v1-sfx/`, and
`weights/surface/v1/` artifacts on the box; the main session pulls them
down over SSH the same way as Step 4 above (never commit a `.pt` or
`.joblib` file — `training/weights/**/*.pt|*.joblib` is gitignored).

### Step 7 failure playbook additions

| Symptom | Do this |
|---|---|
| DataLoader `Bus error` during train/eval | increasing `--shm-size` is not possible on vast.ai; rerun with `--workers 4` (each worker holds float32 1024² tensors, so 4 workers instead of 8-16 roughly halves what moves through `/dev/shm`). If it still fails, rerun with `--workers 0` — no worker processes, no shared memory, but roughly 2x slower. |
| `tile` step OOM / killed (32 workers, each holding a decoded ~26 MP image, is ~8 GB RSS) | rerun with `--workers 16`; it resumes (tiles already written are skipped) |
| `CUDA out of memory` | rerun with `--batch-size 4` |
| `map50` still `nan` after epoch 2 | stop and report — the model is producing no detections above score 0.05; this is almost certainly a tiling/index problem (e.g. an empty or misaligned tile index), not something a tuning change fixes |

## Step 9: corners v3-phone and edges v2-phone — make the models work on phone photos

**For the Claude instance taking this over.** The shipped corner model
(`runs/corners/v2/best.pt`) and edge model (`runs/edges/v1/best.pt`) are live
in the app as ONNX. They were trained on TAG's studio scans only and, measured
in the app on 2026-09-17/18, they break on phone photos in specific, measured
ways. This step retrains both with augmentations that close those gaps. Read
`training/README.md` sections "Shipping the models in the app", "Next training
run: backdrop augmentation" and "Edges v2: what to fix" first; everything you
need to *do* is below. No new data is needed: the caches on `/workspace` are
the inputs, unchanged.

**Why (all measured, `scripts/harness/model-domain.mjs` on held-out TAG
scans, 30 cards, 64 corner slots with a TAG ding):**

| what the app hands the model | corner dings kept | false edge dings |
|---|---|---|
| TAG scan, untouched (the training domain) | 64 / 64 | 0 |
| same scan, backdrop beyond the corner painted black | 17 / 64 | 23 |
| painted white | 26 / 64 | 2 |
| painted wood-brown (close to TAG orange) | 60 / 64 | 0 |

Every training crop shows TAG's orange backdrop (mean RGB 247,126,44)
beyond the card; the models learned the backdrop as part of "a corner". The
app now paints a phone photo's table TAG orange before inference as a bridge
(`src/lib/tag-crops.js`, `repaintBackdrop`), which recovers 49 of 64; the
model should not need it. Second, phone photos are softer than a flatbed
scan: on the owner's worn card the four visibly rubbed back corners scored
0.21-0.38 wear (TAG-scan positives sit at 0.5-0.9) and two obviously frayed
edges scored 0.08-0.12. Third, the edge model is weak even on scans: a side
TAG marked scores a median of only 0.29. Fourth, a bowed card puts the
user's crop line off the true edge, so a strip can be 10-45 % table.

**Step 9 budget** (tell the user before starting): 9.1/9.2 (the augmentation
and `--phone-sim`) are already implemented — see Step 9.1/9.2 below. What is
left: corners v3-phone, 8 epochs at about 10 min, about 80 min; edges
v2-phone, 12 epochs at about 12 min, about 150 min; the optional edges HR
run at double resolution needs a new resized cache (about 40 min CPU) and
about 4x the epoch time, about 8 h; evals about 30 min; **about 4.5 h
without the optional run, about 12.5 h with it, at about $1/h**. Disk: the
optional 2048x384 edge cache (~130 GB) now fits — the rejected surface
caches were deleted, leaving 219 GB free on `/workspace` — but check
`df -h /workspace` before starting it anyway.

### Step 9.0: update the code and verify tests

```bash
cd /workspace/SlabSense && git pull && cd training
uv pip install --python .venv/bin/python -e ".[dev]" && .venv/bin/python -m pytest -q
```

### Step 9.1: the `phone` augmentation mode (DONE)

Implemented in `trainlib/phone_aug.py` (`apply_phone`, `phone_sim`, and the
per-slot seed table `seeds_for`/`outer_sides_for`) and wired into
`trainlib/data.py` as `AUG_MODES = ("light", "strong", "phone")` /
`load_crop(..., aug="phone")`. It recolours the TAG backdrop outside the
card, loosens the crop, softens (Gaussian blur + JPEG re-encode) and
downsamples-then-upsamples, in that order, at the crop's native scale.

Unlike `strong`, `phone` has **no random window**: a random window can crop
into the outer edge of the crop, which is both the flood-fill seed pixel
(there is then no backdrop-coloured pixel left to seed from) and, for
corners, where the angle/fill/fray label lives. Randomly windowing would
silently break the augmentation or the label on the same crops it is meant
to fix.

Tests: `training/tests/test_phone_aug.py` (the fill recolours a synthetic
orange corner and leaves the card; a black-on-black crop is refused; each
edge key seeds the right side after rotation; `apply_phone` is reproducible
per seed and `phone_sim` is deterministic). Local phone-sim baseline
established 2026-09-18 (see the table below); run `pytest -q` under
`training/` to confirm 9.1/9.2 still pass before training.

### Step 9.2: `--phone-sim` in `trainlib/evaluate.py` (DONE)

Also implemented: `--phone-sim` runs the deterministic eval-time variant
(seeded, no randomness in the choice — backdrop painted black, blur 1.0 px,
downscale 0.5) and writes `eval_<split>_phonesim.csv` next to the normal
`eval_<split>.csv`. It answers the only question that matters here: does
the model still see the wear when the picture looks like a phone photo?

**Local reference (RTX 4070 SUPER, 100-card val cache, `--limit-cards 100
--workers 0 --batch-size 8`, 2026-09-18)** — this is a smaller sample than
the full val split the box will use in Step 9.3, so treat it as a sanity
reference, not the number Step 9.5 grades against (Step 9.5 still uses the
full-val phone-sim run produced at the front of the Step 9.3 chain):

| model | mode | auroc_wear | precision_wear | recall_wear | mae_deduction |
|---|---|---|---|---|---|
| corners v2 | clean | 0.9201 | 0.7033 | 0.6957 | 102.5 |
| corners v2 | phone-sim | 0.8600 | 0.5806 | 0.1957 | 126.3 |
| edges v1 | clean | 0.9326 | 0.6500 | 0.3250 | 199.3 |
| edges v1 | phone-sim | 0.8683 | 0.0000 | 0.0000 | 266.4 |

Phone-sim collapses `recall_wear` on both models (edges to 0; corners from
0.70 to 0.20) while `auroc_wear` degrades less sharply — the ranking survives
better than the operating point does. That collapse is what corners
v3-phone / edges v2-phone must close.

### Step 9.3: train (shipped-model phone-sim baseline + both runs, chained)

Chain the shipped-model full-val phone-sim baseline and both training runs
in one `nohup bash -c "...; ..."` so the GPU never idles waiting for a human
to notice one step finished and start the next. Run names: `runs/edges/v2/`
already exists from the rejected regularized attempt (Step 6), so the phone
run is **`v2-phone`**; corners uses **`v3-phone`** for symmetry. Use these
names in every later reference (Step 9.4's optional HR variant, Step 9.5's
eval paths, Step 9.6's export `--run-name` and "bring home" folders).

```bash
cd /workspace/SlabSense/training && source /workspace/env.sh
df -h /dev/shm     # needs >= 8 GB for 16 loader workers; if smaller use --workers 12
nohup bash -c '
  .venv/bin/python -m trainlib.evaluate --task corners --checkpoint runs/corners/v2/best.pt --split val --workers 8 --phone-sim | tee runs/corners/v2/eval_val_phonesim.log &&
  .venv/bin/python -m trainlib.evaluate --task edges   --checkpoint runs/edges/v1/best.pt   --split val --workers 8 --phone-sim | tee runs/edges/v1/eval_val_phonesim.log &&
  .venv/bin/python -m trainlib.train --task corners --run-name v3-phone --epochs 8  --batch-size 64 --workers 16 --drop-path 0.2 --ema-decay 0.999 --aug phone > /workspace/train_corners_v3-phone.log 2>&1 ;
  .venv/bin/python -m trainlib.train --task edges   --run-name v2-phone --epochs 12 --batch-size 32 --workers 16 --aug phone > /workspace/train_edges_v2-phone.log 2>&1
' > /workspace/step9_chain.log 2>&1 &
```

(Edges v1 was the accepted recipe — no drop-path, no EMA, light aug; keep
that and add only the `--aug phone` transforms.) `--workers 16`, not 8: the phone
transforms run in the loader workers (flood fill + blur + JPEG per sample,
~30 ms each on a rental core), and 8 workers would feed only ~60-80% of
what the 5880 consumes; 16 keeps it GPU-bound. The `;` between the two
train commands is deliberate: if corners fails, edges still runs. Expect the two eval lines
to be bad (that is the point — write the `ALL`-row numbers down and compare
against the local reference table above). Monitor as in Step 3; augmented
runs converge a little slower, so judge from epoch 3 onward.

### Step 9.4: optional, if time allows — edges HR at double resolution

The edge strip is 1024x192, about a 5x downscale of TAG's roughly 3300x550,
which thins a fray line to 2-4 px. Add a task variant `edges_hr` in
`trainlib/tables.py` identical to `edges` but with `input_size (2048, 384)`
and `cache_resize (2048, 384)`; build its resized cache from the full-res
files already on the box (`cache_cli --task edges_hr --splits train,val,test
--from-cache`) — the ~130 GB it needs now fits in the 219 GB free on
`/workspace` — then train with `--run-name v2-phone-hr --aug phone
--batch-size 8`. The ONNX export and the app both read the input size from
the task spec and the contract sidecar, so nothing else changes; the app's
crop step is resolution-agnostic.

### Step 9.5: evaluate and accept

For each new model run the normal val eval **and** the phone-sim eval:

```bash
.venv/bin/python -m trainlib.evaluate --task corners --checkpoint runs/corners/v3-phone/best.pt --split val --workers 8 | tee runs/corners/v3-phone/eval_val.log
.venv/bin/python -m trainlib.evaluate --task corners --checkpoint runs/corners/v3-phone/best.pt --split val --workers 8 --phone-sim | tee runs/corners/v3-phone/eval_val_phonesim.log
```

Accept a model only if **both** hold on the val `ALL` row:

- clean val `auroc_wear` within 0.01 of the shipped model (corners v2:
  0.924, edges v1: 0.895) and `mae_deduction` not worse by more than 5 %
  (corners 103.7, edges 161.3). The augmentation must not cost scan accuracy.
- phone-sim val `auroc_wear` at least 0.03 higher than the shipped model's
  phone-sim number from the front of the Step 9.3 chain, and phone-sim
  `recall_wear` higher.

Then the test split, once per accepted model, both ways. If a model fails,
report the numbers and leave the artifacts; the shipped model stays. Do not
retune thresholds. That happens on the DIG harness at home, not here.

### Step 9.6: export and bring home

For each accepted model, export the ONNX copies on the box. The export
script needs the `export` extra (onnx, onnxruntime, onnxscript; CPU is
fine) and the cached val crops for its parity check:

```bash
uv pip install --python .venv/bin/python -e ".[dev,export]"
.venv/bin/python export_onnx.py --task corners --checkpoint runs/corners/v3-phone/best.pt --run-name v3-phone --parity-rows 400
.venv/bin/python export_onnx.py --task edges   --checkpoint runs/edges/v2-phone/best.pt   --run-name v2-phone --parity-rows 400
```

Copy home, per accepted model, into `training/weights/<task>/<run>/` and
`training/weights/onnx/` (create the folders locally first): `best.pt`,
`args.json`, `log.csv`, every `eval_*.log` and `eval_*.csv`, and from
`weights/onnx/` the three `.onnx` files plus the `<task>-<run>.json` and
`<task>-<run>.parity.json` sidecars (`<run>` is `v3-phone` / `v2-phone`).
Verify `best.pt` loads locally as in Step 4.

### Step 9.7: report

Report, per task: the clean and phone-sim val numbers for the old and new
model side by side, the test numbers once, the epoch that produced
`best.pt`, and the export parity line. What happens next is the main
session's job and is not yours: re-run `scripts/harness/verify-crops.mjs`,
`model-predict.mjs`, `model-sweep.mjs` and `model-domain.mjs` on the new
ONNX (the black-backdrop row should now keep most of the 64 corner dings
without the app's repaint), recalibrate the thresholds on the harness,
publish with new filenames via `npm run models:upload`, and point
`DEFAULT_MODEL_FILES` in `src/lib/corner-edge-runner.js` at them.

## Steps 10 and 11: card model and centering v2

In their own document: `training/HANDOFF-card-and-centering.md`. Step 10 is a
new segmentation model that finds the card in any photo (synthetic training
data from the TAG scans, real-photo acceptance set collected by the app);
Step 11 retrains `centering_rgb` so it stops shrinking off-centre cards toward
50/50. Read that document from the top; it is self-contained.
