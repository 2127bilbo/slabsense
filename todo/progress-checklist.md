# SlabSense grading models: what is done, where it lives, what remains

Snapshot 2026-09-18 (evening). Branch `tag-dataset` (not merged to main; it also carries
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
| Corners v3-phone | **shipped candidate** (replaces v2) | clean auroc 0.923 / mae 104.5; phone-sim 0.922 / recall 0.77; test 0.926 / 0.923 | `training/weights/corners/v3-phone/` + `weights/onnx/corners-v3-phone.*`; R2 `weights/corners/v3-phone/` |
| Corners v2 | superseded (still in the app until the swap) | auroc 0.924; phone-sim 0.863 / recall 0.19 | `training/weights/corners/v2/`; R2 |
| Edges v2-phone | **shipped candidate** (replaces v1) | clean 0.894 / 162; phone-sim 0.875 / recall 0.18; test 0.890 / 0.875 | `training/weights/edges/v2-phone/` + `weights/onnx/edges-v2-phone.*`; R2 |
| Edges v1 | superseded | 0.895 / 161; phone-sim 0.809 / recall 0.006 | `training/weights/edges/v1/`; R2 |
| Centering_rgb v1 | **accepted** | mean MAE 1.48 per-mille val / 1.49 test (~6-7 px; baseline 4.54) | `training/weights/centering_rgb/v1/`; R2 |
| Deduction regressor (box -> points) | done | MAE 66 vs baseline 112 | `training/weights/surface/v1/deduction.joblib` (local + box) |
| Surface detectors v1/v2/v3 | rejected (crease AP 0.47 but 6 false boxes per card side) | | box `runs/surface/`; v3 checkpoint local |
| Surface score regressors (per-side, front+rollup) | rejected: per-side back score does not follow the back image; front-only ties the grade-median baseline (173 vs 170) | | box `runs/surface_sfx/`, `runs/surface_front_sfx/` |
| Rollup (subscores -> total/grade) | not started (minutes, CPU) | | |
| Card-crop corner model | not started; see `todo/centering-and-crop-models.md`; user shooting photos | | |
| Edges HR (2048x384, phone aug) | optional next run (handoff Step 9.4), ~8 h box | | |

Test-split reads spent: corners v1, v2, v3-phone; edges v1, v3... (v2-phone); centering v1. Never for any surface checkpoint.

## Remaining, in order

1. [ ] App session: harness re-run on the new ONNX (`verify-crops`, `model-predict`, `model-sweep`, `model-domain`), recalibrate thresholds, `models:upload`, swap bucket entries (handoff Step 9.7 follow-up).
2. [ ] Centering v1 -> ONNX export (`export_onnx.py --task centering_rgb`), app wiring: crop to the card, predict four distances, classical snap, ratios.
3. [ ] Optional: edges HR at 2048x384 with phone aug (handoff Step 9.4; needs the `edges_hr` task entry, ~130 GB cache, fits in 218 GB free).
4. [ ] Rollup model (LightGBM/HistGB on corner/edge/centering subscores -> score_total, grade). CPU, minutes.
5. [ ] Company offsets TAG -> PSA/BGS/CGC/SGC from `docs/grading-research/sources/`.
6. [ ] Card-crop corner model: synthetic bootstrap + the user's photo set (`todo/centering-and-crop-models.md`).
7. [ ] Surface: revisit with a relabeling pass on phone photos (dents, scratches); the deduction regressor ships as-is.
8. [ ] Phone-photo fine-tune pass (all models) once testers deliver images.
9. [ ] Destroy the vast.ai box only after every artifact is pulled home (all accepted models are already home + in R2); merge `tag-dataset` to main (your call).

## Handy commands

```
# local tests
cd "G:\Grading App\SlabSense\training" && .\.venv\Scripts\python.exe -m pytest -q
# box status
ssh -p 22684 root@185.17.198.195 "tail -2 /workspace/SlabSense/training/runs/surface/v3/log.csv; nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader; df -h /workspace | tail -1"
# pull a run home (example)
scp -P 22684 root@185.17.198.195:/workspace/SlabSense/training/runs/surface/v3/best.pt "G:\Grading App\SlabSense\training\weights\surface\v3\best.pt"
```
