# SlabSense grading models: what is done, where it lives, what remains

Snapshot 2026-09-17. Branch `tag-dataset` (not merged to main; it also carries
unrelated work, so merging is your call). Box: vast.ai RTX 5880 Ada 48 GB,
`ssh -p 22684 root@185.17.198.195`, repo at `/workspace/SlabSense`, caches
under `/workspace/cache`, run artifacts under
`/workspace/SlabSense/training/runs/`. The GPU-side Claude session is
"Rented gpu" (Remote Control) and follows `training/HANDOFF-rented-gpu.md`.

## Design and plans

| Item | Location |
|---|---|
| Design spec (all models, serving, app integration) | `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md` |
| Dataset acquisition plan | `docs/superpowers/plans/2026-09-12-tag-dataset-acquisition.md` |
| Dataset build plan | `docs/superpowers/plans/2026-09-13-tag-dataset-build.md` |
| Corner/edge training plan | `docs/superpowers/plans/2026-09-15-corner-edge-training.md` |
| Corner/edge target redesign (wear/deduction/angle) | `docs/superpowers/plans/2026-09-16-corner-edge-targets.md` |
| Surface detector plan | `docs/superpowers/plans/2026-09-16-surface-detector.md` |
| Surface score regressor plan | `docs/superpowers/plans/2026-09-17-surface-score.md` |
| Execution ledgers (rulings, reviews, reports) | `.superpowers/sdd/<plan-name>/progress.md` (git-ignored scratch) |
| Operator runbook for the dataset pull | `scripts/tag-dataset/RUNBOOK.md` |
| Training README (results, recipes, diagnoses) | `training/README.md` |
| Box handoff (Steps 0–8, budget, playbook) | `training/HANDOFF-rented-gpu.md` |
| Grading standards (verbatim captures) | `docs/grading-research/sources/` |

## Data

- [x] TAG DIG dataset: 27,751 certs, all grades 1–10P. Package `scripts/tag-dataset/` (fetch, download, verify, build, stats CLIs; 169 tests).
- [x] Storage: Cloudflare R2 bucket `slabsense-tag-dataset`, prefix `tag-dataset/{cert}/`, 1.63 TB (~$24/month). Keys in `scripts/tag-dataset/data/env.ps1` (git-ignored) and on the box at `/workspace/env.sh`.
- [x] Training tables: `scripts/tag-dataset/data/dataset/{manifest,corners,edges,surface,dings,splits}.parquet` (local; manifest/corners/edges/surface/dings also copied to the box). Frozen split committed at `scripts/tag-dataset/splits/splits.parquet` (train 22,202 / val 2,790 / test 2,759).
- [x] Box caches: corners full-res (105 GB), edges resized 1024×192 (33 GB), all 111,004 whole-card images both views (435 GB), surface tiles 1024² (45 GB, 125k tiles).
- [ ] Phone-photo dataset (testers; ~30 saved alignments today). See `todo/centering-and-crop-models.md`.

## Training package

- [x] `training/trainlib/`: R2 reader + resumable cache (`cache.py`, `cache_cli.py`), task tables (`tables.py`), crop dataset (`data.py`), ConvNeXt regressor + masked loss (`models.py`), metrics, `train.py`, `evaluate.py`; v2 knobs (`--drop-path`, `--ema-decay`, `--aug strong`).
- [x] Surface detector: `surface_tables.py`, `tiles.py`, `surface_cache_cli.py`, `tile_data.py`, `detector.py` (Faster R-CNN v2, small anchors), `det_metrics.py`, `train_surface.py` (`--views`, `--neg-grades`, `--balance`, `--classes`, `--init`), `evaluate_surface.py`, `deduction_model.py`.
- [x] Surface score tasks (`surface_sfx`, `surface_rgb`) in `tables.py`; `cache_cli --from-cache`.
- [x] 116 tests: `cd training && .venv/Scripts/python -m pytest -q`.

## Models

