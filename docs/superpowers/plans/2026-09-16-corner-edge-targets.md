# Corner and Edge Targets Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the near-constant per-corner fill/fray regression targets with targets that carry TAG's actual corner and edge condition: wear presence per slot (from dings), deduction magnitude per slot (from markers, masked where absent), and the corner angle score; then rerun the corner smoke, run the edge smoke, and write the V100 recipe.

**Architecture:** Two packages change. `scripts/tag-dataset` gains per-slot label columns on `corners.parquet` and `edges.parquet` computed from the existing ding and marker rows (slot assignment by pixel position, string fallback). `training/` gains typed targets (binary vs regression) with a combined masked loss and per-type metrics; the model emits raw logits and the loss/eval apply sigmoid where needed. Everything else (cache, loaders, checkpointing, split gate) is unchanged.

**Tech Stack:** as the two existing packages.

**Spec:** `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md` §7 (amended by the ruling below), §11, §12. Predecessor plan: `docs/superpowers/plans/2026-09-15-corner-edge-training.md` (Tasks 9–10 there are superseded by Tasks 5–6 here).

## Global Constraints

- Measured facts driving this plan (2026-09-16, 27,751 certs): per-corner `score_fill`/`score_fray` are below 900 on 0.1% of rows and edge `score_fill` on 8 rows of 222,008, so they cannot be regression targets; `rollup_corners < 900` on 62.8% of cards; CORNER dings on 19,721 cards (53,407 dings; corner slot from position agrees with the string on 100%); rollup corner markers with per-slot deductions on 9,947 cards (sum per card correlates 0.90 with `1000 - rollup_corners`); `score_angle` has variance (84% of rows below 999; always NaN on back corners).
- Slot assignment for dings: by position when `x`,`y` are finite and within `[-0.05, 1.05]`: corners → `("T" if y < 0.5 else "B") + ("L" if x < 0.5 else "R")`; edges → argmin of `(x, 1-x, y, 1-y)` → `L, R, T, B`. Otherwise by the location string (upper-cased, spaces removed: `TOPLEFT/TOPRIGHT/BOTTOMLEFT/BOTTOMRIGHT` for corners; `TOP/BOTTOM/LEFT/RIGHT/TOPCENTER/BOTTOMCENTER/MIDDLELEFT/MIDDLERIGHT` for edges). Otherwise unassigned (counted by `stats`).
- Slot assignment for markers: by the marker's `location` field (`TL/TR/BL/BR` corners, `T/B/L/R` edges); markers with `engine_type` CORNER/EDGE only.
- Per-slot deduction: sum of `deduction` over rollup markers (`is_rollup`) at that slot if any, else sum over non-rollup markers at that slot if any, else NaN. `marker_source` records `"rollup"`, `"constituent"`, or null.
- New columns on `corners.parquet` and `edges.parquet`: `ding_count` (Int64, 0 when the card has dings data but none at this slot), `marker_deduction` (float64, NaN when none), `marker_source` (string, nullable). Existing columns unchanged. Splits unchanged; `build` must report `splits_new: 0`.
- Training targets: corners = `wear` (binary, `ding_count > 0`), `deduction` (regression, `marker_deduction / 1000` clipped to [0, 1], masked when NaN), `angle` (regression, `score_angle / 1000`, masked when NaN); edges = `wear`, `deduction`. Loss = masked BCE-with-logits over binary targets + masked Huber (β = 0.05) over sigmoid(regression logits), summed. Best checkpoint on validation loss.
- Metrics per target: binary → AUROC (rank-based, no sklearn), precision and recall at 0.5, positive count; regression → MAE in TAG points over masked rows. Reported overall and per grade.
- Test split never read by training; `--final-eval` gate unchanged. Unit tests CPU-only, no network, zero warnings in both packages.
- No `git stash`; `git add <explicit paths>`; commit messages end with:
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QGLEdmut9ukoVuG8AAVUHV

## Rulings (amendments to spec §7)

- Corner/edge models predict wear presence, deduction magnitude, and (corners) angle, not fill/fray. Fill/fray columns stay in the tables for reference and are dropped from the targets.
- Slot assignment uses position first, string second, because TAG's strings are inconsistent (two spellings; "TOP LEFT" on an edge ding is genuinely ambiguous) and position matched the strings wherever both were unambiguous.
- Rollup marker deductions are preferred over constituent sums because they are TAG's own per-slot totals and correlate more strongly with the rollup score (0.90 vs 0.82).

---

### Task 1: Slot targets in the dataset build (`scripts/tag-dataset`)

