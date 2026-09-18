# Centering Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Predict TAG's four border distances per card side (left, right, top, bottom: card edge to printed frame) from the color image of that side cropped to the card, robust to small crop errors, so the app gets centering ratios without a user lining anything up.

**Architecture:** Reuse the corner/edge regression stack (`ScoreRegressor`, `train.py`, `evaluate.py`). Three additions: (1) a measurement step that finds the card rectangle inside each TAG color image (the orange trim is one flat color) and writes `training/derived/centering_boxes_rgb.parquet`; (2) a "card" variant of the resized cache that crops to that rectangle before resizing to 896×1248, kept apart from the uncropped surface cache; (3) a `centering_rgb` task whose four targets are the DTE values expressed in thousandths (per-mille) of the card's width or height, plus a train-time edge-jitter augmentation that shifts each crop edge by up to 3% and moves the targets to match, so imperfect user crops are covered.

**Tech Stack:** Python 3.12, torch 2.9.1+cu128, timm, Pillow, numpy, pandas/pyarrow, pytest; existing `trainlib` modules.

**Spec:** `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md` §7 (Centering row: "classic CV on deskewed image, 4 DTE values per side → L/R and T/B ratios; metric MAE in px vs TAG DTE"). This plan replaces the classical detector with a learned one because rule-based border finding fails on holo/textured/dark-art cards; the classical step survives as an optional snap around the prediction (inference service, not this plan).

## Global Constraints

- Python `>=3.12,<3.13`; torch `2.9.1`; tests via `cd training && .venv/Scripts/python -m pytest -q`; all existing tests (118) keep passing; `filterwarnings = ["error"]`.
- Never `git add` `scripts/tag-dataset/tagdataset/cli.py` or `download.py`; never `.pt`/`.joblib`; never `git stash`. Commit only the files each task names. Nothing is written under `dataset_dir`; derived tables go to `training/derived/` (tracked in git; the boxes parquet is ~1 MB).
- Card-box detection (exact): on the RGB array `a`, orange mask = `(R > 150) & (60 < G < 190) & (B < 110) & (R - B > 80)`; column fraction = mean of the mask over rows, row fraction = mean over columns; a margin is the count of leading (resp. trailing) columns/rows whose fraction is `> 0.6`; the card box is `(x0=left, y0=top, x1=W-right, y1=H-bottom)`; `ok = all(20 <= m <= 200 for m in margins) and x1 - x0 >= 0.8 * W and y1 - y0 >= 0.8 * H`. Not-ok images get the box `(0, 0, W, H)` and `ok=False` and are excluded from training rows.
- Boxes table columns: `cert, side ("F"/"B"), image_key, W, H, x0, y0, x1, y1, ok`.
- Targets: per side, `dte_l, dte_r, dte_t, dte_b` = `dte_<side>_left / (x1 - x0) * 1000`, `... right / (x1 - x0) * 1000`, `... top / (y1 - y0) * 1000`, `... bottom / (y1 - y0) * 1000` as float64, clipped to `[0, 1000]`; rows with any null DTE or `ok == False` are dropped. `SCALE` (1000) in `data.py` is unchanged, so the loss sees fractions and `mae_<name>` is reported in per-mille of the card dimension (≈ 4.3 px per unit on a 4,300-px card).
- Task spec (exact): `TASKS["centering_rgb"] = {"table": "manifest.parquet", "rows": centering_rows (reads the boxes parquet at `derived/centering_boxes_rgb.parquet` relative to `training/`), "view": "rgb", "targets": [Target("dte_l","regress","dte_l"), Target("dte_r","regress","dte_r"), Target("dte_t","regress","dte_t"), Target("dte_b","regress","dte_b")], "key_cols": ["side"], "input_size": (896, 1248), "long_side_horizontal": False, "cache_resize": (896, 1248), "cache_variant": "card", "crop_boxes": "derived/centering_boxes_rgb.parquet", "edge_jitter": 0.03}`.
- Cache variant: `resized_path(cache_dir, key, size, variant=None)` → `cache_dir/resized/<w>x<h>[-<variant>]/<key>.jpg`; `_resize_and_save(..., crop_box=None)` crops before resizing; `build_cache(..., crops: dict[str, tuple] | None = None)`; `cache_cli` loads `TASKS[task]["crop_boxes"]` when present and passes `{image_key: (x0, y0, x1, y1)}` for ok rows only; `CropDataset._resolve_path` and `tables.filter_cached` use the task's variant. Corners/edges/surface tasks have no variant and are byte-for-byte unchanged.
- Edge jitter (train only, tasks with `edge_jitter = j > 0`): per item draw `dl, dr, dt, db ~ U(-j, +j)` (fractions of the current image width for l/r, height for t/b); build the new image by cropping the box `(-dl*W, -dt*H, W + dr*W, H + db*H)` (a negative delta cuts into the card, a positive one pads) with padding filled by a single random RGB color; resize back to `input_size`; targets change as `dte_l' = (dte_l/1000 * W + dl*W) / (W + dl*W + dr*W) * 1000`, `dte_r' = (dte_r/1000 * W + dr*W) / (W + dl*W + dr*W) * 1000`, and the same for t/b with H, dt, db; then clip to `[0, 1000]`. Photometric jitter (brightness/contrast ±10%) still applies; the `strong` window crop is never applied to a jitter task (the loader forces the `light` photometric path). No flips (`long_side_horizontal` is False).
- Training defaults for the full run: `--epochs 10 --batch-size 8 --workers 8 --drop-path 0.1 --ema-decay 0.999 --aug light`. Local smoke: `--limit-cards 300 --val-limit-cards 60 --epochs 2 --batch-size 2 --workers 0`, detached.
- Acceptance for v1 (val `ALL` row): mean of the four `mae_dte_*` ≤ 4.0 per-mille (≈ 17 px) AND ≤ 50% of the median-predictor baseline measured in Task 4. Test split read once per accepted model.

