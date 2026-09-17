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
