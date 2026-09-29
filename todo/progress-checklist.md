# SlabSense grading models: what is done, where it lives, what remains

Snapshot 2026-09-28. Second rental (2x RTX PRO 4000, 2026-09-22/23) trained centering v2b and card model v1; both home, in R2, and documented; no box is rented now. Branch `tag-dataset` (not merged to main; it also carries
unrelated work, so merging is your call). Box: vast.ai RTX 5880 Ada 48 GB,
(destroyed; rent again when needed), repo at `/workspace/SlabSense`, caches
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
| Centering v2b (ratio loss 0.1, capped deviation sampling, phone softness) | **accepted, shipping** (slope gate 0.878 vs 0.95 documented as a structural floor) | val ratio MAE 1.18/0.85, within2 0.79, slope 0.88; test 1.19/0.86, 0.78, 0.83; phone-sim unchanged | `training/weights/centering_rgb/v2b/` + `weights/onnx/centering_rgb-v2b.*`; R2 |
| Card model v1 (segmentation, synthetic composition) | **accepted for raw cards, shipping**; cards in sleeves/one-touches/slabs out of scope by product decision (take the card out) | real 107 raw/bowed sides: IoU 0.987, corner err 0.44% / p95 0.83%; holders (37): fails, traces the case | `training/weights/card/v1/` + `weights/onnx/card-v1.*` (fp16 5.98 MB); R2 |
| Card model v2 (synthetic holders in the compositor) | optional later upgrade; run only as filler on an already-rented idle GPU | test set = the 37 real holder sides in `training/data/card-val/` (tag `sleeve`) | |
| Edges HR (2048x384, phone aug) | optional next run (handoff Step 9.4), ~8 h box | | |

Test-split reads spent: corners v1, v2, v3-phone; edges v1, v3... (v2-phone); centering v1, v2b. Never for any surface checkpoint.

## Remaining, in order

1. [ ] App session: wire centering v2b ONNX (harness first, `scripts/harness/centering-model.mjs`) and card v1 ONNX into the crop step (handoff 10.6), WebGPU fp16 check on both, aspect gate perspective-tolerant. Guidance in the tool for raw cards only: take cards out of cases/sleeves.
2. [ ] Rollup model (subscores -> total/grade). CPU, minutes.
3. [ ] Company offsets TAG -> PSA/BGS/CGC/SGC from `docs/grading-research/sources/`.
4. [ ] When TAG certs exist for the 30th Celebration Crystal Lugia: pull their DIG reports and confirm the e-Reader convention (`docs/grading-research/e-reader-centering.md`).
5. [ ] Optional, only on an already-rented idle GPU: card v2 with synthetic holders; edges HR (handoff Step 9.4); centering v3 (higher input res or direct-ratio head) if the slope floor matters.
6. [ ] Surface: revisit with a relabeling pass on phone photos; the deduction regressor ships as-is.
7. [ ] Phone-photo fine-tune pass (all models) once testers deliver images.
8. [ ] Merge `tag-dataset` to main (your call).

## Handy commands

```
# local tests
cd "G:\Grading App\SlabSense\training" && .\.venv\Scripts\python.exe -m pytest -q
# box status
ssh -p 22684 root@185.17.198.195 "tail -2 /workspace/SlabSense/training/runs/surface/v3/log.csv; nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader; df -h /workspace | tail -1"
# pull a run home (example)
scp -P 22684 root@185.17.198.195:/workspace/SlabSense/training/runs/surface/v3/best.pt "G:\Grading App\SlabSense\training\weights\surface\v3\best.pt"
```