---

## File structure

| File | Responsibility |
|---|---|
| `training/trainlib/centering_prep.py` | detect the card box in an image; CLI that writes `derived/centering_boxes_rgb.parquet` from the local full-res cache |
| `training/trainlib/cache.py`, `cache_cli.py` | variant path, crop-before-resize, crops map |
| `training/trainlib/tables.py` | `centering_rows`, `TASKS["centering_rgb"]`, variant-aware `filter_cached` |
| `training/trainlib/data.py` | `jitter_edges`, variant-aware path resolution, jitter in `__getitem__` |
| `training/tests/test_centering_prep.py`, `test_cache.py`, `test_cache_cli.py`, `test_tables.py`, `test_data.py` | tests |
| `training/tests/conftest.py` | `make_surface_tables` manifest gains the 8 DTE columns + `image_w/h`; a `make_boxes_table` helper |
| `training/README.md`, `training/HANDOFF-rented-gpu.md` | centering section; handoff Step 9 |

---

### Task 1: Card-box detection and the boxes table

**Files:**
- Create: `training/trainlib/centering_prep.py`
- Test: `training/tests/test_centering_prep.py`
- Modify: `training/tests/conftest.py` (append `orange_card_png` helper)

**Interfaces:**
- Produces: `detect_card_box(img: PIL.Image) -> tuple[tuple[int, int, int, int], bool]` (box, ok); `measure_boxes(cache_dir, sides: pd.DataFrame, workers=16) -> pd.DataFrame` with the Global Constraints columns, one row per `sides` row whose image exists locally (missing images are skipped and counted in `df.attrs["missing"]`); CLI `python -m trainlib.centering_prep --view rgb --splits train,val,test [--limit-cards N] [--workers 16] [--out derived/centering_boxes_rgb.parquet]` which builds `sides` from `surface_tables.load_surface_split` (both sides, `view == "rgb"` rows only), measures, and writes the parquet (creating `derived/`).

- [ ] **Step 1: Fixture helper**

Append to `training/tests/conftest.py`:

```python
def orange_card_png(w: int, h: int, margin: int = 50, card_value: int = 120) -> bytes:
    """A TAG-style color image: flat orange trim `margin` px wide around a gray card."""
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = 235, 120, 40          # orange
    arr[margin:h - margin, margin:w - margin] = card_value
    buf = io.BytesIO(); Image.fromarray(arr).save(buf, format="PNG"); return buf.getvalue()
```

- [ ] **Step 2: Write the failing tests**

`training/tests/test_centering_prep.py`:

