# Centering v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the centering model compressing off-centre cards toward 50/50, by training on the ratios the grading engine consumes, oversampling off-centre cards, and adding phone softness; measured with new ratio and compression metrics.

**Architecture:** Three additive changes to the existing stack, all gated on the `centering_rgb` task: (1) a ratio L1 term in `models.masked_loss` (weight `--ratio-weight`, default 2.0) on `l/(l+r)` and `t/(t+b)`; (2) a `WeightedRandomSampler` over deviation buckets (`tables.centering_deviation_bucket`); (3) `phone_aug.soften` + `resolution_loss` in the centering jitter branch of `CropDataset` at the Step 9 probabilities (p 0.5, p 0.3), no recolour, no loose crop. `evaluate.py` gains the ratio MAEs, the compression slope, per-bucket means, and within-1/within-2 rates for this task, and `--phone-sim` for it applies blur 1.0 and downscale 0.5 only.

**Tech Stack:** existing `trainlib`; numpy, torch, pandas, pytest.

**Spec:** `training/HANDOFF-card-and-centering.md` Step 11 (11.0–11.3). Numbers there are the acceptance rule.

## Global Constraints

- Tests via `cd training && .venv/Scripts/python -m pytest -q`; `filterwarnings = ["error"]`. Never `git add` `scripts/tag-dataset/tagdataset/cli.py`/`download.py`, `.pt`, `.onnx`; never `git stash`.
- Targets stay `dte_l, dte_r, dte_t, dte_b` in per-mille; input 896×1248; recipe `--epochs 10 --batch-size 8 --drop-path 0.1 --ema-decay 0.999 --aug light` with edge jitter ±3%.
- Ratio term: with predictions `p` and targets `t` on the 0–1 scale (after sigmoid / SCALE), `r_lr(x) = x_l / (x_l + x_r + 1e-6)`, `r_tb(x) = x_t / (x_t + x_b + 1e-6)`; `ratio_loss = mean over unmasked rows of |r_lr(p) − r_lr(t)| + |r_tb(p) − r_tb(t)|`; total = distance term (unchanged) + `ratio_weight · ratio_loss`. Only when all four targets are present in the row (mask all 1). Log both terms per epoch in `log.csv` as `loss_dist` and `loss_ratio` (new columns, appended after `lr`; corners/edges log NaN there is NOT acceptable — the columns are added only for tasks whose spec has `"ratio_pairs"`).
- Task spec addition: `TASKS["centering_rgb"]["ratio_pairs"] = [("dte_l", "dte_r"), ("dte_t", "dte_b")]`.
- Deviation bucket per side: `dev = max(|l/(l+r) − 0.5|, |t/(t+b) − 0.5|) · 100` in ratio points, from the targets; buckets `[0,2), [2,5), [5,10), [10,20), [20,∞)`; sampler weights: bucket 0 gets weight 1; buckets 1–4 get weights such that their combined expected draw count equals bucket 0's (each of the four gets `n0 / (4 · n_k)` per row, so each upper bucket contributes n0/4 draws). `--balance-deviation` flag; the trainer prints the realised bucket counts of the first epoch's draws (count the sampler's indices).
- Phone softness in the centering jitter branch when `train` and `aug == "phone"`: `soften` p 0.5, `resolution_loss` p 0.3, applied to the resized 896×1248 image after `jitter_edges`; no recolour, no loose crop. `--phone-sim` for `centering_rgb`: blur 1.0 px at input scale and downscale 0.5, no backdrop change (a `phone_sim_soft(img, input_size)` helper in `phone_aug`).
- Evaluation additions (`evaluate.py`, only for tasks with `ratio_pairs`): per grade and ALL: `mae_ratio_lr`, `mae_ratio_tb` (ratio points = ×100), `within1`, `within2` (fraction of rows with both |Δratio| ≤ 1 / ≤ 2 points), `slope` (least-squares slope of TAG deviation on predicted deviation, both `|ratio − 50|` pooled over both axes, ALL row only), and a separate table `eval_<split>_buckets.csv` with columns `bucket, n, tag_mean_dev, pred_mean_dev` for the five buckets. Printed after the per-grade table.
- Acceptance (val, clean): distance MAEs not worse than v1 (l 1.75, r 1.87, t 1.09, b 1.21); `mae_ratio_lr` and `mae_ratio_tb` ≤ 1.4; slope ≥ 0.95; bucket means for [5,10) and [10,20) within 10% of TAG's; `within2` ≥ 0.68; phone-sim ratio MAEs within 0.3 of clean. Test once if accepted.

---

### Task 1: Ratio loss, log columns, task spec

**Files:** Modify `trainlib/models.py` (`masked_loss(..., ratio_pairs=None, ratio_weight=0.0)` returning the total and exposing `last_terms = {"dist", "ratio"}` via a small `LossTerms` namedtuple return when `return_terms=True`), `trainlib/tables.py` (`ratio_pairs`, `target_index(task, name)`), `trainlib/train.py` (`--ratio-weight`, pass pairs, log `loss_dist`/`loss_ratio` for tasks with pairs); Tests `tests/test_models.py`, `tests/test_train.py`.

- [ ] Tests: `masked_loss` with `ratio_pairs` on a batch where predictions equal targets gives ratio term 0; where predicted l/r are swapped relative to targets, the ratio term is positive and the total exceeds the distance-only loss by `ratio_weight · ratio_term`; rows with any masked target contribute nothing to the ratio term; the centering trainer test (existing `test_train_surface`-style tiny run for `centering_rgb` in `test_data.py`/`test_train.py`) logs the two new columns, and a corners run does not.
- [ ] Implement; full suite; commit `feat(training): ratio loss term for the centering task`.

### Task 2: Deviation-balanced sampler and phone softness

**Files:** Modify `trainlib/tables.py` (`centering_deviation_bucket(df) -> Series[int]`, `deviation_weights(df) -> Tensor`), `trainlib/train.py` (`--balance-deviation`, `WeightedRandomSampler`, realised-bucket print), `trainlib/data.py` (softness in the jitter branch under `aug == "phone"`), `trainlib/phone_aug.py` (`phone_sim_soft`); Tests `tests/test_tables.py`, `tests/test_data.py`, `tests/test_phone_aug.py`.

- [ ] Tests: bucket boundaries on hand-built rows (dev 1.9 → 0, 2.0 → 1, 9.99 → 2, 20 → 4); weights make the expected draws of buckets 1–4 sum to bucket 0's; the centering dataset with `aug="phone"` returns the right shape and differs from `aug="light"` with the same seed; `phone_sim_soft` is deterministic and changes pixels; `train` with `--balance-deviation` runs one tiny epoch and prints five bucket counts.
- [ ] Implement; full suite; commit `feat(training): deviation-balanced sampling and phone softness for centering`.

### Task 3: Evaluation metrics and phone-sim for centering

**Files:** Modify `trainlib/evaluate.py` (ratio metrics, slope, buckets CSV, `--phone-sim` path for centering using `phone_sim_soft`), `trainlib/data.py` (`phone_sim` in the centering path → `phone_sim_soft`); Tests `tests/test_evaluate.py`.

- [ ] Tests: on a fake per-grade table with known predictions the ratio MAE, within1/within2 and slope come out exactly (hand-computed); the buckets CSV has five rows; `--phone-sim` on a tiny centering checkpoint runs and writes `eval_val_phonesim.csv`.
- [ ] Implement; full suite; commit `feat(training): centering ratio/compression metrics; phone-sim for centering`.

### Task 4: Local smoke, README, handoff Step 11 revision

- [ ] Smoke on the 4070 with the local 300/60-card centering cache: `train --task centering_rgb --run-name v2smoke --epochs 2 --limit-cards 300 --val-limit-cards 60 --batch-size 2 --workers 0 --drop-path 0.1 --ema-decay 0.999 --aug phone --ratio-weight 2.0 --balance-deviation`, detached; record the two loss terms, bucket counts, and the new eval columns from `evaluate --limit-cards 60` clean and `--phone-sim`. Also run the new evaluation on the shipped v1 checkpoint (`weights/centering_rgb/v1/best.pt`, 60 local val cards) clean and phone-sim so the ratio/slope baseline is on record.
- [ ] README "Centering v2" subsection (why, the three changes, the new metrics, smoke and v1-baseline numbers); revise handoff Step 11 in `HANDOFF-card-and-centering.md` to name the flags (`--aug phone --ratio-weight 2.0 --balance-deviation`), the cache rebuild (`cache_cli --task centering_rgb --splits train,val,test --from-cache` needs the rgb originals on the box: on a fresh instance that is a 250 GB pull, ~$10, ~1 h at 50 files/s), the eval commands, and the acceptance table.
- [ ] Commit `docs(training): centering v2 smoke and baseline; handoff Step 11 revised`.

---

## Self-review

11.1 (three changes): Tasks 1–2. 11.2 (metrics + acceptance): Task 3 + constraints. 11.3 export: unchanged `export_onnx.py --task centering_rgb --run-name v2` (already supports the task). `ratio_pairs` is the single switch that gates the loss term, the log columns, and the evaluation additions, so corners/edges are untouched.