**Files:**
- Modify: `scripts/tag-dataset/tagdataset/labels.py`, `tagdataset/build.py`, `tagdataset/stats.py`, `README.md`
- Modify: `tests/test_labels.py`, `tests/test_build.py`, `tests/test_stats.py`

**Interfaces:**
- `labels.ding_slot(row: dict, kind: str) -> str | None` where `kind` is `"corner"` or `"edge"` and `row` is a `ding_rows` dict (uses `x`, `y`, `location`).
- `labels.slot_targets(markers: list[dict], dings: list[dict]) -> dict[tuple[str, str, str], dict]` keyed by `(side, kind, slot)` with values `{"ding_count": int, "marker_deduction": float, "marker_source": str | None}`; `kind` in `{"corner", "edge"}`; only slots with at least one ding or marker appear.
- `labels.corner_rows(cert, score, targets=None)` and `labels.edge_rows(cert, score, targets=None)`: when `targets` is given, fill the three new columns (`ding_count` 0 / `marker_deduction` NaN / `marker_source` None for absent slots); when None, `ding_count` is NaN (so callers that lack ding data are distinguishable). `CORNER_COLUMNS` / `EDGE_COLUMNS` gain the three names at the end.
- `build.build` computes `surface_rows` and `ding_rows` per cert first, passes `slot_targets(...)` into `corner_rows`/`edge_rows`. Schemas: `ding_count` Int64, `marker_deduction` float64, `marker_source` string.
- `stats.report` gains `== slot targets ==`: for corners and edges, count of slots with `ding_count > 0`, with `marker_deduction` present by source, dings that could not be assigned a slot, and the per-card correlation between summed `marker_deduction` and `1000 - rollup_corners` (corners) / `1000 - rollup_edges` (edges). Append the heading to `SECTIONS`.