```python
import io

import numpy as np
import pandas as pd
from PIL import Image

from conftest import orange_card_png
from trainlib import cache, centering_prep as cp
from trainlib import surface_tables as st


def test_detect_card_box_finds_the_orange_margins():
    img = Image.open(io.BytesIO(orange_card_png(400, 600, margin=50)))
    box, ok = cp.detect_card_box(img)
    assert ok and box == (50, 50, 350, 550)


def test_detect_card_box_rejects_missing_or_huge_margins():
    plain = Image.fromarray(np.full((600, 400, 3), 120, dtype=np.uint8))
    box, ok = cp.detect_card_box(plain)
    assert not ok and box == (0, 0, 400, 600)
    big = Image.open(io.BytesIO(orange_card_png(400, 600, margin=250)))
    assert cp.detect_card_box(big)[1] is False


def test_measure_boxes_writes_one_row_per_cached_side(surface_tables, tmp_path):
    ds, sp = surface_tables
    cache_dir = tmp_path / "cache"
    sides, _ = st.load_surface_split(ds, sp, "train")
    sides = sides[sides.view == "rgb"].reset_index(drop=True)
    for key in sides.image_key.iloc[:3]:                       # leave the 4th image missing
        p = cache.cache_path(cache_dir, key); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(orange_card_png(400, 600, margin=40))
    df = cp.measure_boxes(cache_dir, sides, workers=1)
    assert list(df.columns) == ["cert", "side", "image_key", "W", "H", "x0", "y0", "x1", "y1", "ok"]
    assert len(df) == 3 and df.attrs["missing"] == 1
    assert df.ok.all() and (df.x0 == 40).all() and (df.x1 == 360).all() and (df.H == 600).all()


def test_cli_writes_parquet(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\n[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    sides, _ = st.load_surface_split(ds, sp, "train")
    for key in sides[sides.view == "rgb"].image_key:
        p = cache.cache_path(tmp_path / "cache", key); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(orange_card_png(400, 600))
    out = tmp_path / "derived" / "boxes.parquet"
    cp.main(["--config", str(cfg), "--view", "rgb", "--splits", "train", "--workers", "1", "--out", str(out)])
    df = pd.read_parquet(out)
    assert len(df) == 4 and df.ok.all()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_centering_prep.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'trainlib.centering_prep'`

- [ ] **Step 4: Implement**

`training/trainlib/centering_prep.py`:

```python
"""Find the card rectangle inside TAG's color images (flat orange trim) and write the boxes table."""
from __future__ import annotations

import argparse
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from .cache import cache_path
from .config import load_config
from .surface_tables import load_surface_split

BOX_COLUMNS = ["cert", "side", "image_key", "W", "H", "x0", "y0", "x1", "y1", "ok"]
MARGIN_MIN, MARGIN_MAX, FRACTION = 20, 200, 0.6


def _leading(frac: np.ndarray) -> int:
    n = 0
    while n < len(frac) and frac[n] > FRACTION:
        n += 1
    return n


def detect_card_box(img: Image.Image) -> tuple[tuple[int, int, int, int], bool]:
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    orange = (r > 150) & (g > 60) & (g < 190) & (b < 110) & ((r - b) > 80)
    col, row = orange.mean(axis=0), orange.mean(axis=1)
    left, right = _leading(col), _leading(col[::-1])
    top, bottom = _leading(row), _leading(row[::-1])
    H, W = orange.shape
    box = (left, top, W - right, H - bottom)
    ok = all(MARGIN_MIN <= m <= MARGIN_MAX for m in (left, right, top, bottom)) \
        and (box[2] - box[0]) >= 0.8 * W and (box[3] - box[1]) >= 0.8 * H
    return (box if ok else (0, 0, W, H)), ok


def _measure_one(args) -> dict | None:
    path, cert, side, key = args
    try:
        with Image.open(path) as im:
            (x0, y0, x1, y1), ok = detect_card_box(im)
            W, H = im.size
    except (OSError, ValueError) as e:
        print(f"centering_prep: failed {path}: {e}")
        return None
    return {"cert": cert, "side": side, "image_key": key, "W": W, "H": H, "x0": x0, "y0": y0, "x1": x1, "y1": y1, "ok": bool(ok)}


def measure_boxes(cache_dir: Path, sides: pd.DataFrame, workers: int = 16, progress=None) -> pd.DataFrame:
    jobs, missing = [], 0
    for r in sides.itertuples():
        p = cache_path(cache_dir, r.image_key)
        if p.exists():
            jobs.append((str(p), r.cert, r.side, r.image_key))
        else:
            missing += 1
    rows = []
    if workers <= 1:
        for j in jobs:
            out = _measure_one(j)
            if out: rows.append(out)
            if progress: progress(len(rows))
    else:
        with Pool(workers) as pool:
            for out in pool.imap_unordered(_measure_one, jobs, chunksize=8):
                if out: rows.append(out)
                if progress: progress(len(rows))
    df = pd.DataFrame(rows, columns=BOX_COLUMNS).sort_values(["cert", "side"]).reset_index(drop=True)
    df.attrs["missing"] = missing
    return df


def main(argv=None) -> Path:
    p = argparse.ArgumentParser(prog="centering_prep")
    p.add_argument("--config", default="config.toml"); p.add_argument("--view", choices=["rgb", "sfx"], default="rgb")
    p.add_argument("--splits", default="train,val,test"); p.add_argument("--limit-cards", type=int)
    p.add_argument("--workers", type=int, default=16); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out", default=None, help="default derived/centering_boxes_<view>.parquet next to config.toml")
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    out = Path(args.out) if args.out else Path(args.config).resolve().parent / "derived" / f"centering_boxes_{args.view}.parquet"
    parts = []
    for split in args.splits.split(","):
        s, _ = load_surface_split(cfg.dataset_dir, cfg.splits_path, split.strip(), args.limit_cards, args.seed,
                                  allow_test=(split.strip() == "test"))
        parts.append(s[s.view == args.view])
    sides = pd.concat(parts).reset_index(drop=True)
    t0 = time.time()
    df = measure_boxes(cfg.cache_dir, sides, args.workers,
                       progress=lambda n: print(f"  {n} measured", flush=True) if n % 5000 == 0 else None)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    print(f"{len(df)} boxes ({int(df.ok.sum())} ok, {int((~df.ok).sum())} not ok, {df.attrs['missing']} images missing) "
          f"→ {out} in {time.time() - t0:.0f}s")
    return out


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_centering_prep.py`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add training/trainlib/centering_prep.py training/tests/test_centering_prep.py training/tests/conftest.py
git commit -m "feat(training): card-box detection in TAG color images and the centering boxes table"
```

---

### Task 2: Cache variant with crop-before-resize

**Files:**
- Modify: `training/trainlib/cache.py`, `training/trainlib/cache_cli.py`, `training/trainlib/tables.py` (`filter_cached` only), `training/trainlib/data.py` (`_resolve_path` only)
- Test: `training/tests/test_cache.py`, `training/tests/test_cache_cli.py` (append)

**Interfaces:**
- Produces: `resized_path(cache_dir, key, size, variant=None)`; `_resize_and_save(data, dest, size, quality, rotate=True, crop_box=None)`; `_fetch(..., crop_box=None)`; `build_cache(..., variant=None, crops=None)` where `crops` maps `key → (x0, y0, x1, y1)`; `cache_cli` passes `variant=TASKS[task].get("cache_variant")` and, when `TASKS[task].get("crop_boxes")` is set, loads that parquet (path relative to the directory of `--config`), keeps `ok` rows, and passes `crops={image_key: (x0, y0, x1, y1)}`; `filter_cached(df, cache_dir, task)` and `CropDataset._resolve_path` look for the resized file under the task's variant.

- [ ] **Step 1: Write the failing tests**

Append to `training/tests/test_cache.py`:

```python
def test_resized_path_variant():
    assert cache.resized_path(Path("c"), "k/a.jpg", (20, 30)) == Path("c") / "resized" / "20x30" / "k" / "a.jpg"
    assert cache.resized_path(Path("c"), "k/a.jpg", (20, 30), "card") == Path("c") / "resized" / "20x30-card" / "k" / "a.jpg"