| Model | Status | Numbers (val unless noted) | Weights / artifacts |
|---|---|---|---|
| Corners v1 | done | auroc_wear 0.919, mae_deduction 105, test 0.923 / 107 | `training/weights/corners/v1/` (best.pt local only; logs/evals committed) |
| Corners v2 (EMA, drop-path 0.2, strong aug) | done, **shipped version** | auroc 0.924, mae 103.7; test 0.927 / 105.1 / angle 2.37 | `training/weights/corners/v2/` |
| Edges v1 | done, **shipped version** | auroc 0.895, mae 161; test 0.894 / 170 | `training/weights/edges/v1/` |
| Edges v2 | done, rejected | auroc 0.883, mae 170 | `training/weights/edges/v2/` |
| Surface detector v1 (7 classes, both views) | done, rejected | map50 0.075; creases only | box `runs/surface/v1/` |
| Surface detector v2 (sfx only, clean negatives, balanced) | done, rejected | map50 0.109 on sfx; CREASE 0.44 | box `runs/surface/v2/` |
| Surface detector v3 (CREASE+SCRATCH only) | **training now** (12 epochs, ~3 h) | epoch 3: CREASE 0.385 | box `runs/surface/v3/` |
| Deduction regressor (box → points) | done | MAE 66 vs baseline 112 | box `weights/surface/v1/deduction.joblib` (+ local smoke copy) |
| Surface score `surface_sfx` / `surface_rgb` | **next on the box** (handoff Step 8) | smoke plumbing ok; baseline 170; accept ≤ 119 | box `runs/surface_sfx/v1/`, `runs/surface_rgb/v1/` when run |
| Rollup (subscores → total/grade) | not started (minutes, CPU) | | |
| Centering model | not started | see `todo/centering-and-crop-models.md` | |
| Card-crop corner model | not started | see `todo/centering-and-crop-models.md` | |
| Crease/scratch detector, color view (boxes on phone photos) | not started; same command as v3 with `--views rgb` | | |

Test-split rule: read once per accepted checkpoint only. Read so far: corners v1, corners v2, edges v1. Never for any surface checkpoint yet.

## Remaining, in order

1. [ ] v3 finishes → val eval (`--views sfx --full-cards 100`) → decide if creases ship; pull artifacts home.
2. [ ] Step 8 on the box: resized caches (two passes, CPU), `surface_sfx` v1, `surface_rgb` v1, val evals, test once if ≤ 119. Pull artifacts home.
3. [ ] Color-view crease detector (`--views rgb --classes CREASE,SCRATCH`) if v3 creases are usable.
4. [ ] Rollup model (LightGBM/HistGB on subscores + centering → score_total, grade). CPU, minutes.
5. [ ] Centering model (`centering_rgb`), then classical snap.
6. [ ] Card-crop corner model (synthetic bootstrap + user photos).
7. [ ] Company offsets TAG → PSA/BGS/CGC/SGC from `docs/grading-research/sources/`.
8. [ ] Inference service (`inference/`, Modal): load weights, `/grade` returning the unified schema (spec §8).
9. [ ] App integration: model grade path; LLM identifies the card and writes the explanation only.
10. [ ] Upload accepted weights to R2 under `weights/<task>/<version>/` (backup; `.pt` is git-ignored).
11. [ ] Phone-photo fine-tune pass (all models) once testers deliver images.
12. [ ] Destroy the vast.ai box only after every artifact is pulled home; merge `tag-dataset` to main (your call).

## Handy commands

```
# local tests
cd "G:\Grading App\SlabSense\training" && .\.venv\Scripts\python.exe -m pytest -q
# box status
ssh -p 22684 root@185.17.198.195 "tail -2 /workspace/SlabSense/training/runs/surface/v3/log.csv; nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader; df -h /workspace | tail -1"
# pull a run home (example)
scp -P 22684 root@185.17.198.195:/workspace/SlabSense/training/runs/surface/v3/best.pt "G:\Grading App\SlabSense\training\weights\surface\v3\best.pt"
```
