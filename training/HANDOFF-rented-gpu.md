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
nohup .venv/bin/python -m trainlib.train --task edges --run-name v2 --epochs 8 --batch-size 32 --workers 8 --drop-path 0.2 --ema-decay 0.999 --aug strong > /workspace/train_edges_v2.log 2>&1 &
```

Expect about 9.5 min per corner epoch and 12.5 min per edge epoch, so about
75 min and 100 min respectively. Epoch 1 will look worse than v1's epoch 1
because the EMA copy lags the raw weights early; judge from epoch 3 onward.

Evaluate exactly as in Step 4 with `runs/<task>/v2/best.pt`. Accept v2 for
a task only if its val `ALL` row beats v1 on both auroc_wear (v1: corners
0.919, edges see the v1 report) and mae_deduction (v1: corners 105.0). Run
the test evaluation on an accepted v2 once, the same way. If v2 does not
beat v1, report the numbers and leave the artifacts in place; v1 stays.
Leave all `runs/<task>/v2/` artifacts on the box; the main session pulls
them down over SSH.

## Failure playbook

| Symptom | Do this |
|---|---|
| `CUDA out of memory` | halve `--batch-size`, rerun with a new `--run-name` (v1b); note it in the report |
| DataLoader worker crashes or `Bus error` | container shared memory is small: rerun with `--workers 4` |
| `RuntimeError: Set B2_KEY_ID and B2_APP_KEY` | `source /workspace/env.sh` in the same shell before the command |
| Cache count far below 222,008 after a rerun | check `df -h`; if the disk is full, stop and tell the user |
| val_loss rises from epoch 2 onward or shows `nan` | kill the run, copy `log.csv` home, report; do not retune |
| Box unreachable | the vast.ai page shows whether it was paused for credit; tell the user |