def test_build_cache_crops_before_resizing(tmp_path):
    reader = FakeReader({"k/a.png": orange_card_png(400, 600, margin=50)})
    counts = cache.build_cache(reader, ["k/a.png"], tmp_path, workers=1, resize=(30, 50), rotate=False,
                               variant="card", crops={"k/a.png": (50, 50, 350, 550)})
    assert counts["downloaded"] == 1
    dest = cache.resized_path(tmp_path, "k/a.png", (30, 50), "card")
    with Image.open(dest) as im:
        arr = np.asarray(im.convert("RGB"))
    assert im.size == (30, 50)
    assert arr[..., 0].max() < 200          # no orange survived the crop
```

(`orange_card_png` comes from conftest; `np`, `Path`, `Image` may need importing in that test file.)

Append to `training/tests/test_cache_cli.py` a test that: writes a boxes parquet at `<tmp>/derived/centering_boxes_rgb.parquet` with rows for the four train rgb sides of the `surface_tables` fixture (boxes `(50, 50, 350, 550)`, `ok=True`, one of them `ok=False`), pre-writes the full-res orange PNGs (400×600) under the cache, monkeypatches `cache_cli.TASKS` with a temporary task `{"table": "manifest.parquet", "rows": ..., ...}`? — No: use the real `centering_rgb` task from Task 3. **Defer this CLI test to Task 3 Step 2**, which adds the task; Task 2 tests the library path only.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_cache.py`
Expected: FAIL with `TypeError: resized_path() takes 3 positional arguments but 4 were given`

- [ ] **Step 3: Implement**

`cache.py`:

```python
def resized_path(cache_dir: Path, key: str, size: tuple[int, int], variant: str | None = None) -> Path:
    w, h = size
    folder = f"{w}x{h}" + (f"-{variant}" if variant else "")
    return Path(cache_dir) / "resized" / folder / Path(key).with_suffix(".jpg")


def _resize_and_save(data, dest, size, quality, rotate=True, crop_box=None):
    w, h = size
    with Image.open(BytesIO(data)) as im:
        img = im.convert("RGB")
    if crop_box is not None:
        img = img.crop(tuple(int(v) for v in crop_box))
    if rotate and img.height > img.width:
        img = img.transpose(Image.Transpose.ROTATE_90)
    ...  # unchanged


def _fetch(reader, key, dest, resize, quality, rotate=True, local_full=None, crop_box=None):
    ...  # pass crop_box into _resize_and_save


def build_cache(reader, keys, cache_dir, workers=16, progress=None, resize=None, quality=95,
                rotate=True, local_full=False, variant=None, crops=None):
    dest_for = (lambda k: resized_path(cache_dir, k, resize, variant)) if resize else (lambda k: cache_path(cache_dir, k))
    crops = crops or {}
    ...  # submit with crop_box=crops.get(k)
```

