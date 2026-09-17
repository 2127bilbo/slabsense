# Surface Score Regressor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Predict TAG's per-side surface score (0–1000) from one whole-card image, one model per view (relief `sfx`, color `rgb`), so the grade rollup gets a surface subscore that does not depend on defect boxes.

**Architecture:** Reuse the corner/edge regression stack unchanged (`ScoreRegressor` = ConvNeXt-Tiny + head with the side flag, `train.py`, `evaluate.py`, AMP, EMA/drop-path/strong-aug flags). Two new entries in `tables.TASKS` (`surface_sfx`, `surface_rgb`) whose rows are derived from `manifest.parquet` (one row per cert per side; `crop_path` is the whole-card image key; target `score` = `surface_front` / `surface_back`). Whole-card images are cached pre-resized to 896×1248 (portrait, no rotation) through the existing resized-cache path, built from the full-resolution files already on the box rather than re-downloaded.

**Tech Stack:** Python 3.12, torch 2.9.1+cu128, timm, Pillow, pandas/pyarrow, pytest; existing `trainlib` modules.

**Spec:** `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md` §7 (Surface row, Rollup row) and §8. This plan changes the surface model's *output* from "boxes + type + deduction" to "per-side surface score", because the 2026-09-17 detector runs showed TAG's markers cannot train a box detector for dents, scratches, pits or stains (README "Surface v1 diagnosis"); boxes for creases and scratches remain the detector's job (handoff Step 7.10). The rollup (§7) consumes the per-side scores.

## Global Constraints

- Python `>=3.12,<3.13`; torch `2.9.1`; tests via `cd training && .venv/Scripts/python -m pytest -q`; all existing tests (107) keep passing; `filterwarnings = ["error"]`.
- Never `git add` `scripts/tag-dataset/tagdataset/cli.py` or `download.py`; never any `.pt`/`.joblib`; never `git stash`. Commit only the files each task names. `training/README.md` says the package never modifies the dataset tables: derived rows are built in memory, never written to `dataset_dir`.
- Task specs (exact): `TASKS["surface_sfx"]` and `TASKS["surface_rgb"]` with `"table": "manifest.parquet"`, `"rows": surface_side_rows`, `"view": "sfx" | "rgb"`, `"targets": [Target("score", "regress", "score")]`, `"key_cols": ["side"]`, `"input_size": (896, 1248)` (width, height), `"long_side_horizontal": False`, `"cache_resize": (896, 1248)`.
- Derived rows (`surface_side_rows(manifest_df, view) -> DataFrame`): columns `cert, side ("F"/"B"), crop_path, score`; `crop_path` = `path_sfx_front`/`path_sfx_back` for `sfx`, `path_front`/`path_back` for `rgb`; `score` = `surface_front`/`surface_back` as float; rows with a null image path or null score are dropped; sorted by cert then side.
- `load_task_table` applies `spec["rows"]` (if present) to the parquet before merging splits and grades; everything else in it is unchanged (test-split gate, `limit_cards` seeding).
- Resized cache: `_resize_and_save(..., rotate: bool)` rotates to landscape only when `rotate` is true; `build_cache(..., rotate=True, local_full=False)`; `local_full=True` makes `_fetch` read the bytes from `cache_path(cache_dir, key)` when that file exists (no `reader.get`, no `reader.size`), else fall back to the reader. `cache_cli` passes `rotate=TASKS[task]["long_side_horizontal"]` and gains `--from-cache` → `local_full=True`.
- `load_crop` already resizes to `input_size` and rotates only when `long_side_horizontal`; no change. `CropDataset` resolves the resized path first; no change.
- Training defaults for the full runs: `--epochs 10 --batch-size 8 --workers 8 --drop-path 0.1 --ema-decay 0.999 --aug strong`, lr default 2e-4 (OneCycle). Local smoke: `--limit-cards 300 --val-limit-cards 60 --epochs 2 --batch-size 2 --workers 0`, detached.
- Metric: MAE in TAG points (`mae_score`) per grade and `ALL`, from the unchanged `evaluate.py`. Acceptance for v1: val `ALL` `mae_score` below the class-median baseline reported by the smoke's stats step (Task 3 records it) and below 100 points; test split read once per accepted model.

---

## File structure

| File | Responsibility |
|---|---|
| `training/trainlib/tables.py` | `surface_side_rows`; two new TASKS entries; `rows` hook in `load_task_table` |
| `training/trainlib/cache.py` | `rotate` and `local_full` options |
| `training/trainlib/cache_cli.py` | `--from-cache`; pass `rotate` |
| `training/tests/test_tables.py`, `test_cache.py`, `test_cache_cli.py`, `test_data.py` | new cases |
| `training/tests/conftest.py` | `make_surface_tables` gains `surface_front`/`surface_back` |
| `training/README.md`, `training/HANDOFF-rented-gpu.md` | surface-score section; handoff Step 8 |