- [ ] **Step 1: Tests first** (add to the three test files):
  - `ding_slot`: `{"x": 0.02, "y": 0.97, "location": "TOP LEFT"}` with kind corner → `"BL"` (position wins); `{"x": nan, "y": nan, "location": "BOTTOMRIGHT"}` → `"BR"`; edge `{"x": 0.5, "y": 0.02, "location": "TOP LEFT"}` → `"T"`; edge `{"x": 0.02, "y": 0.5, "location": "TOP LEFT"}` → `"L"`; `{"x": 2.5, "y": 0.5, "location": "MIDDLE RIGHT"}` edge → `"R"` (out-of-range position falls back to string); `{"x": nan, "y": nan, "location": "SOMEWHERE"}` → None.
  - `slot_targets`: two corner dings at TL front, one rollup CORNER marker at TL front with deduction 120 and two constituent markers at the same slot with 50 and 40 → `{"ding_count": 2, "marker_deduction": 120.0, "marker_source": "rollup"}`; a slot with only constituents 50 + 40 → 90.0 and `"constituent"`; a slot with a ding but no marker → `ding_count 1`, NaN, None; EDGE markers land under kind `"edge"`; is_rollup EDGE marker at "R" back → key `("B", "edge", "R")`.
  - `corner_rows` with targets fills columns; without targets `ding_count` is NaN; column lists end with the three new names in order.
  - `build`: fixture store yields non-NaN `ding_count` on every corner/edge row and `marker_source` values in `{"rollup", "constituent", None}`; dtypes `Int64` / `float64` / `string`.
  - `stats`: `== slot targets ==` section present and reports the counts for the fixture (at least one positive corner slot from the recorded fixture's CORNER WEAR dings).
- [ ] **Step 2: Implement**, run both packages' suites green (tag-dataset expected 142 → ~150).
- [ ] **Step 3: Rebuild and stats.** From `scripts/tag-dataset`: `.\.venv\Scripts\python.exe -m tagdataset build` (expect `splits_new: 0`) and `stats --save data/dataset/stats_report.txt`; paste the `== slot targets ==` section into the report. README: document the three columns and the slot rules; add a Status row.
- [ ] **Step 4: Commit** `feat(tag-dataset): per-slot wear and deduction targets for corners and edges` (code, tests, README; nothing under `data/`; `splits/` unchanged).

---

### Task 2: Typed targets, combined loss, and metrics (`training`)

**Files:**
- Modify: `training/trainlib/tables.py`, `data.py`, `models.py`, `train.py`, `evaluate.py`, `README.md`
- Modify: `training/tests/conftest.py` (synthetic tables gain the three columns), `test_tables.py`, `test_data.py`, `test_models.py`, `test_train.py`, `test_evaluate.py`

**Interfaces:**
- `tables.TASKS[task]["targets"]` becomes a list of `Target(name, kind, column)` namedtuples: corners `[("wear","binary","ding_count"), ("deduction","regress","marker_deduction"), ("angle","regress","score_angle")]`; edges `[("wear","binary","ding_count"), ("deduction","regress","marker_deduction")]`. `tables.target_names(task) -> list[str]`, `tables.target_kinds(task) -> list[str]`.
- `data.CropDataset.__getitem__` builds `target`/`mask` per the Global Constraints (binary: value 1.0/0.0 with mask 1 when `ding_count` is not NaN; regressions: `/1000` clipped to [0,1], mask 0 when NaN).
- `models.ScoreRegressor.forward` returns raw logits (no sigmoid). `models.masked_loss(pred, target, mask, kinds: list[str], beta=0.05, pos_weight: float | None = None) -> tensor`; `models.to_scores(pred, kinds) -> tensor` applying sigmoid to every channel (probabilities for binary, 0–1 scores for regression).
- `train.evaluate_loader(model, loader, device, kinds) -> dict` with keys `loss` plus, per target name, `mae_<name>` (regression, TAG points) or `auroc_<name>`, `precision_<name>`, `recall_<name>`, `npos_<name>` (binary). `LOG_COLUMNS` = `epoch, train_loss, val_loss, lr, seconds` + the metric keys in target order. Best checkpoint on `val_loss`. Checkpoint dict gains `kinds` and `target_names`.
- `evaluate.per_grade_table` columns: `grade_label, n_rows` + the same metric keys; `ALL` last.
- `metrics.auroc(scores: Tensor, labels: Tensor) -> float` (rank-based Mann–Whitney; NaN when a class is absent) in a new `training/trainlib/metrics.py` with tests (perfect separation → 1.0, random-ish → ~0.5, one class → NaN).

- [ ] **Step 1: Tests first** across the files above (update conftest's `make_tables` to add `ding_count` (with some zeros and some 1/2), `marker_deduction` (some NaN), `marker_source`); the train test asserts the new `LOG_COLUMNS` and that `auroc_wear` is finite when val has both classes; the evaluate test asserts the per-grade columns; the models test asserts `masked_loss` on a batch with all-masked regressions equals the BCE part alone, and `to_scores` is in [0, 1].
- [ ] **Step 2: Implement**; full suite green (27 → ~34), no warnings.
- [ ] **Step 3: README**: Metrics section rewritten for the typed targets; note that fill/fray are not targets and why.
- [ ] **Step 4: Commit** `feat(training): wear/deduction/angle targets with combined loss and per-type metrics`.

---

### Task 3: Corner smoke rerun on the 4070

- [ ] Re-run the smoke exactly as Task 8 of the predecessor plan (cache is already populated; `--workers 2`; 3 epochs; 500/100 cards). Expect `npos_wear` in the hundreds on val, a finite `auroc_wear` that rises across epochs, and `mae_deduction` / `mae_angle` in points. Record per-epoch seconds, peak VRAM, and the metric table in the README Results (replace the old row's metrics; keep the timings) and commit `docs(training): corner smoke on wear/deduction/angle targets`.

---

### Task 4: Edge smoke on the 4070

- [ ] `cache_cli --task edges --splits train:500,val:100 --workers 16` (larger files; record GB and MB/s), then train 3 epochs at `--batch-size 16 --workers 2`, evaluate val, README row, commit `docs(training): edge smoke run results`.

---

### Task 5: V100 full-run recipe (docs)

- [ ] Write the README section from Task 10 of the predecessor plan, updated for the typed targets and `--workers` guidance (rented box: 8 workers is fine). Commit `docs(training): V100 full-run recipe`.

---

## Self-review

**Spec coverage.** §7 corners/edges (amended targets) → Tasks 1–2; metrics per grade → Task 2; smoke locally then rented → Tasks 3–5; §11 masking and test gate unchanged → Task 2 keeps `allow_test`; §12 per-grade tables → Task 2.
**Placeholder scan.** Tasks give interfaces and required tests rather than full code, matching the addendum style used for Tasks 11–13 of the acquisition plan and Task 7–8 of the build plan.
**Type consistency.** `Target` fields `(name, kind, column)` are used identically by `tables`, `data`, `models.masked_loss(kinds)`, `train`, `evaluate`; checkpoint carries `kinds`/`target_names` so `evaluate` needs no task lookup for metrics.