`cache_cli.py`: after computing `keys`, if `TASKS[args.task].get("crop_boxes")`: `boxes = pd.read_parquet(Path(args.config).resolve().parent / TASKS[args.task]["crop_boxes"])`; `crops = {r.image_key: (r.x0, r.y0, r.x1, r.y1) for r in boxes[boxes.ok].itertuples()}`; keys not in `crops` are dropped with a printed count (`skipped N keys with no ok card box`); pass `variant=TASKS[args.task].get("cache_variant"), crops=crops`. The printed `out_dir` includes the variant suffix.

`tables.filter_cached`: where it checks `resized_path(cache_dir, key, resize)`, pass `spec.get("cache_variant")`. `data.CropDataset._resolve_path`: same.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q`
Expected: all pass (118 + 2); the edge/surface resized tests still pass with `variant=None`.

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/cache.py training/trainlib/cache_cli.py training/trainlib/tables.py training/trainlib/data.py training/tests/test_cache.py
git commit -m "feat(training): resized-cache variants with crop-before-resize"
```

---

### Task 3: Centering task, rows, and edge-jitter augmentation

**Files:**
- Modify: `training/trainlib/tables.py` (rows + TASKS entry), `training/trainlib/data.py` (`jitter_edges`, `__getitem__`), `training/tests/conftest.py` (manifest DTE columns + `make_boxes_table`)
- Test: `training/tests/test_tables.py`, `training/tests/test_data.py`, `training/tests/test_cache_cli.py` (append)

**Interfaces:**
- Produces: `centering_rows(manifest, boxes) -> DataFrame` with columns `cert, side, crop_path, dte_l, dte_r, dte_t, dte_b`; `TASKS["centering_rgb"]` per the Global Constraints, whose `rows` callable reads the boxes parquet from `Path(__file__).resolve().parents[1] / "derived" / "centering_boxes_rgb.parquet"` unless `TRAINLIB_BOXES` env var overrides the path (tests set it); `data.jitter_edges(img, targets_pm: list[float], rng, j) -> (img, targets_pm)`; `CropDataset.__getitem__` applies it when `train` and `spec.get("edge_jitter", 0) > 0`, using the raw resized image (no `strong` window) and then the light photometric jitter.

- [ ] **Step 1: Fixtures**

In `make_surface_tables`, add manifest columns: `"image_w": [4400, 4400, 4400, 4400]`, `"image_h": [6100]*4`, `"dte_front_left": [180.0, 200.0, None, 190.0]`, `"dte_front_right": [160.0, 210.0, 170.0, 190.0]`, `"dte_front_top": [185.0, 250.0, 175.0, 200.0]`, `"dte_front_bottom": [165.0, 240.0, 180.0, 200.0]`, `"dte_back_left": [175.0, 205.0, 172.0, 195.0]`, `"dte_back_right": [170.0, 200.0, 168.0, 195.0]`, `"dte_back_top": [190.0, 245.0, 178.0, 205.0]`, `"dte_back_bottom": [170.0, 235.0, 182.0, 205.0]`. Add helper:

```python
def make_boxes_table(tmp_path: Path, sides: pd.DataFrame, box=(50, 50, 4350, 6050), W=4400, H=6100, not_ok=()) -> Path:
    rows = [{"cert": r.cert, "side": r.side, "image_key": r.image_key, "W": W, "H": H,
             "x0": box[0], "y0": box[1], "x1": box[2], "y1": box[3], "ok": (r.cert, r.side) not in set(not_ok)}
            for r in sides.itertuples()]
    p = tmp_path / "derived" / "centering_boxes_rgb.parquet"; p.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_parquet(p, index=False); return p
```

- [ ] **Step 2: Write the failing tests**

Append to `test_tables.py`:

```python
def test_centering_rows_per_mille_of_card_dims(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    man = pd.read_parquet(ds / "manifest.parquet")
    sides, _ = st.load_surface_split(ds, sp, "train")
    boxes_path = make_boxes_table(tmp_path, sides[sides.view == "rgb"], not_ok=[("B2", "B")])
    rows = tables.centering_rows(man, pd.read_parquet(boxes_path))
    assert list(rows.columns) == ["cert", "side", "crop_path", "dte_l", "dte_r", "dte_t", "dte_b"]
    a1f = rows[(rows.cert == "A1") & (rows.side == "F")].iloc[0]
    assert abs(a1f.dte_l - 180 / 4300 * 1000) < 1e-9 and abs(a1f.dte_t - 185 / 6000 * 1000) < 1e-9
    assert a1f.crop_path == "tag-dataset/A1/front.jpg"
    assert not ((rows.cert == "B2") & (rows.side == "B")).any()          # not-ok box dropped
    monkeypatch.setenv("TRAINLIB_BOXES", str(boxes_path))
    df = tables.load_task_table("centering_rgb", ds, sp, "train")
    assert len(df) == 3 and tables.target_names("centering_rgb") == ["dte_l", "dte_r", "dte_t", "dte_b"]
    spec = tables.TASKS["centering_rgb"]
    assert spec["cache_variant"] == "card" and spec["edge_jitter"] == 0.03 and spec["crop_boxes"] == "derived/centering_boxes_rgb.parquet"
```

(add `from conftest import make_boxes_table` and `from trainlib import surface_tables as st` at the top; extend the `test_tasks_spec` key set with `"centering_rgb"`.)

Append to `test_data.py`:

```python
def _border_image(w=200, h=300, l=20, r=30, t=25, b=35):
    arr = np.full((h, w, 3), 200, dtype=np.uint8)
    arr[t:h - b, l:w - r] = 60                      # printed frame region darker than the border
    return Image.fromarray(arr)


def test_jitter_edges_moves_targets_with_the_crop():
    img = _border_image()
    pm = [20 / 200 * 1000, 30 / 200 * 1000, 25 / 300 * 1000, 35 / 300 * 1000]
    out, pm2 = data.jitter_edges(img, pm, np.random.default_rng(0), j=0.05)
    assert out.size == img.size
    # locate the dark frame in the jittered image and compare with the predicted per-mille targets
    a = np.asarray(out.convert("L")); dark = a < 120
    cols = np.where(dark.any(axis=0))[0]; rows_ = np.where(dark.any(axis=1))[0]
    l_px, r_px = cols[0], out.width - 1 - cols[-1]
    t_px, b_px = rows_[0], out.height - 1 - rows_[-1]
    for got, exp in ((l_px, pm2[0] / 1000 * out.width), (r_px, pm2[1] / 1000 * out.width),
                     (t_px, pm2[2] / 1000 * out.height), (b_px, pm2[3] / 1000 * out.height)):
        assert abs(got - exp) <= 2.0
    assert pm2 != pm


def test_jitter_edges_zero_is_identity():
    img = _border_image(); pm = [100.0, 150.0, 83.3, 116.7]
    out, pm2 = data.jitter_edges(img, pm, np.random.default_rng(1), j=0.0)
    assert out.size == img.size and pm2 == pm


def test_centering_dataset_applies_jitter_in_train_only(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    sides, _ = st.load_surface_split(ds, sp, "train")
    boxes_path = make_boxes_table(tmp_path, sides[sides.view == "rgb"])
    monkeypatch.setenv("TRAINLIB_BOXES", str(boxes_path))
    df = tables_mod.load_task_table("centering_rgb", ds, sp, "train")
    cache = tmp_path / "cache"
    for p in df.crop_path:
        dest = cache_mod.resized_path(cache, p, (896, 1248), "card"); dest.parent.mkdir(parents=True, exist_ok=True)
        _border_image(896, 1248, 40, 60, 50, 70).save(dest, format="JPEG", quality=95)
    ev = data.CropDataset(df, "centering_rgb", cache, train=False)
    img, side, target, mask = ev[0]
    assert img.shape == (3, 1248, 896) and mask.tolist() == [1.0] * 4
    assert torch.allclose(target, torch.tensor([df.dte_l[0], df.dte_r[0], df.dte_t[0], df.dte_b[0]]) / 1000)
    tr = data.CropDataset(df, "centering_rgb", cache, train=True); tr.rng = np.random.default_rng(3)
    img2, _, target2, _ = tr[0]
    assert img2.shape == img.shape and not torch.allclose(target2, target)
    assert tables_mod.filter_cached(df, cache, "centering_rgb")[1] == 0
```