---

### Task 1: Surface-score task tables

**Files:**
- Modify: `training/trainlib/tables.py`, `training/tests/conftest.py` (extend `make_surface_tables` manifest)
- Test: `training/tests/test_tables.py` (append)

**Interfaces:**
- Produces: `surface_side_rows(df, view)`; `TASKS["surface_sfx"]`, `TASKS["surface_rgb"]`; `load_task_table("surface_sfx", ...)` returns rows with `cert, side, crop_path, score, split, grade_label`.

- [ ] **Step 1: Extend the fixture**

In `make_surface_tables` (conftest), add two columns to the manifest DataFrame: `"surface_front": [1000.0, 110.0, 981.0, 705.0]`, `"surface_back": [1000.0, None, 422.0, 350.0]` (B2's back score is null on purpose).

- [ ] **Step 2: Write the failing tests**

Append to `training/tests/test_tables.py`:

```python
def test_surface_side_rows_one_row_per_side_with_scores(surface_tables):
    ds, sp = surface_tables
    man = pd.read_parquet(ds / "manifest.parquet")
    rows = tables.surface_side_rows(man, "sfx")
    assert list(rows.columns) == ["cert", "side", "crop_path", "score"]
    assert rows[["cert", "side"]].values.tolist()[:3] == [["A1", "B"], ["A1", "F"], ["B2", "F"]]   # B2/B dropped: null score
    assert rows.crop_path.iloc[1] == "tag-dataset/A1/sfx_front.jpg" and rows.score.iloc[1] == 1000.0
    rgb = tables.surface_side_rows(man, "rgb")
    assert rgb.crop_path.iloc[0] == "tag-dataset/A1/back.jpg" and len(rgb) == 7


def test_surface_tasks_load_through_load_task_table(surface_tables):
    ds, sp = surface_tables
    for task in ("surface_sfx", "surface_rgb"):
        spec = tables.TASKS[task]
        assert spec["input_size"] == (896, 1248) and spec["cache_resize"] == (896, 1248)
        assert spec["long_side_horizontal"] is False and tables.target_names(task) == ["score"]
        df = tables.load_task_table(task, ds, sp, "train")
        assert set(df.cert) == {"A1", "B2"} and len(df) == 3
        assert "grade_label" in df.columns and "split" in df.columns
    with pytest.raises(ValueError):
        tables.load_task_table("surface_sfx", ds, sp, "test")
```

(`test_tables.py` already imports `pandas as pd`, `pytest`, and `tables`; check and add any missing import.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_tables.py`
Expected: FAIL with `AttributeError: module 'trainlib.tables' has no attribute 'surface_side_rows'`

- [ ] **Step 4: Implement**

In `training/trainlib/tables.py`, add before `TASKS`:

```python
_VIEW_PATHS = {"sfx": ("path_sfx_back", "path_sfx_front"), "rgb": ("path_back", "path_front")}


def surface_side_rows(manifest: pd.DataFrame, view: str) -> pd.DataFrame:
    """One row per cert per side for the surface-score task: the whole-card image key of `view`
    and TAG's per-side surface score (0-1000). Sides with no image or no score are dropped."""
    back_col, front_col = _VIEW_PATHS[view]
    parts = []
    for side, col, score_col in (("B", back_col, "surface_back"), ("F", front_col, "surface_front")):
        parts.append(pd.DataFrame({"cert": manifest.cert, "side": side, "crop_path": manifest[col],
                                   "score": manifest[score_col].astype("float64")}))
    rows = pd.concat(parts)
    rows = rows[rows.crop_path.notna() & rows.score.notna()]
    return rows.sort_values(["cert", "side"]).reset_index(drop=True)
```

Add to `TASKS`:

```python
    "surface_sfx": {
        "table": "manifest.parquet",
        "rows": lambda df: surface_side_rows(df, "sfx"),
        "view": "sfx",
        "targets": [Target("score", "regress", "score")],
        "key_cols": ["side"],
        "input_size": (896, 1248),
        "long_side_horizontal": False,
        "cache_resize": (896, 1248),
    },
    "surface_rgb": {
        "table": "manifest.parquet",
        "rows": lambda df: surface_side_rows(df, "rgb"),
        "view": "rgb",
        "targets": [Target("score", "regress", "score")],
        "key_cols": ["side"],
        "input_size": (896, 1248),
        "long_side_horizontal": False,
        "cache_resize": (896, 1248),
    },
```

In `load_task_table`, after `df = pd.read_parquet(Path(dataset_dir) / spec["table"])` add:

```python
    if spec.get("rows") is not None:
        df = spec["rows"](df)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_tables.py`
Expected: all pass (previous cases + 2)

- [ ] **Step 6: Commit**

```bash
git add training/trainlib/tables.py training/tests/conftest.py training/tests/test_tables.py
git commit -m "feat(training): surface-score tasks (per-side score from manifest, whole-card input)"
```

---

### Task 2: Resized cache without rotation, built from the local full-resolution files

**Files:**
- Modify: `training/trainlib/cache.py`, `training/trainlib/cache_cli.py`
- Test: `training/tests/test_cache.py`, `training/tests/test_cache_cli.py` (append)

**Interfaces:**
- Produces: `_resize_and_save(data, dest, size, quality, rotate=True)`; `_fetch(reader, key, dest, resize, quality, rotate=True, local_full: Path | None = None)`; `build_cache(reader, keys, cache_dir, workers=16, progress=None, resize=None, quality=95, rotate=True, local_full=False)`; `cache_cli --from-cache`.

- [ ] **Step 1: Write the failing tests**

Append to `training/tests/test_cache.py` (it already has `FakeReader`, `png_bytes` via conftest and `cache` imported; check names):

```python
def test_resize_without_rotation_keeps_portrait(tmp_path):
    reader = FakeReader({"k/a.jpg": png_bytes(200, 300)})
    counts = cache.build_cache(reader, ["k/a.jpg"], tmp_path, workers=1, resize=(20, 30), rotate=False)
    assert counts["downloaded"] == 1
    with Image.open(cache.resized_path(tmp_path, "k/a.jpg", (20, 30))) as im:
        assert im.size == (20, 30)


def test_resize_from_local_full_res_does_not_touch_the_reader(tmp_path):
    reader = FakeReader({})
    full = cache.cache_path(tmp_path, "k/b.jpg"); full.parent.mkdir(parents=True)
    full.write_bytes(png_bytes(200, 300))
    counts = cache.build_cache(reader, ["k/b.jpg"], tmp_path, workers=1, resize=(20, 30), rotate=False, local_full=True)
    assert counts["downloaded"] == 1 and reader.calls == []
    assert cache.resized_path(tmp_path, "k/b.jpg", (20, 30)).exists()


def test_local_full_falls_back_to_reader_when_missing(tmp_path):
    reader = FakeReader({"k/c.jpg": png_bytes(200, 300)})
    counts = cache.build_cache(reader, ["k/c.jpg"], tmp_path, workers=1, resize=(20, 30), rotate=False, local_full=True)
    assert counts["downloaded"] == 1 and reader.calls == ["k/c.jpg"]
```

Append to `training/tests/test_cache_cli.py` a case that runs `cache_cli.main(["--task", "surface_sfx", "--splits", "train", "--from-cache", "--config", str(cfg)])` against the `surface_tables` fixture with a `FakeReader` monkeypatched into `cache_cli.reader_from_config`, with the four train side images pre-written full-res under `cache_dir`, and asserts the resized files exist at `resized/896x1248/tag-dataset/<cert>/<file>.jpg` and are 896×1248 (use tiny 20×30 source PNGs; the resize upsamples, that is fine), and `reader.calls == []`. Mirror the existing test in that file for how `cfg`/`ds.toml` are written.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_cache.py tests/test_cache_cli.py`
Expected: FAIL with `TypeError: build_cache() got an unexpected keyword argument 'rotate'`

- [ ] **Step 3: Implement**

`cache.py`:

```python
def _resize_and_save(data: bytes, dest: Path, size: tuple[int, int], quality: int, rotate: bool = True) -> None:
    w, h = size
    with Image.open(BytesIO(data)) as im:
        img = im.convert("RGB")
    if rotate and img.height > img.width:
        img = img.transpose(Image.Transpose.ROTATE_90)
    ...  # unchanged from here


def _fetch(reader, key: str, dest: Path, resize: tuple[int, int] | None, quality: int,
           rotate: bool = True, local_full: Path | None = None) -> str:
    if resize is not None:
        if dest.exists() and dest.stat().st_size > 0:
            return "skipped"
    elif dest.exists() and dest.stat().st_size == reader.size(key):
        return "skipped"
    if local_full is not None and local_full.exists() and local_full.stat().st_size > 0:
        data = local_full.read_bytes()
    else:
        data = reader.get(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if resize is not None:
        _resize_and_save(data, dest, resize, quality, rotate)
    else:
        ...  # unchanged


def build_cache(reader, keys, cache_dir, workers=16, progress=None, resize=None, quality=95,
                rotate: bool = True, local_full: bool = False):
    ...
        futures = {ex.submit(_fetch, reader, k, dest_for(k), resize, quality, rotate,
                             cache_path(cache_dir, k) if (local_full and resize) else None): k for k in keys}
```

`cache_cli.py`: add `p.add_argument("--from-cache", action="store_true", help="resize from the full-resolution file already in the cache instead of downloading")`; pass `rotate=TASKS[args.task]["long_side_horizontal"], local_full=args.from_cache` to `build_cache`. Update the module docstring's one-line usage.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q`
Expected: all pass; the edge resized-cache tests still pass (default `rotate=True`).

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/cache.py training/trainlib/cache_cli.py training/tests/test_cache.py training/tests/test_cache_cli.py
git commit -m "feat(training): resized cache without rotation and from local full-res files"
```

---

### Task 3: Dataset check, local smoke, docs, handoff Step 8

**Files:**
- Test: `training/tests/test_data.py` (append one case)
- Modify: `training/README.md`, `training/HANDOFF-rented-gpu.md`

- [ ] **Step 1: Dataset test**

Append to `test_data.py`: build `surface_tables`, take `tables.load_task_table("surface_sfx", ds, sp, "train")`, write resized JPEGs at `cache.resized_path(cache, row.crop_path, (896, 1248))` (portrait 896×1248 gray via `Image.new`), and assert `CropDataset(df, "surface_sfx", cache, train=False)[0]` returns an image tensor of shape `(3, 1248, 896)`, a side tensor of `[0.0]` for side "B", target `[score/1000]`, mask `[1.0]`; and that `filter_cached(df, cache, "surface_sfx")` keeps all rows. Run it (`pytest -q tests/test_data.py`), expect pass without code changes; if `load_crop` mis-orients the image, stop and report.

- [ ] **Step 2: Stats step (baseline)**

Run once locally (CPU, seconds) and record in the README: for the val split, the MAE of predicting each side's score with the train-split median score of its grade (`grade_label`), overall and per grade. Script it inline with pandas from `load_task_table("surface_sfx", ...)` for train and val; this is the number a model must beat.

- [ ] **Step 3: Local smoke (RTX 4070, detached)**

```powershell
cd training
. ..\scripts\tag-dataset\data\env.ps1
.\.venv\Scripts\python.exe -m trainlib.cache_cli --task surface_sfx --splits train:300,val:60 --workers 8
```
(these images are not in the local full-res cache, so no `--from-cache`; 720 downloads, ~2.4 GB). Then the detached run exactly as the README's corner smoke describes, with `-m trainlib.train --task surface_sfx --run-name smoke --epochs 2 --limit-cards 300 --val-limit-cards 60 --batch-size 2 --workers 0`, then `evaluate --task surface_sfx --checkpoint runs/surface_sfx/smoke/best.pt --split val --limit-cards 60 --workers 0 --batch-size 2`. Record seconds per epoch, peak VRAM, `mae_score` per epoch and the `ALL` row. If VRAM overflows at batch 2, report; do not lower the input size.

- [ ] **Step 4: README**

Add a "Surface score (per side)" section: why (link to the diagnosis), the two tasks, the input size and why 896×1248 (0.2× of the 4391×6063 frame; creases/dents survive, hairlines do not), the cache command with `--from-cache`, the baseline table, the smoke row in Results.

- [ ] **Step 5: Handoff Step 8**

Append "Step 8: surface score regressors" with: `git pull` + test count; `cache_cli --task surface_sfx --splits train,val,test --from-cache --workers 32` and the same for `surface_rgb` (111,000 resizes from the local files, no download; ~45 GB at 896×1248 q95; ~30 min each); train `surface_sfx` v1 with the Global Constraints defaults (10 epochs; expect ~40 min/epoch; batch 8; if OOM, batch 4); `evaluate --split val`; acceptance rule from the Global Constraints; test once if accepted; then `surface_rgb` the same way; report both `ALL` rows and the per-grade tables; artifacts stay on the box for the main session.

- [ ] **Step 6: Commit**

```bash
git add training/tests/test_data.py training/README.md training/HANDOFF-rented-gpu.md
git commit -m "docs(training): surface-score smoke, baseline, handoff Step 8"
```

---

## Self-review

**Spec coverage.** Surface subscore for the rollup (§7 Rollup consumes subscores): Tasks 1–3. Serving (§8) unchanged in shape: the inference service will call the per-view model on each side. Box output for creases/scratches stays with the detector (handoff Step 7.10).

**Placeholder scan.** Task 2's `cache_cli` test and Task 3's dataset test are described rather than given verbatim because they mirror existing tests in the same files; the implementer copies those patterns. All other steps carry code.

**Type consistency.** `surface_side_rows` columns match what `CropDataset` needs (`crop_path`, `side`, target column `score`) and what `load_task_table` merges (`cert`). `cache_resize` (896, 1248) matches `input_size` so `load_crop`'s resize is a no-op on cached files. `rotate` defaults to `True` everywhere so corners/edges behaviour is unchanged.