(`test_data.py` imports: ensure `cache as cache_mod`, `tables as tables_mod`, `surface_tables as st`, `make_boxes_table`, `torch`, `np`, `Image` are available; match the file's existing import aliases.)

Append to `test_cache_cli.py`:

```python
def test_cache_cli_centering_uses_card_boxes_and_variant(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    cfg = _write_config(tmp_path, ds, sp)
    sides, _ = st.load_surface_split(ds, sp, "train")
    rgb = sides[sides.view == "rgb"]
    make_boxes_table(tmp_path, rgb, box=(50, 50, 350, 550), W=400, H=600, not_ok=[("B2", "B")])
    monkeypatch.setenv("TRAINLIB_BOXES", str(tmp_path / "derived" / "centering_boxes_rgb.parquet"))
    for key in rgb.image_key:
        p = cache.cache_path(tmp_path / "cache", key); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(orange_card_png(400, 600, margin=50))
    monkeypatch.setattr(cache_cli, "reader_from_config", lambda cfg: FakeReader({}))
    cache_cli.main(["--config", str(cfg), "--task", "centering_rgb", "--splits", "train", "--from-cache", "--workers", "1"])
    done = [k for k in rgb.image_key if cache.resized_path(tmp_path / "cache", k, (896, 1248), "card").exists()]
    assert len(done) == 3                                       # the not-ok side is skipped
    with Image.open(cache.resized_path(tmp_path / "cache", done[0], (896, 1248), "card")) as im:
        assert im.size == (896, 1248) and np.asarray(im.convert("RGB"))[..., 0].max() < 200
```

Note for the implementer: `cache_cli` resolves `crop_boxes` relative to the config's directory; with `TRAINLIB_BOXES` set, prefer that path (the same override the rows builder honours) so tests and the box agree. Implement: `boxes_path = Path(os.environ.get("TRAINLIB_BOXES") or (Path(args.config).resolve().parent / spec["crop_boxes"]))`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_tables.py tests/test_data.py tests/test_cache_cli.py`
Expected: FAIL with `AttributeError ... centering_rows` / `jitter_edges` / `KeyError: 'centering_rgb'`

- [ ] **Step 4: Implement**

`tables.py`:

```python
import os

_DTE = {"F": ("dte_front_left", "dte_front_right", "dte_front_top", "dte_front_bottom"),
        "B": ("dte_back_left", "dte_back_right", "dte_back_top", "dte_back_bottom")}


def centering_rows(manifest: pd.DataFrame, boxes: pd.DataFrame) -> pd.DataFrame:
    """One row per cert per side: the color image key and TAG's four border distances expressed in
    per-mille of the card's width (left/right) or height (top/bottom), the card rectangle coming from
    the measured boxes table. Sides with a bad box or any missing distance are dropped."""
    parts = []
    for side, cols in _DTE.items():
        b = boxes[(boxes.side == side) & boxes.ok][["cert", "image_key", "x0", "y0", "x1", "y1"]]
        m = manifest[["cert", *cols]].merge(b, on="cert", how="inner")
        cw, ch = (m.x1 - m.x0).astype("float64"), (m.y1 - m.y0).astype("float64")
        parts.append(pd.DataFrame({"cert": m.cert, "side": side, "crop_path": m.image_key,
                                   "dte_l": m[cols[0]] / cw * 1000, "dte_r": m[cols[1]] / cw * 1000,
                                   "dte_t": m[cols[2]] / ch * 1000, "dte_b": m[cols[3]] / ch * 1000}))
    rows = pd.concat(parts)
    rows = rows.dropna(subset=["dte_l", "dte_r", "dte_t", "dte_b"])
    for c in ("dte_l", "dte_r", "dte_t", "dte_b"):
        rows[c] = rows[c].astype("float64").clip(0.0, 1000.0)
    return rows.sort_values(["cert", "side"]).reset_index(drop=True)


def _centering_boxes_path() -> Path:
    return Path(os.environ.get("TRAINLIB_BOXES") or (Path(__file__).resolve().parents[1] / "derived" / "centering_boxes_rgb.parquet"))


def _centering_rows_from_manifest(df: pd.DataFrame) -> pd.DataFrame:
    return centering_rows(df, pd.read_parquet(_centering_boxes_path()))
```

and the `TASKS["centering_rgb"]` entry per the Global Constraints (`"rows": _centering_rows_from_manifest`).

`data.py`:

```python
def jitter_edges(img: Image.Image, targets_pm: list[float], rng: np.random.Generator, j: float):
    """Shift each crop edge by up to ±j of the image size (negative cuts into the card, positive pads
    with a random flat color), resize back, and move the per-mille border targets to match."""
    if j <= 0:
        return img, list(targets_pm)
    W, H = img.size
    dl, dr, dt, db = (float(rng.uniform(-j, j)) for _ in range(4))
    pl, pr, pt, pb = dl * W, dr * W, dt * H, db * H
    box = (int(round(-pl)), int(round(-pt)), int(round(W + pr)), int(round(H + pb)))
    fill = tuple(int(v) for v in rng.integers(0, 256, size=3))
    canvas = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), fill)
    canvas.paste(img, (-box[0], -box[1]))
    out = canvas.resize((W, H), Image.Resampling.BILINEAR)
    nW, nH = box[2] - box[0], box[3] - box[1]
    l, r, t, b = targets_pm
    new = [(l / 1000 * W - box[0]) / nW * 1000, (r / 1000 * W + (box[2] - W)) / nW * 1000,
           (t / 1000 * H - box[1]) / nH * 1000, (b / 1000 * H + (box[3] - H)) / nH * 1000]
    return out, [min(max(v, 0.0), 1000.0) for v in new]
```

(Use the integer box for the target math, as written, so the pixel paste and the targets agree exactly.) In `CropDataset.__getitem__`: if `self.train and TASKS[self.task].get("edge_jitter", 0) > 0`: open the resolved path, convert RGB, resize to `input_size` (no rotation), call `jitter_edges` with the row's four targets (in per-mille, as stored), apply brightness/contrast ±10% with the dataset rng, normalize with MEAN/STD, and build `target`/`mask` from the jittered values (mask 1.0 for all four; rows never carry NaN here because `centering_rows` drops them). Otherwise the existing path. Keep `load_crop` unchanged for other tasks.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q`
Expected: all pass (previous + 5)

- [ ] **Step 6: Commit**

```bash
git add training/trainlib/tables.py training/trainlib/data.py training/tests/conftest.py training/tests/test_tables.py training/tests/test_data.py training/tests/test_cache_cli.py
git commit -m "feat(training): centering task (per-mille border targets) with edge-jitter augmentation"
```

---

### Task 4: Boxes table, local smoke, docs, handoff Step 9

**Files:**
- Create: `training/derived/centering_boxes_rgb.parquet` (measured on the box, copied home, committed; ~1 MB)
- Modify: `training/README.md`, `training/HANDOFF-rented-gpu.md`, `.gitignore` (ensure `training/derived/` is NOT ignored)

Run-and-record. The boxes table must be measured on the box (all 55,498 color images are there; the local PC has ~700). The local smoke uses a 300-card subset of that table.

- [ ] **Step 1: Measure the boxes on the box** (over SSH from the main session, or by the GPU operator): `cd /workspace/SlabSense && git pull && cd training && .venv/bin/python -m trainlib.centering_prep --view rgb --splits train,val,test --workers 32` → `derived/centering_boxes_rgb.parquet`. Record the counts (ok / not ok / missing). If more than 2% are not ok, sample 10 not-ok images, look at them, and report before proceeding (the detection thresholds may need widening). Copy the parquet to the PC (`scp`) and commit it.
- [ ] **Step 2: Baseline** (CPU, pandas): for `centering_rgb` train/val via `load_task_table`, the val MAE per target of predicting the train median (per side), in per-mille and converted to pixels (× card width or height / 1000, using the boxes table). Record.
- [ ] **Step 3: Local smoke**: `cache_cli --task centering_rgb --splits train:300,val:60 --workers 8` (downloads 720 color images; the crop map comes from the committed parquet), then the detached run with `--aug light` and the smoke settings, then `evaluate --split val --limit-cards 60`. Record s/epoch, peak VRAM, per-target MAE.
- [ ] **Step 4: README**: "Centering" section: what the targets are and why per-mille, the orange-trim measurement and its ok-rate, the card cache variant, the jitter augmentation and why, baseline table, smoke Results row.
- [ ] **Step 5: Handoff Step 9**: `git pull` + test count; the boxes step (if not already run in Step 1); `cache_cli --task centering_rgb --splits train,val,test --from-cache --workers $W` (crop + resize from local files; ~55k images; ~35 GB); train `--task centering_rgb --run-name v1 --epochs 10 --batch-size 8 --workers 8 --drop-path 0.1 --ema-decay 0.999 --aug light`; `evaluate --split val --batch-size 16`; acceptance per the Global Constraints (mean MAE ≤ 4.0 per-mille and ≤ 50% of baseline); test once if accepted; report the per-grade table; budget (~30 min cache, ~25–45 min/epoch → 5–8 h, ≈ $8).
- [ ] **Step 6: Commit** `training/derived/centering_boxes_rgb.parquet`, `training/README.md`, `training/HANDOFF-rented-gpu.md` (and `.gitignore` if touched): `docs(training): centering boxes table, smoke, baseline, handoff Step 9`.

---

## Self-review

**Spec coverage.** §7 Centering: 4 DTE values per side (targets), L/R and T/B ratios derivable from them, MAE vs TAG DTE (per-mille → px). The classical snap is deferred to inference as stated.

**Placeholder scan.** Task 2's CLI test is explicitly deferred to Task 3 (it needs the task entry); Task 4 is run-and-record. All code steps carry code.

**Type consistency.** Boxes columns (Task 1) are consumed by `centering_rows` (Task 3) and `cache_cli` (Task 2/3) by name; `resized_path(..., variant)` signature is used identically in `cache.py`, `tables.filter_cached`, `data._resolve_path`, and the tests; targets are per-mille floats in the rows and `/ SCALE` in the dataset, so `mae_dte_*` is in per-mille everywhere.
