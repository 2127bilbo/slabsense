# Surface Defect Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Train a detector that finds surface defects (creases, dents, pits, print defects, scratches, stains, tears) as boxes with a class on TAG's raking-light surface images, plus a small model that turns each box into a TAG deduction, and evaluate both per class and per grade.

**Architecture:** The 4391×6063 raking-light images (`sfx_front.jpg`, `sfx_back.jpg`) are cut into 1024×1024 tiles at native resolution (median defect is 30–400 px; downscaling the whole card to 1280 would shrink pits to 2 px). Tiles that contain a marker box, plus one random empty tile per clean side, form the training set (~58k tiles). A torchvision Faster R-CNN ResNet50-FPN v2 (COCO-pretrained, BSD license) is fine-tuned on those tiles with small anchors. Deductions are predicted by a gradient-boosted regressor from the box's class and geometry, trained on TAG's own markers. Evaluation reports AP50 per class, precision/recall at a 0.5 score, per-grade rows, and a full-card pass that merges tile predictions.

**Tech Stack:** Python 3.12, torch 2.9.1+cu128, torchvision 0.24.1, Pillow, pandas/pyarrow, scikit-learn (new dependency, for the deduction regressor), pytest. Reuses `trainlib.cache`, `trainlib.config`, `trainlib.r2`.

**Spec:** `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md` §7 ("Surface" row) and §8. Deviations from the spec, each ruled on here because the data measured on 2026-09-16 requires it:
1. **Detector framework**: torchvision Faster R-CNN v2 instead of Ultralytics YOLOv8-m. Ultralytics is AGPL-3.0 and would require a commercial license for SlabSense; torchvision is BSD.
2. **Input**: native-resolution 1024 tiles instead of "1280 long side". Median box widths per class run from 11 px (pits) to 580 px; at 1280 long side (0.29×) a median pit is 3 px and a median scratch 46 px. Tiles keep every pixel.
3. **Deduction**: a separate gradient-boosted regressor on class + geometry instead of a regression head on the detector. Within-class correlation of log box area with deduction is 0.52–0.80, and the separate model can be swapped for a crop regressor later without retraining the detector.
4. **Targets**: `FrameMarker_ESW_CSW` (edge/corner whitening, already covered by the corner and edge models), `PLAY_WEAR` (whole-card frames, w ≈ h ≈ 0.98), and any box whose area exceeds 25% of the image (whole-card ink/stain frames, 2,557 boxes) are excluded from detection targets. They remain in `surface.parquet`.

## Global Constraints

- Python `>=3.12,<3.13`; torch `2.9.1`; torchvision `0.24.1`; new dependency `scikit-learn>=1.5` and `joblib` added to `training/pyproject.toml` `dependencies` (not `dev`).
- Package is `training/trainlib`; tests in `training/tests`; run tests as `cd training && .venv/Scripts/python -m pytest -q` (Windows) / `.venv/bin/python -m pytest -q` (Linux). All existing 64 tests must keep passing; `filterwarnings = ["error"]` is in effect, so no warnings may be emitted by new code.
- Never `git add` `scripts/tag-dataset/tagdataset/cli.py`, `scripts/tag-dataset/tagdataset/download.py`, or any `.pt`/`.joblib` file. Never `git stash`. Commit only the files each task names.
- `surface.parquet` columns used: `cert, side, engine_type, x, y, w, h, deduction` (`x, y, w, h` are fractions of the image, origin top-left; `side` is `"F"`/`"B"`). `manifest.parquet` columns used: `cert, grade_label, path_sfx_front, path_sfx_back`. Splits: `splits.parquet` columns `cert, split`.
- Class list, in this order, label ids 1–7 (0 is background): `SURFACE_CLASSES = ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"]`.
- Box filters (exact): keep a marker iff `engine_type in SURFACE_CLASSES` and `w > 0` and `h > 0` and `w * h <= 0.25`. Deduction target is `min(max(deduction, 0), 1000)`.
- Tiling constants: `TILE = 1024`, `STRIDE = 896`, `MIN_VISIBLE = 0.5` (a box is kept in a tile if at least 50% of its area lies inside), `MIN_SIDE_PX = 4` (clipped boxes narrower or shorter than 4 px are dropped), `NEG_PER_SIDE = 1`.
- Tile cache layout: `<cache_dir>/tiles/<split>/<cert>_<side>_<x0>_<y0>.jpg` (JPEG quality 95, `subsampling=0`), index at `<cache_dir>/tiles/<split>.parquet` with columns `tile_path` (relative to `cache_dir`), `cert`, `side`, `grade_label`, `x0`, `y0`, `tile_w`, `tile_h`, `n_boxes`, `boxes` (JSON string: list of `[label, x1, y1, x2, y2]` in tile pixels, floats).
- Detector: `torchvision.models.detection.fasterrcnn_resnet50_fpn_v2`, COCO weights, `num_classes = 8`, anchor sizes `((16,), (32,), (64,), (128,), (256,))`, aspect ratios `((0.25, 0.5, 1.0, 2.0, 4.0),) * 5`, fresh `RPNHead(256, 5, conv_depth=2)`, `min_size = max_size = 1024`, `box_detections_per_img = 100`.
- Training defaults: SGD, momentum 0.9, weight decay 1e-4, lr 0.01, batch 8, 500 linear warm-up iterations then cosine to 0, AMP on CUDA, grad-norm clip 10, best checkpoint by val `map50`.
- Checkpoint dict keys: `model` (state_dict), `classes` (list), `epoch`, `map50`, `anchor_sizes`, `aspect_ratios`.
- The frozen `test` split is read only with `--final-eval`, once per accepted checkpoint.
- Run artifacts go to `runs/surface/<run-name>/`; accepted weights to `weights/surface/v1/` (`best.pt` and `deduction.joblib` gitignored; add `training/weights/**/*.joblib` to `.gitignore`).

---

## File structure

| File | Responsibility |
|---|---|
| `training/trainlib/surface_tables.py` | class list; load sides and filtered boxes for a split from the parquet tables |
| `training/trainlib/tiles.py` | pure geometry: tile grid, box clipping, tile selection |
| `training/trainlib/surface_cache_cli.py` | `pull` (cache sfx images from R2) and `tile` (cut tiles + write index) |
| `training/trainlib/tile_data.py` | `TileDataset` + collate for detection |
| `training/trainlib/detector.py` | `build_detector`, `load_detector` |
| `training/trainlib/det_metrics.py` | AP50 per class, precision/recall at a score threshold |
| `training/trainlib/train_surface.py` | training loop, log.csv, best.pt |
| `training/trainlib/evaluate_surface.py` | per-class / per-grade tile eval; `--full-cards` merged full-side eval |
| `training/trainlib/deduction_model.py` | features + HistGradientBoosting regressor, CLI to fit/eval/save |
| `training/tests/test_surface_tables.py`, `test_tiles.py`, `test_surface_cache_cli.py`, `test_tile_data.py`, `test_detector.py`, `test_det_metrics.py`, `test_train_surface.py`, `test_evaluate_surface.py`, `test_deduction_model.py` | one test file per module |
| `training/tests/conftest.py` | add `make_surface_tables` and `make_tile_index` fixtures |
| `training/README.md` | surface section; `training/HANDOFF-rented-gpu.md` Step 7 |

---

### Task 1: Surface tables and fixtures

**Files:**
- Create: `training/trainlib/surface_tables.py`
- Modify: `training/tests/conftest.py` (append fixtures)
- Test: `training/tests/test_surface_tables.py`

**Interfaces:**
- Produces: `SURFACE_CLASSES: list[str]`; `LABEL_OF: dict[str, int]` (class → 1..7); `load_surface_split(dataset_dir, splits_path, split, limit_cards=None, seed=42, allow_test=False) -> tuple[pd.DataFrame, pd.DataFrame]` returning `(sides, boxes)`. `sides` columns: `cert, side, image_key, grade_label` (one row per cert per side, both sides for every card in the split, sorted by cert then side). `boxes` columns: `cert, side, label (int), cls (str), x, y, w, h (fractions), deduction (float, clipped 0–1000)`; only markers passing the Global Constraints filters.

- [ ] **Step 1: Add fixtures to conftest**

Append to `training/tests/conftest.py`:

```python
def make_surface_tables(tmp_path: Path):
    """manifest + surface + splits for four certs. Boxes exercise every filter:
    a kept marker per class, a zero-width marker, an ESW_CSW marker, a PLAY_WEAR frame,
    a whole-card (area > 0.25) stain, and a deduction above 1000."""
    ds = tmp_path / "dataset"; ds.mkdir(exist_ok=True)
    certs = ["A1", "B2", "C3", "D4"]
    pd.DataFrame({
        "cert": certs, "grade_label": ["9 MINT", "1 POOR", "9 MINT", "5 EXCELLENT"],
        "path_sfx_front": [f"tag-dataset/{c}/sfx_front.jpg" for c in certs],
        "path_sfx_back": [f"tag-dataset/{c}/sfx_back.jpg" for c in certs],
    }).to_parquet(ds / "manifest.parquet", index=False)
    rows = [
        # cert, side, engine_type, x, y, w, h, deduction
        ("A1", "F", "CREASE", 0.10, 0.10, 0.05, 0.20, 480.0),
        ("A1", "F", "DENT", 0.50, 0.50, 0.04, 0.03, 345.0),
        ("A1", "B", "SCRATCH", 0.02, 0.60, 0.007, 0.06, 76.0),
        ("B2", "F", "PIT", 0.30, 0.30, 0.003, 0.002, 11.0),
        ("B2", "F", "PRINT_DEFECT", 0.05, 0.40, 0.90, 0.004, 23.0),   # a print line: wide, thin, area 0.0036 -> kept
        ("B2", "B", "STAIN", 0.00, 0.00, 0.98, 0.99, 11000.0),         # whole-card frame -> dropped (area > 0.25)
        ("B2", "B", "TEAR", 0.70, 0.70, 0.02, 0.02, 1350.0),           # kept, deduction clipped to 1000
        ("C3", "F", "EDGE", 0.00, 0.95, 0.006, 0.006, 133.0),          # ESW_CSW -> dropped
        ("C3", "F", "PLAY_WEAR", 0.01, 0.01, 0.98, 0.98, 425.0),       # dropped
        ("C3", "B", "DENT", 0.40, 0.40, 0.00, 0.03, 300.0),            # zero width -> dropped
        ("D4", "F", "CREASE", 0.20, 0.20, 0.10, 0.10, 500.0),
    ]
    pd.DataFrame(rows, columns=["cert", "side", "engine_type", "x", "y", "w", "h", "deduction"]).to_parquet(
        ds / "surface.parquet", index=False)
    sp = tmp_path / "splits.parquet"
    pd.DataFrame({"cert": certs, "split": ["train", "train", "val", "test"],
                  "stratum": ["x"] * 4, "assigned_at": ["t"] * 4}).to_parquet(sp, index=False)
    return ds, sp


@pytest.fixture
def surface_tables(tmp_path):
    return make_surface_tables(tmp_path)
```

- [ ] **Step 2: Write the failing tests**

`training/tests/test_surface_tables.py`:

```python
import pytest

from trainlib import surface_tables as st


def test_class_list_and_labels():
    assert st.SURFACE_CLASSES == ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"]
    assert st.LABEL_OF == {c: i + 1 for i, c in enumerate(st.SURFACE_CLASSES)}


def test_train_split_sides_and_filtered_boxes(surface_tables):
    ds, sp = surface_tables
    sides, boxes = st.load_surface_split(ds, sp, "train")
    assert list(sides.columns) == ["cert", "side", "image_key", "grade_label"]
    assert sides[["cert", "side"]].values.tolist() == [["A1", "B"], ["A1", "F"], ["B2", "B"], ["B2", "F"]]
    assert sides.image_key.tolist()[1] == "tag-dataset/A1/sfx_front.jpg"
    assert sides.grade_label.tolist()[0] == "9 MINT"
    # A1: crease, dent, scratch; B2: pit, print line, tear (stain frame dropped)
    assert len(boxes) == 6
    assert set(boxes.cls) == {"CREASE", "DENT", "SCRATCH", "PIT", "PRINT_DEFECT", "TEAR"}
    tear = boxes[boxes.cls == "TEAR"].iloc[0]
    assert tear.label == 7 and tear.deduction == 1000.0
    assert boxes[boxes.cls == "PIT"].iloc[0].label == 3


def test_val_split_drops_edge_playwear_and_zero_width(surface_tables):
    ds, sp = surface_tables
    sides, boxes = st.load_surface_split(ds, sp, "val")
    assert len(sides) == 2 and len(boxes) == 0


def test_test_split_is_gated(surface_tables):
    ds, sp = surface_tables
    with pytest.raises(ValueError):
        st.load_surface_split(ds, sp, "test")
    sides, boxes = st.load_surface_split(ds, sp, "test", allow_test=True)
    assert len(sides) == 2 and len(boxes) == 1


def test_limit_cards_is_seeded(surface_tables):
    ds, sp = surface_tables
    a, _ = st.load_surface_split(ds, sp, "train", limit_cards=1, seed=1)
    b, _ = st.load_surface_split(ds, sp, "train", limit_cards=1, seed=1)
    assert a.cert.tolist() == b.cert.tolist() and a.cert.nunique() == 1 and len(a) == 2
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_surface_tables.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'trainlib.surface_tables'`

- [ ] **Step 4: Implement**

`training/trainlib/surface_tables.py`:

```python
"""Surface-defect detection targets from surface.parquet (spec §7, plan 2026-09-16-surface-detector)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

SURFACE_CLASSES = ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"]
LABEL_OF = {c: i + 1 for i, c in enumerate(SURFACE_CLASSES)}   # 0 is background
MAX_BOX_AREA = 0.25
MAX_DEDUCTION = 1000.0


def _split_certs(splits_path: Path, split: str, limit_cards: int | None, seed: int) -> list[str]:
    sp = pd.read_parquet(splits_path)[["cert", "split"]]
    certs = sorted(sp[sp.split == split].cert.tolist())
    if limit_cards is not None and limit_cards < len(certs):
        rng = np.random.default_rng(seed)
        certs = sorted(rng.choice(certs, size=limit_cards, replace=False).tolist())
    return certs


def load_surface_split(dataset_dir: Path, splits_path: Path, split: str, limit_cards: int | None = None,
                       seed: int = 42, allow_test: bool = False) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(sides, boxes) for one split. sides: one row per cert per side; boxes: filtered markers."""
    if split == "test" and not allow_test:
        raise ValueError("the test split is read only with allow_test=True (evaluate --final-eval)")
    dataset_dir = Path(dataset_dir)
    certs = _split_certs(Path(splits_path), split, limit_cards, seed)
    man = pd.read_parquet(dataset_dir / "manifest.parquet",
                          columns=["cert", "grade_label", "path_sfx_front", "path_sfx_back"])
    man = man[man.cert.isin(certs)]
    sides = pd.concat([
        pd.DataFrame({"cert": man.cert, "side": "B", "image_key": man.path_sfx_back, "grade_label": man.grade_label}),
        pd.DataFrame({"cert": man.cert, "side": "F", "image_key": man.path_sfx_front, "grade_label": man.grade_label}),
    ]).sort_values(["cert", "side"]).reset_index(drop=True)

    s = pd.read_parquet(dataset_dir / "surface.parquet",
                        columns=["cert", "side", "engine_type", "x", "y", "w", "h", "deduction"])
    s = s[s.cert.isin(certs) & s.engine_type.isin(SURFACE_CLASSES)]
    s = s[(s.w > 0) & (s.h > 0) & (s.w * s.h <= MAX_BOX_AREA)].copy()
    s["label"] = s.engine_type.map(LABEL_OF).astype(int)
    s["cls"] = s.engine_type
    s["deduction"] = s.deduction.fillna(0.0).clip(0.0, MAX_DEDUCTION).astype(float)
    boxes = s[["cert", "side", "label", "cls", "x", "y", "w", "h", "deduction"]].sort_values(
        ["cert", "side", "y", "x"]).reset_index(drop=True)
    return sides, boxes
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_surface_tables.py`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add training/trainlib/surface_tables.py training/tests/conftest.py training/tests/test_surface_tables.py
git commit -m "feat(training): surface detection targets from surface.parquet"
```

---

### Task 2: Tile geometry

**Files:**
- Create: `training/trainlib/tiles.py`
- Test: `training/tests/test_tiles.py`

**Interfaces:**
- Produces: `TILE = 1024`, `STRIDE = 896`, `MIN_VISIBLE = 0.5`, `MIN_SIDE_PX = 4`; `tile_grid(w, h, tile=TILE, stride=STRIDE) -> list[tuple[int, int]]` (x0, y0 origins covering the image, last row/column shifted so the tile ends exactly at the image edge; tiles never exceed the image when the image is at least `tile` on that axis, otherwise a single origin 0 with the tile clipped by the caller); `clip_boxes(boxes_px, x0, y0, tile=TILE) -> list[list[float]]` where `boxes_px` is a list of `[label, x1, y1, x2, y2]` in image pixels and the result is the boxes with ≥ `MIN_VISIBLE` of their area inside the tile, translated to tile coordinates, clipped to `[0, tile]`, and dropped if narrower or shorter than `MIN_SIDE_PX`; `select_tiles(w, h, boxes_px, rng, neg_per_side=1) -> list[tuple[int, int, list]]` returning every grid tile with at least one clipped box plus, if there are no boxes at all on the side, `neg_per_side` distinct random grid tiles drawn with `rng` (a `numpy.random.Generator`), each with an empty box list.

- [ ] **Step 1: Write the failing tests**

`training/tests/test_tiles.py`:

```python
import numpy as np

from trainlib import tiles


def test_grid_covers_image_and_ends_on_edges():
    g = tiles.tile_grid(4391, 6063)
    xs = sorted({x for x, _ in g}); ys = sorted({y for _, y in g})
    assert xs[0] == 0 and ys[0] == 0
    assert xs[-1] == 4391 - 1024 and ys[-1] == 6063 - 1024
    assert all(x + 1024 <= 4391 and y + 1024 <= 6063 for x, y in g)
    assert xs[1] == 896 and ys[1] == 896
    assert len(g) == len(xs) * len(ys) == 5 * 7


def test_grid_small_image_is_single_origin():
    assert tiles.tile_grid(800, 700) == [(0, 0)]


def test_clip_keeps_boxes_with_half_area_inside_and_translates():
    boxes = [[1, 100.0, 100.0, 300.0, 300.0],      # fully inside tile (0,0)
             [2, 900.0, 100.0, 1100.0, 300.0],     # 62% inside -> kept, clipped at 1024
             [3, 1000.0, 100.0, 1400.0, 300.0],    # 6% inside -> dropped
             [4, 1020.0, 500.0, 1030.0, 900.0]]    # 40% inside -> dropped
    out = tiles.clip_boxes(boxes, 0, 0)
    assert out == [[1, 100.0, 100.0, 300.0, 300.0], [2, 900.0, 100.0, 1024.0, 300.0]]
    out2 = tiles.clip_boxes(boxes, 896, 0)
    assert [b[0] for b in out2] == [2, 3, 4]
    assert out2[0][1:] == [4.0, 100.0, 204.0, 300.0]


def test_clip_drops_slivers_below_min_side():
    boxes = [[5, 1020.0, 10.0, 1200.0, 20.0]]      # 4 px wide inside tile (0,0), 2.2% of area -> dropped anyway
    assert tiles.clip_boxes(boxes, 0, 0) == []
    boxes = [[5, 10.0, 10.0, 13.0, 200.0]]         # 3 px wide -> dropped by MIN_SIDE_PX
    assert tiles.clip_boxes(boxes, 0, 0) == []


def test_select_positive_tiles_only_when_boxes_exist():
    boxes = [[1, 100.0, 100.0, 300.0, 300.0]]
    sel = tiles.select_tiles(4391, 6063, boxes, np.random.default_rng(0))
    assert [(x, y) for x, y, _ in sel] == [(0, 0)]
    assert sel[0][2] == [[1, 100.0, 100.0, 300.0, 300.0]]


def test_select_negative_tiles_for_clean_side_are_seeded_and_distinct():
    a = tiles.select_tiles(4391, 6063, [], np.random.default_rng(3), neg_per_side=2)
    b = tiles.select_tiles(4391, 6063, [], np.random.default_rng(3), neg_per_side=2)
    assert a == b and len(a) == 2 and a[0][:2] != a[1][:2] and a[0][2] == [] and a[1][2] == []
    assert all((x, y) in tiles.tile_grid(4391, 6063) for x, y, _ in a)


def test_box_spanning_two_tiles_appears_in_both():
    boxes = [[4, 800.0, 10.0, 1100.0, 30.0]]       # a print line 300 px wide crossing x = 896..1024
    sel = tiles.select_tiles(4391, 6063, boxes, np.random.default_rng(0))
    assert [(x, y) for x, y, _ in sel] == [(0, 0), (896, 0)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_tiles.py`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

`training/trainlib/tiles.py`:

```python
"""Pure tile geometry for the surface detector: grid, box clipping, tile selection."""
from __future__ import annotations

import numpy as np

TILE = 1024
STRIDE = 896
MIN_VISIBLE = 0.5
MIN_SIDE_PX = 4


def _axis_origins(length: int, tile: int, stride: int) -> list[int]:
    if length <= tile:
        return [0]
    origins = list(range(0, length - tile, stride))
    origins.append(length - tile)
    return sorted(set(origins))


def tile_grid(w: int, h: int, tile: int = TILE, stride: int = STRIDE) -> list[tuple[int, int]]:
    """Tile origins (x0, y0) covering a w×h image; the last row/column end exactly on the image edge."""
    return [(x, y) for y in _axis_origins(h, tile, stride) for x in _axis_origins(w, tile, stride)]


def clip_boxes(boxes_px: list[list[float]], x0: int, y0: int, tile: int = TILE) -> list[list[float]]:
    """Boxes ([label, x1, y1, x2, y2] in image px) with >= MIN_VISIBLE of their area inside the tile,
    translated to tile coordinates and clipped; slivers thinner than MIN_SIDE_PX are dropped."""
    out = []
    for label, x1, y1, x2, y2 in boxes_px:
        area = max(x2 - x1, 0.0) * max(y2 - y1, 0.0)
        if area <= 0:
            continue
        cx1, cy1 = max(x1, x0), max(y1, y0)
        cx2, cy2 = min(x2, x0 + tile), min(y2, y0 + tile)
        if cx2 - cx1 <= 0 or cy2 - cy1 <= 0:
            continue
        if (cx2 - cx1) * (cy2 - cy1) < MIN_VISIBLE * area:
            continue
        if cx2 - cx1 < MIN_SIDE_PX or cy2 - cy1 < MIN_SIDE_PX:
            continue
        out.append([label, float(cx1 - x0), float(cy1 - y0), float(cx2 - x0), float(cy2 - y0)])
    return out


def select_tiles(w: int, h: int, boxes_px: list[list[float]], rng: np.random.Generator,
                 neg_per_side: int = 1, tile: int = TILE, stride: int = STRIDE) -> list[tuple[int, int, list]]:
    """Every grid tile containing a clipped box; for a side with no boxes, neg_per_side random grid tiles."""
    grid = tile_grid(w, h, tile, stride)
    if boxes_px:
        sel = []
        for x0, y0 in grid:
            kept = clip_boxes(boxes_px, x0, y0, tile)
            if kept:
                sel.append((x0, y0, kept))
        return sel
    n = min(neg_per_side, len(grid))
    idx = sorted(rng.choice(len(grid), size=n, replace=False).tolist())
    return [(grid[i][0], grid[i][1], []) for i in idx]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_tiles.py`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/tiles.py training/tests/test_tiles.py
git commit -m "feat(training): tile grid, box clipping and tile selection for surface images"
```

---

### Task 3: Surface cache CLI (pull + tile)

**Files:**
- Create: `training/trainlib/surface_cache_cli.py`
- Test: `training/tests/test_surface_cache_cli.py`

**Interfaces:**
- Consumes: `surface_tables.load_surface_split`, `tiles.select_tiles`, `cache.build_cache`, `cache.cache_path`, `config.load_config`, `r2.reader_from_config`.
- Produces: `python -m trainlib.surface_cache_cli pull --splits train,val,test [--limit-cards N] [--workers 16]` caches `sides.image_key` objects full-resolution at `cache_path(cache_dir, key)`; `python -m trainlib.surface_cache_cli tile --splits train,val [--limit-cards N] [--workers 16] [--seed 42] [--neg-per-side 1]` writes tiles and the index. Library functions: `tile_side(args) -> list[dict]` (one side; module-level so multiprocessing can pickle it; `args = (image_path: str, cert, side, grade_label, boxes_px_json: str, out_dir: str, seed: int, neg_per_side: int)`), `build_tile_index(cache_dir, split, sides, boxes, workers, seed, neg_per_side) -> pd.DataFrame` (writes `<cache_dir>/tiles/<split>.parquet`, returns it). Sides whose image is not cached are skipped and counted.

- [ ] **Step 1: Write the failing tests**

`training/tests/test_surface_cache_cli.py`:

```python
import json

import numpy as np
import pandas as pd
from PIL import Image

from conftest import FakeReader, png_bytes
from trainlib import surface_cache_cli as scc
from trainlib import surface_tables as st


def _image(w, h):
    return png_bytes(w, h, 120)


def test_pull_caches_every_side_image_for_requested_splits(surface_tables, tmp_path):
    ds, sp = surface_tables
    cache = tmp_path / "cache"
    sides, _ = st.load_surface_split(ds, sp, "train")
    reader = FakeReader({k: _image(64, 64) for k in sides.image_key})
    counts = scc.pull(reader, ds, sp, cache, "train", workers=2)
    assert counts["downloaded"] == 4
    assert all((cache / k).exists() for k in sides.image_key)


def test_tile_writes_tiles_and_index(surface_tables, tmp_path):
    ds, sp = surface_tables
    cache = tmp_path / "cache"
    sides, boxes = st.load_surface_split(ds, sp, "train")
    for k in sides.image_key:
        p = cache / k; p.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.full((2100, 2000, 3), 120, dtype=np.uint8)).save(p, format="JPEG")
    idx = scc.build_tile_index(cache, "train", sides, boxes, workers=1, seed=0, neg_per_side=1)
    assert (cache / "tiles" / "train.parquet").exists()
    assert list(idx.columns) == ["tile_path", "cert", "side", "grade_label", "x0", "y0", "tile_w", "tile_h", "n_boxes", "boxes"]
    # A1/F: crease at x 0.10-0.15, y 0.10-0.30 of 2000x2100 -> px (200,210)-(300,630): tile (0,0) only.
    a1f = idx[(idx.cert == "A1") & (idx.side == "F")]
    assert a1f.n_boxes.sum() == 2 and (a1f.n_boxes > 0).all()
    b = json.loads(a1f.iloc[0].boxes)
    assert b[0][0] == 1 and b[0][1:] == [200.0, 210.0, 300.0, 630.0]
    # every tile file exists at the recorded path and is 1024x1024 (image larger than a tile on both axes)
    for _, r in idx.iterrows():
        with Image.open(cache / r.tile_path) as im:
            assert im.size == (r.tile_w, r.tile_h) == (1024, 1024)
    # clean sides (B2/B has only a dropped stain + a kept tear -> positive; A1/B has a scratch -> positive)
    # so negatives only come from sides with zero kept boxes: none in train. Check val instead.
    sides_v, boxes_v = st.load_surface_split(ds, sp, "val")
    for k in sides_v.image_key:
        p = cache / k; p.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.full((2100, 2000, 3), 120, dtype=np.uint8)).save(p, format="JPEG")
    idx_v = scc.build_tile_index(cache, "val", sides_v, boxes_v, workers=1, seed=0, neg_per_side=1)
    assert len(idx_v) == 2 and (idx_v.n_boxes == 0).all() and (idx_v.boxes == "[]").all()


def test_tile_skips_sides_without_cached_image_and_is_resumable(surface_tables, tmp_path):
    ds, sp = surface_tables
    cache = tmp_path / "cache"
    sides, boxes = st.load_surface_split(ds, sp, "train")
    k = sides.image_key.iloc[0]
    p = cache / k; p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.full((1100, 1100, 3), 120, dtype=np.uint8)).save(p, format="JPEG")
    idx = scc.build_tile_index(cache, "train", sides, boxes, workers=1, seed=0, neg_per_side=1)
    assert set(idx.cert) == {sides.cert.iloc[0]} and set(idx.side) == {sides.side.iloc[0]}
    first = (cache / idx.tile_path.iloc[0]).stat().st_mtime_ns
    idx2 = scc.build_tile_index(cache, "train", sides, boxes, workers=1, seed=0, neg_per_side=1)
    assert (cache / idx2.tile_path.iloc[0]).stat().st_mtime_ns == first   # existing tile not rewritten
    assert idx2.equals(idx)


def test_cli_parses_splits_with_limits(monkeypatch, tmp_path):
    seen = {}
    monkeypatch.setattr(scc, "_run_pull", lambda cfg, split, limit, workers, seed: seen.setdefault("pull", []).append((split, limit)))
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\n[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    scc.main(["pull", "--config", str(cfg), "--splits", "train:500,val"])
    assert seen["pull"] == [("train", 500), ("val", None)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_surface_cache_cli.py`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

`training/trainlib/surface_cache_cli.py`:

```python
"""Surface detector data prep: `pull` sfx images from R2 into the cache, `tile` them into 1024 tiles + index."""
from __future__ import annotations

import argparse
import json
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from .cache import build_cache, cache_path
from .config import load_config
from .r2 import reader_from_config
from .surface_tables import load_surface_split
from .tiles import TILE, select_tiles

INDEX_COLUMNS = ["tile_path", "cert", "side", "grade_label", "x0", "y0", "tile_w", "tile_h", "n_boxes", "boxes"]


def _boxes_px(boxes: pd.DataFrame, w: int, h: int) -> list[list[float]]:
    return [[int(r.label), r.x * w, r.y * h, (r.x + r.w) * w, (r.y + r.h) * h] for r in boxes.itertuples()]


def tile_side(args) -> list[dict]:
    """Cut one side's tiles. args = (image_path, cert, side, grade_label, boxes_frac_json, out_dir, seed, neg_per_side).
    boxes_frac_json: JSON list of [label, x, y, w, h] fractions. Returns index rows (tile_path relative to out_dir's parent's parent)."""
    image_path, cert, side, grade_label, boxes_json, out_dir, seed, neg_per_side = args
    out_dir = Path(out_dir)
    rows = []
    with Image.open(image_path) as im:
        im = im.convert("RGB")
        w, h = im.size
        boxes_px = [[lb, x * w, y * h, (x + bw) * w, (y + bh) * h] for lb, x, y, bw, bh in json.loads(boxes_json)]
        rng = np.random.default_rng((seed * 1_000_003 + hash((cert, side)) % 1_000_003) % (2**32))
        for x0, y0, kept in select_tiles(w, h, boxes_px, rng, neg_per_side):
            tw, th = min(TILE, w - x0), min(TILE, h - y0)
            name = f"{cert}_{side}_{x0}_{y0}.jpg"
            dest = out_dir / name
            if not dest.exists():
                tmp = dest.with_suffix(".part")
                im.crop((x0, y0, x0 + tw, y0 + th)).save(tmp, format="JPEG", quality=95, subsampling=0)
                tmp.replace(dest)
            rows.append({"tile_path": f"tiles/{out_dir.name}/{name}", "cert": cert, "side": side,
                         "grade_label": grade_label, "x0": x0, "y0": y0, "tile_w": tw, "tile_h": th,
                         "n_boxes": len(kept), "boxes": json.dumps(kept)})
    return rows


def build_tile_index(cache_dir: Path, split: str, sides: pd.DataFrame, boxes: pd.DataFrame,
                     workers: int = 16, seed: int = 42, neg_per_side: int = 1,
                     progress=None) -> pd.DataFrame:
    cache_dir = Path(cache_dir)
    out_dir = cache_dir / "tiles" / split
    out_dir.mkdir(parents=True, exist_ok=True)
    by_side = {k: g for k, g in boxes.groupby(["cert", "side"])}
    jobs, skipped = [], 0
    for r in sides.itertuples():
        img = cache_path(cache_dir, r.image_key)
        if not img.exists():
            skipped += 1
            continue
        g = by_side.get((r.cert, r.side))
        frac = [] if g is None else [[int(b.label), float(b.x), float(b.y), float(b.w), float(b.h)] for b in g.itertuples()]
        jobs.append((str(img), r.cert, r.side, r.grade_label, json.dumps(frac), str(out_dir), seed, neg_per_side))
    rows: list[dict] = []
    if workers <= 1:
        for j in jobs:
            rows += tile_side(j)
            if progress: progress(len(rows))
    else:
        with Pool(workers) as pool:
            for out in pool.imap_unordered(tile_side, jobs, chunksize=4):
                rows += out
                if progress: progress(len(rows))
    df = pd.DataFrame(rows, columns=INDEX_COLUMNS).sort_values(["cert", "side", "y0", "x0"]).reset_index(drop=True)
    df.attrs["skipped_sides"] = skipped
    df.to_parquet(cache_dir / "tiles" / f"{split}.parquet", index=False)
    return df


def pull(reader, dataset_dir: Path, splits_path: Path, cache_dir: Path, split: str,
         limit_cards: int | None = None, workers: int = 16, seed: int = 42, progress=None) -> dict:
    sides, _ = load_surface_split(dataset_dir, splits_path, split, limit_cards, seed, allow_test=(split == "test"))
    return build_cache(reader, sorted(set(sides.image_key)), cache_dir, workers=workers, progress=progress)


def _parse_splits(spec: str) -> list[tuple[str, int | None]]:
    out = []
    for part in spec.split(","):
        split, _, limit = part.partition(":")
        out.append((split.strip(), int(limit) if limit else None))
    return out


def _run_pull(cfg, split, limit, workers, seed):
    t0 = time.time()
    counts = pull(reader_from_config(cfg), cfg.dataset_dir, cfg.splits_path, cfg.cache_dir, split, limit, workers, seed,
                  progress=lambda c: print(f"  {split}: {c}", flush=True) if (c["downloaded"] + c["skipped"]) % 500 == 0 else None)
    print(f"{split}: {counts} in {time.time() - t0:.0f}s")


def _run_tile(cfg, split, limit, workers, seed, neg_per_side):
    t0 = time.time()
    sides, boxes = load_surface_split(cfg.dataset_dir, cfg.splits_path, split, limit, seed, allow_test=(split == "test"))
    df = build_tile_index(cfg.cache_dir, split, sides, boxes, workers, seed, neg_per_side,
                          progress=lambda n: print(f"  {split}: {n} tiles", flush=True) if n % 2000 < 40 else None)
    print(f"{split}: {len(df)} tiles ({int((df.n_boxes > 0).sum())} positive, {df.n_boxes.sum()} boxes) "
          f"from {len(sides) - df.attrs['skipped_sides']} sides, {df.attrs['skipped_sides']} sides not cached, "
          f"{time.time() - t0:.0f}s")


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="surface_cache")
    p.add_argument("command", choices=["pull", "tile"])
    p.add_argument("--config", default="config.toml")
    p.add_argument("--splits", default="train,val", help="e.g. train:500,val:100 (limit is cards; omit for all)")
    p.add_argument("--workers", type=int, default=16); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--neg-per-side", type=int, default=1)
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    for split, limit in _parse_splits(args.splits):
        if args.command == "pull":
            _run_pull(cfg, split, limit, args.workers, args.seed)
        else:
            _run_tile(cfg, split, limit, args.workers, args.seed, args.neg_per_side)


if __name__ == "__main__":
    main()
```

Note for the implementer: `build_cache`'s `progress` callback receives the running `counts` dict (see `cache.py`); the lambda above must match that contract exactly, check it before running.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_surface_cache_cli.py`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/surface_cache_cli.py training/tests/test_surface_cache_cli.py
git commit -m "feat(training): surface cache CLI (pull sfx images, cut 1024 tiles, write index)"
```

---

### Task 4: Tile dataset and detector model

**Files:**
- Create: `training/trainlib/tile_data.py`, `training/trainlib/detector.py`
- Modify: `training/tests/conftest.py` (append `make_tile_index`)
- Test: `training/tests/test_tile_data.py`, `training/tests/test_detector.py`

**Interfaces:**
- Produces: `TileDataset(index: pd.DataFrame, cache_dir: Path, train: bool)`; `__getitem__` returns `(image: FloatTensor[3,H,W] in 0–1 (torchvision detection models normalize internally), target: {"boxes": FloatTensor[N,4] xyxy, "labels": Int64Tensor[N]})`; train mode applies horizontal flip (p 0.5), vertical flip (p 0.5), brightness/contrast ±10% using a lazily seeded per-worker `numpy` Generator exactly like `data.CropDataset._generator`; `collate_det(batch) -> (list[Tensor], list[dict])`. `detector.build_detector(num_classes=8, pretrained=True) -> FasterRCNN` per the Global Constraints; `detector.save_checkpoint(model, path, classes, epoch, map50)`; `detector.load_detector(path, device) -> (model, ckpt)`.

- [ ] **Step 1: Add fixture**

Append to `training/tests/conftest.py`:

```python
def make_tile_index(tmp_path: Path, n: int = 4, size: int = 128) -> tuple[Path, pd.DataFrame]:
    """A tiny tile cache: n tiles of size×size gray with one dark rectangle each (label i%7+1) and an index."""
    import json
    cache = tmp_path / "cache"
    out = cache / "tiles" / "train"; out.mkdir(parents=True, exist_ok=True)
    rows = []
    for i in range(n):
        arr = np.full((size, size, 3), 128, dtype=np.uint8)
        x1, y1 = 10 + 5 * i, 20 + 3 * i
        arr[y1:y1 + 30, x1:x1 + 40] = 20
        name = f"C{i}_F_0_0.jpg"
        Image.fromarray(arr).save(out / name, format="JPEG", quality=95, subsampling=0)
        boxes = [] if i == n - 1 else [[i % 7 + 1, float(x1), float(y1), float(x1 + 40), float(y1 + 30)]]
        rows.append({"tile_path": f"tiles/train/{name}", "cert": f"C{i}", "side": "F",
                     "grade_label": ["9 MINT", "1 POOR", "5 EXCELLENT", "7 NEAR MINT"][i % 4],
                     "x0": 0, "y0": 0, "tile_w": size, "tile_h": size, "n_boxes": len(boxes), "boxes": json.dumps(boxes)})
    idx = pd.DataFrame(rows)
    idx.to_parquet(cache / "tiles" / "train.parquet", index=False)
    return cache, idx
```

- [ ] **Step 2: Write the failing tests**

`training/tests/test_tile_data.py`:

```python
import numpy as np
import torch

from conftest import make_tile_index
from trainlib import tile_data


def test_eval_item_shapes_and_targets(tmp_path):
    cache, idx = make_tile_index(tmp_path)
    ds = tile_data.TileDataset(idx, cache, train=False)
    img, tgt = ds[0]
    assert img.shape == (3, 128, 128) and img.dtype == torch.float32 and 0.0 <= img.min() and img.max() <= 1.0
    assert tgt["boxes"].shape == (1, 4) and tgt["labels"].tolist() == [1]
    assert tgt["boxes"][0].tolist() == [10.0, 20.0, 50.0, 50.0]
    img3, tgt3 = ds[3]
    assert tgt3["boxes"].shape == (0, 4) and tgt3["labels"].shape == (0,)


def test_train_flips_move_boxes_consistently(tmp_path):
    cache, idx = make_tile_index(tmp_path)
    ds = tile_data.TileDataset(idx, cache, train=True)
    ds.rng = np.random.default_rng(0)
    seen = set()
    for _ in range(20):
        img, tgt = ds[0]
        x1, y1, x2, y2 = tgt["boxes"][0].tolist()
        # the dark rectangle must sit exactly inside the box after any flip
        patch = img[:, int(y1):int(y2), int(x1):int(x2)]
        assert patch.mean() < 0.3 and (x2 - x1, y2 - y1) == (40.0, 30.0)
        seen.add((x1, y1))
    assert len(seen) > 1


def test_collate_returns_lists():
    imgs, tgts = tile_data.collate_det([(torch.zeros(3, 8, 8), {"boxes": torch.zeros(0, 4), "labels": torch.zeros(0, dtype=torch.int64)})] * 2)
    assert isinstance(imgs, list) and len(imgs) == 2 and isinstance(tgts, list)
```

`training/tests/test_detector.py`:

```python
import torch

from trainlib import detector


def test_build_detector_has_small_anchors_and_eight_classes():
    m = detector.build_detector(num_classes=8, pretrained=False)
    ag = m.rpn.anchor_generator
    assert ag.sizes == ((16,), (32,), (64,), (128,), (256,))
    assert ag.aspect_ratios == ((0.25, 0.5, 1.0, 2.0, 4.0),) * 5
    assert m.roi_heads.box_predictor.cls_score.out_features == 8
    assert m.transform.min_size == (1024,) and m.transform.max_size == 1024


def test_train_mode_returns_losses_and_eval_returns_detections():
    m = detector.build_detector(num_classes=8, pretrained=False)
    imgs = [torch.rand(3, 64, 64), torch.rand(3, 64, 64)]
    tgts = [{"boxes": torch.tensor([[5.0, 5.0, 30.0, 25.0]]), "labels": torch.tensor([2])},
            {"boxes": torch.zeros(0, 4), "labels": torch.zeros(0, dtype=torch.int64)}]
    m.train()
    losses = m(imgs, tgts)
    assert {"loss_classifier", "loss_box_reg", "loss_objectness", "loss_rpn_box_reg"} <= set(losses)
    assert torch.isfinite(sum(losses.values()))
    m.eval()
    with torch.no_grad():
        out = m(imgs)
    assert len(out) == 2 and {"boxes", "labels", "scores"} <= set(out[0])


def test_checkpoint_roundtrip(tmp_path):
    m = detector.build_detector(num_classes=8, pretrained=False)
    p = tmp_path / "best.pt"
    detector.save_checkpoint(m, p, classes=["A"] * 7, epoch=2, map50=0.5)
    m2, ckpt = detector.load_detector(p, torch.device("cpu"))
    assert ckpt["epoch"] == 2 and ckpt["map50"] == 0.5 and ckpt["classes"] == ["A"] * 7
    assert ckpt["anchor_sizes"] == ((16,), (32,), (64,), (128,), (256,))
    a = dict(m.named_parameters())["roi_heads.box_predictor.cls_score.weight"]
    b = dict(m2.named_parameters())["roi_heads.box_predictor.cls_score.weight"]
    assert torch.equal(a, b)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_tile_data.py tests/test_detector.py`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 4: Implement**

`training/trainlib/tile_data.py`:

```python
"""Detection dataset over the tile index written by surface_cache_cli."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image, ImageEnhance
from torch.utils.data import Dataset, get_worker_info


class TileDataset(Dataset):
    def __init__(self, index: pd.DataFrame, cache_dir: Path, train: bool):
        self.index = index.reset_index(drop=True)
        self.cache_dir = Path(cache_dir)
        self.train = train
        self.rng = None

    def _generator(self) -> np.random.Generator:
        if self.rng is None:
            info = get_worker_info()
            seed = info.seed if info is not None else torch.initial_seed()
            self.rng = np.random.default_rng(seed % (2**32))
        return self.rng

    def __len__(self) -> int:
        return len(self.index)

    def __getitem__(self, i: int):
        row = self.index.iloc[i]
        with Image.open(self.cache_dir / row.tile_path) as im:
            img = im.convert("RGB")
        boxes = json.loads(row.boxes)
        labels = torch.tensor([int(b[0]) for b in boxes], dtype=torch.int64)
        xyxy = torch.tensor([b[1:] for b in boxes], dtype=torch.float32).reshape(-1, 4)
        w, h = img.size
        if self.train:
            rng = self._generator()
            if rng.random() < 0.5:
                img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                xyxy = torch.stack([w - xyxy[:, 2], xyxy[:, 1], w - xyxy[:, 0], xyxy[:, 3]], dim=1) if len(xyxy) else xyxy
            if rng.random() < 0.5:
                img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                xyxy = torch.stack([xyxy[:, 0], h - xyxy[:, 3], xyxy[:, 2], h - xyxy[:, 1]], dim=1) if len(xyxy) else xyxy
            img = ImageEnhance.Brightness(img).enhance(float(rng.uniform(0.9, 1.1)))
            img = ImageEnhance.Contrast(img).enhance(float(rng.uniform(0.9, 1.1)))
        t = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)
        return t, {"boxes": xyxy, "labels": labels}


def collate_det(batch):
    imgs, tgts = zip(*batch)
    return list(imgs), list(tgts)
```

`training/trainlib/detector.py`:

```python
"""Faster R-CNN ResNet50-FPN v2 with small anchors for surface defects (plan 2026-09-16-surface-detector)."""
from __future__ import annotations

from pathlib import Path

import torch
from torchvision.models.detection import FasterRCNN_ResNet50_FPN_V2_Weights, fasterrcnn_resnet50_fpn_v2
from torchvision.models.detection.anchor_utils import AnchorGenerator
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.models.detection.rpn import RPNHead

ANCHOR_SIZES = ((16,), (32,), (64,), (128,), (256,))
ASPECT_RATIOS = ((0.25, 0.5, 1.0, 2.0, 4.0),) * 5
TILE_SIZE = 1024


def build_detector(num_classes: int = 8, pretrained: bool = True):
    weights = FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT if pretrained else None
    model = fasterrcnn_resnet50_fpn_v2(weights=weights, weights_backbone=None if pretrained else None,
                                       min_size=TILE_SIZE, max_size=TILE_SIZE, box_detections_per_img=100)
    model.rpn.anchor_generator = AnchorGenerator(ANCHOR_SIZES, ASPECT_RATIOS)
    model.rpn.head = RPNHead(model.backbone.out_channels, len(ASPECT_RATIOS[0]), conv_depth=2)
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    return model


def save_checkpoint(model, path: Path, classes: list[str], epoch: int, map50: float) -> None:
    torch.save({"model": model.state_dict(), "classes": list(classes), "epoch": epoch, "map50": float(map50),
                "anchor_sizes": ANCHOR_SIZES, "aspect_ratios": ASPECT_RATIOS}, path)


def load_detector(path: Path, device: torch.device):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    model = build_detector(num_classes=len(ckpt["classes"]) + 1, pretrained=False)
    model.load_state_dict(ckpt["model"])
    return model.to(device), ckpt
```

Implementer notes: `fasterrcnn_resnet50_fpn_v2(weights=None)` still tries to load ImageNet backbone weights unless `weights_backbone=None` is passed; with `pretrained=False` pass `weights_backbone=None` explicitly (as written) so tests run offline. With `pretrained=True`, pass `weights=DEFAULT` and leave `weights_backbone` at its default (remove the argument in that branch). If torchvision warns about anything under `filterwarnings = error`, silence the specific warning at the call site with `warnings.catch_warnings()` and say which one in the report.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_tile_data.py tests/test_detector.py`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add training/trainlib/tile_data.py training/trainlib/detector.py training/tests/conftest.py training/tests/test_tile_data.py training/tests/test_detector.py
git commit -m "feat(training): tile detection dataset and Faster R-CNN v2 detector with small anchors"
```

---

### Task 5: Detection metrics

**Files:**
- Create: `training/trainlib/det_metrics.py`
- Test: `training/tests/test_det_metrics.py`

**Interfaces:**
- Produces: `iou_matrix(a: Tensor[N,4], b: Tensor[M,4]) -> Tensor[N,M]` (use `torchvision.ops.box_iou`); `match(pred_boxes, pred_scores, gt_boxes, iou_thr=0.5) -> list[bool]` greedy by descending score, each GT matched at most once; `average_precision(records: list[tuple[float, bool]], n_gt: int) -> float` VOC all-point AP from (score, is_tp) records; `evaluate_detections(preds: list[dict], gts: list[dict], n_classes: int, iou_thr=0.5, score_thr=0.5) -> dict` where each `preds[i]` has `boxes, labels, scores` and each `gts[i]` has `boxes, labels` (tensors, one entry per image), returning `{"map50": float, "ap50": {label: float}, "precision": float, "recall": float, "precision_by_class": {label: float}, "recall_by_class": {label: float}, "n_gt": {label: int}}`; `map50` averages AP over classes with `n_gt > 0`; precision/recall use predictions with `score >= score_thr`; `float("nan")` where undefined.

- [ ] **Step 1: Write the failing tests**

`training/tests/test_det_metrics.py`:

```python
import math

import torch

from trainlib import det_metrics as dm


def _p(boxes, labels, scores):
    return {"boxes": torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4), "labels": torch.tensor(labels), "scores": torch.tensor(scores)}


def _g(boxes, labels):
    return {"boxes": torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4), "labels": torch.tensor(labels)}


def test_average_precision_perfect_and_empty():
    assert dm.average_precision([(0.9, True), (0.8, True)], n_gt=2) == 1.0
    assert dm.average_precision([], n_gt=2) == 0.0
    assert math.isnan(dm.average_precision([(0.9, True)], n_gt=0))


def test_average_precision_voc_all_point():
    # TP, FP, TP with 2 GT: precision at recalls 0.5 and 1.0 are 1.0 and 2/3 -> AP = 0.5*1 + 0.5*(2/3)
    ap = dm.average_precision([(0.9, True), (0.8, False), (0.7, True)], n_gt=2)
    assert abs(ap - (0.5 + 0.5 * 2 / 3)) < 1e-6


def test_match_is_greedy_by_score_and_one_to_one():
    pred = torch.tensor([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], dtype=torch.float32)
    scores = torch.tensor([0.5, 0.9, 0.7])
    gt = torch.tensor([[0, 0, 10, 10]], dtype=torch.float32)
    assert dm.match(pred, scores, gt) == [False, True, False]


def test_evaluate_detections_two_classes():
    preds = [_p([[0, 0, 10, 10], [20, 20, 30, 30]], [1, 2], [0.9, 0.4]),
             _p([[0, 0, 10, 10]], [1], [0.8])]
    gts = [_g([[0, 0, 10, 10], [20, 20, 30, 30]], [1, 2]),
           _g([[40, 40, 50, 50]], [1])]
    r = dm.evaluate_detections(preds, gts, n_classes=7)
    assert r["n_gt"][1] == 2 and r["n_gt"][2] == 1 and r["n_gt"][3] == 0
    assert r["ap50"][1] == 0.5                      # one TP at 0.9, one FP at 0.8, 2 GT
    assert r["ap50"][2] == 1.0                      # score 0.4 still counts for AP
    assert math.isnan(r["ap50"][3])
    assert abs(r["map50"] - 0.75) < 1e-9
    # at score >= 0.5: class 1 has preds (TP, FP) -> P 0.5, R 0.5; class 2 has no preds -> P nan, R 0
    assert r["precision_by_class"][1] == 0.5 and r["recall_by_class"][1] == 0.5
    assert math.isnan(r["precision_by_class"][2]) and r["recall_by_class"][2] == 0.0
    assert r["precision"] == 0.5 and abs(r["recall"] - 1 / 3) < 1e-9
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_det_metrics.py`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

`training/trainlib/det_metrics.py`:

```python
"""AP50 / precision / recall for detections, no external metric dependency."""
from __future__ import annotations

import torch
from torchvision.ops import box_iou


def iou_matrix(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    if len(a) == 0 or len(b) == 0:
        return torch.zeros(len(a), len(b))
    return box_iou(a, b)


def match(pred_boxes: torch.Tensor, pred_scores: torch.Tensor, gt_boxes: torch.Tensor, iou_thr: float = 0.5) -> list[bool]:
    """True-positive flag per prediction (in input order): greedy by descending score, each GT used once."""
    tp = [False] * len(pred_boxes)
    if len(pred_boxes) == 0 or len(gt_boxes) == 0:
        return tp
    ious = iou_matrix(pred_boxes, gt_boxes)
    used = torch.zeros(len(gt_boxes), dtype=torch.bool)
    for i in torch.argsort(pred_scores, descending=True).tolist():
        row = ious[i].clone()
        row[used] = -1.0
        j = int(torch.argmax(row))
        if row[j] >= iou_thr:
            used[j] = True
            tp[i] = True
    return tp


def average_precision(records: list[tuple[float, bool]], n_gt: int) -> float:
    if n_gt == 0:
        return float("nan")
    if not records:
        return 0.0
    recs = sorted(records, key=lambda r: -r[0])
    tp = torch.tensor([1.0 if r[1] else 0.0 for r in recs])
    ctp = torch.cumsum(tp, 0)
    cfp = torch.cumsum(1.0 - tp, 0)
    recall = ctp / n_gt
    precision = ctp / (ctp + cfp)
    # VOC all-point interpolation
    mrec = torch.cat([torch.tensor([0.0]), recall, torch.tensor([1.0])])
    mpre = torch.cat([torch.tensor([0.0]), precision, torch.tensor([0.0])])
    for i in range(len(mpre) - 2, -1, -1):
        mpre[i] = max(mpre[i], mpre[i + 1])
    idx = torch.nonzero(mrec[1:] != mrec[:-1]).flatten()
    return float(((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]).sum())


def evaluate_detections(preds: list[dict], gts: list[dict], n_classes: int, iou_thr: float = 0.5,
                        score_thr: float = 0.5) -> dict:
    labels = range(1, n_classes + 1)
    records = {c: [] for c in labels}
    n_gt = {c: 0 for c in labels}
    tp_thr = {c: 0 for c in labels}; np_thr = {c: 0 for c in labels}
    for p, g in zip(preds, gts):
        for c in labels:
            pm = p["labels"] == c
            gm = g["labels"] == c
            pb, ps, gb = p["boxes"][pm], p["scores"][pm], g["boxes"][gm]
            n_gt[c] += int(gm.sum())
            flags = match(pb, ps, gb, iou_thr)
            records[c] += list(zip(ps.tolist(), flags))
            keep = ps >= score_thr
            flags_thr = match(pb[keep], ps[keep], gb, iou_thr)
            tp_thr[c] += sum(flags_thr); np_thr[c] += int(keep.sum())
    ap = {c: average_precision(records[c], n_gt[c]) for c in labels}
    valid = [ap[c] for c in labels if n_gt[c] > 0]
    prec = {c: (tp_thr[c] / np_thr[c] if np_thr[c] else float("nan")) for c in labels}
    rec = {c: (tp_thr[c] / n_gt[c] if n_gt[c] else float("nan")) for c in labels}
    tot_tp, tot_np, tot_gt = sum(tp_thr.values()), sum(np_thr.values()), sum(n_gt.values())
    return {"map50": (sum(valid) / len(valid)) if valid else float("nan"), "ap50": ap,
            "precision": (tot_tp / tot_np if tot_np else float("nan")),
            "recall": (tot_tp / tot_gt if tot_gt else float("nan")),
            "precision_by_class": prec, "recall_by_class": rec, "n_gt": n_gt}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_det_metrics.py`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/det_metrics.py training/tests/test_det_metrics.py
git commit -m "feat(training): AP50 and precision/recall metrics for detections"
```

---

### Task 6: Surface training loop

**Files:**
- Create: `training/trainlib/train_surface.py`
- Test: `training/tests/test_train_surface.py`

**Interfaces:**
- Consumes: `TileDataset`, `collate_det`, `build_detector`, `save_checkpoint`, `evaluate_detections`, `load_config`, `SURFACE_CLASSES`.
- Produces: `python -m trainlib.train_surface --run-name v1 [--epochs 8] [--batch-size 8] [--lr 0.01] [--workers 8] [--warmup-iters 500] [--limit-tiles N] [--val-limit-tiles N] [--no-pretrained] [--device] [--seed 42] [--min-size 1024]`; reads `<cache_dir>/tiles/train.parquet` and `val.parquet`; writes `runs/surface/<run-name>/{args.json, log.csv, best.pt, last.pt}`; `log.csv` columns `epoch,train_loss,val_loss_proxy,lr,seconds,map50,precision,recall` followed by `ap50_<CLASS>` for each of the 7 classes in order (`val_loss_proxy` is `1 - map50`, kept so the column layout mirrors the crop trainer); prints `best map50 <v>` and, on CUDA, `peak GPU memory: <v> GiB`. `main(argv) -> Path` returns the run dir. `--min-size` overrides the model's internal resize for tests only (sets `model.transform.min_size=(v,)`, `max_size=v`).

- [ ] **Step 1: Write the failing test**

`training/tests/test_train_surface.py`:

```python
import json

import pandas as pd
import torch

from conftest import make_tile_index
from trainlib import train_surface


def test_train_one_epoch_cpu_writes_artifacts(tmp_path):
    cache, idx = make_tile_index(tmp_path, n=4, size=96)
    # val index: reuse the train tiles under a val parquet
    idx.to_parquet(cache / "tiles" / "val.parquet", index=False)
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train_surface.main(["--config", str(cfg), "--run-name", "t", "--epochs", "1", "--batch-size", "2",
                                  "--no-pretrained", "--device", "cpu", "--workers", "0", "--warmup-iters", "1",
                                  "--min-size", "96"])
    assert (run_dir / "best.pt").exists() and (run_dir / "last.pt").exists()
    log = pd.read_csv(run_dir / "log.csv")
    assert list(log.columns) == ["epoch", "train_loss", "val_loss_proxy", "lr", "seconds", "map50", "precision", "recall",
                                 "ap50_CREASE", "ap50_DENT", "ap50_PIT", "ap50_PRINT_DEFECT", "ap50_SCRATCH", "ap50_STAIN", "ap50_TEAR"]
    assert len(log) == 1 and log.train_loss.notna().all()
    args = json.loads((run_dir / "args.json").read_text())
    assert args["epochs"] == 1
    ckpt = torch.load(run_dir / "best.pt", map_location="cpu", weights_only=False)
    assert ckpt["classes"] == ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_train_surface.py`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

`training/trainlib/train_surface.py`:

```python
"""Train the surface defect detector on cached tiles (plan 2026-09-16-surface-detector)."""
from __future__ import annotations

import argparse
import csv
import json
import math
import time
from pathlib import Path

import pandas as pd
import torch
from torch.utils.data import DataLoader

from .config import load_config
from .det_metrics import evaluate_detections
from .detector import build_detector, save_checkpoint
from .surface_tables import SURFACE_CLASSES
from .tile_data import TileDataset, collate_det

LOG_COLUMNS = ["epoch", "train_loss", "val_loss_proxy", "lr", "seconds", "map50", "precision", "recall"] + \
              [f"ap50_{c}" for c in SURFACE_CLASSES]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="train_surface")
    p.add_argument("--config", default="config.toml"); p.add_argument("--run-name", required=True)
    p.add_argument("--epochs", type=int, default=8); p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--lr", type=float, default=0.01); p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--warmup-iters", type=int, default=500); p.add_argument("--workers", type=int, default=8)
    p.add_argument("--limit-tiles", type=int); p.add_argument("--val-limit-tiles", type=int)
    p.add_argument("--no-pretrained", action="store_true"); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--min-size", type=int, help="override the detector's internal resize (tests only)")
    return p


def _index(cache_dir: Path, split: str, limit: int | None, seed: int) -> pd.DataFrame:
    df = pd.read_parquet(Path(cache_dir) / "tiles" / f"{split}.parquet")
    if limit is not None and limit < len(df):
        df = df.sample(n=limit, random_state=seed).sort_index()
    return df.reset_index(drop=True)


def _to(device, imgs, tgts):
    return [i.to(device) for i in imgs], [{k: v.to(device) for k, v in t.items()} for t in tgts]


@torch.no_grad()
def evaluate_loader(model, loader, device) -> dict:
    model.eval()
    preds, gts = [], []
    for imgs, tgts in loader:
        imgs, _ = _to(device, imgs, tgts)
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            out = model(imgs)
        preds += [{k: v.float().cpu() if k != "labels" else v.cpu() for k, v in o.items()} for o in out]
        gts += [{"boxes": t["boxes"], "labels": t["labels"]} for t in tgts]
    return evaluate_detections(preds, gts, n_classes=len(SURFACE_CLASSES))


def _lr_at(step: int, total: int, warmup: int, base: float) -> float:
    if step < warmup:
        return base * (step + 1) / warmup
    t = (step - warmup) / max(1, total - warmup)
    return base * 0.5 * (1.0 + math.cos(math.pi * min(1.0, t)))


def main(argv=None) -> Path:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    torch.manual_seed(args.seed)
    device = torch.device(args.device)
    train_idx = _index(cfg.cache_dir, "train", args.limit_tiles, args.seed)
    val_idx = _index(cfg.cache_dir, "val", args.val_limit_tiles, args.seed)
    train_loader = DataLoader(TileDataset(train_idx, cfg.cache_dir, True), batch_size=args.batch_size, shuffle=True,
                              num_workers=args.workers, collate_fn=collate_det, pin_memory=(device.type == "cuda"),
                              persistent_workers=(args.workers > 0), drop_last=True)
    val_loader = DataLoader(TileDataset(val_idx, cfg.cache_dir, False), batch_size=args.batch_size, shuffle=False,
                            num_workers=args.workers, collate_fn=collate_det, persistent_workers=(args.workers > 0))
    model = build_detector(num_classes=len(SURFACE_CLASSES) + 1, pretrained=not args.no_pretrained).to(device)
    if args.min_size:
        model.transform.min_size = (args.min_size,); model.transform.max_size = args.min_size
    params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.SGD(params, lr=args.lr, momentum=0.9, weight_decay=args.weight_decay)
    scaler = torch.amp.GradScaler("cuda", enabled=(device.type == "cuda"))
    total_steps = max(1, args.epochs * len(train_loader))

    run_dir = Path(cfg.runs_dir) / "surface" / args.run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "args.json").write_text(json.dumps(vars(args), indent=1), encoding="utf-8")
    print(f"surface: {len(train_idx)} train tiles ({int((train_idx.n_boxes > 0).sum())} positive) / "
          f"{len(val_idx)} val tiles; device {device}")

    best, step = -1.0, 0
    with open(run_dir / "log.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(LOG_COLUMNS)
        for epoch in range(1, args.epochs + 1):
            t0 = time.time(); model.train(); total = 0.0; n = 0
            for imgs, tgts in train_loader:
                for g in optimizer.param_groups:
                    g["lr"] = _lr_at(step, total_steps, args.warmup_iters, args.lr)
                imgs, tgts = _to(device, imgs, tgts)
                with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
                    losses = model(imgs, tgts)
                loss = sum(losses.values())
                optimizer.zero_grad(set_to_none=True)
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(params, 10.0)
                scaler.step(optimizer); scaler.update()
                total += float(loss.item()); n += 1; step += 1
            train_loss = total / max(n, 1)
            m = evaluate_loader(model, val_loader, device)
            secs = time.time() - t0
            row = [epoch, f"{train_loss:.5f}", f"{1.0 - m['map50']:.5f}" if not math.isnan(m["map50"]) else "nan",
                   f"{optimizer.param_groups[0]['lr']:.2e}", f"{secs:.1f}", f"{m['map50']:.4f}",
                   f"{m['precision']:.4f}", f"{m['recall']:.4f}"] + [f"{m['ap50'][i + 1]:.4f}" for i in range(len(SURFACE_CLASSES))]
            w.writerow(row); f.flush()
            print(f"epoch {epoch}/{args.epochs} train {train_loss:.4f} map50 {m['map50']:.4f} "
                  f"P {m['precision']:.3f} R {m['recall']:.3f} {secs:.0f}s")
            save_checkpoint(model, run_dir / "last.pt", SURFACE_CLASSES, epoch, m["map50"])
            score = -1.0 if math.isnan(m["map50"]) else m["map50"]
            if score > best or not (run_dir / "best.pt").exists():
                best = max(best, score); save_checkpoint(model, run_dir / "best.pt", SURFACE_CLASSES, epoch, m["map50"])
    print(f"best map50 {best:.4f}; artifacts in {run_dir}")
    if device.type == "cuda":
        print(f"peak GPU memory: {torch.cuda.max_memory_allocated()/2**30:.2f} GiB")
    return run_dir


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_train_surface.py`
Expected: 1 passed (a ResNet50 forward/backward on four 96×96 tiles on CPU takes under a minute)

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/train_surface.py training/tests/test_train_surface.py
git commit -m "feat(training): surface detector training loop with warmup+cosine SGD and AP50 selection"
```

---

### Task 7: Surface evaluation (tiles per grade, and merged full sides)

**Files:**
- Create: `training/trainlib/evaluate_surface.py`
- Test: `training/tests/test_evaluate_surface.py`

**Interfaces:**
- Consumes: `load_detector`, `TileDataset`, `collate_det`, `evaluate_detections`, `surface_tables.load_surface_split`, `tiles.tile_grid`, `cache.cache_path`.
- Produces: `python -m trainlib.evaluate_surface --checkpoint runs/surface/v1/best.pt --split val [--final-eval] [--batch-size 8] [--workers 8] [--limit-tiles N] [--full-cards N] [--score-thr 0.5] [--device] [--min-size]`. Tile eval reads `<cache_dir>/tiles/<split>.parquet`, prints a per-grade table with columns `grade, n_tiles, n_gt, map50, precision, recall` and an `ALL` row, then a per-class table `class, n_gt, ap50, precision, recall`, and writes `eval_<split>.csv` (the per-grade rows) and `eval_<split>_classes.csv` next to the checkpoint. `--split test` without `--final-eval` raises `SystemExit` with a message. `--full-cards N`: for the first N cards of the split (sorted cert order) whose sfx images are cached, run the detector over every grid tile of each side, translate boxes back to image coordinates, merge with `torchvision.ops.batched_nms` (IoU 0.5, per class), and score against that side's full GT boxes (from `load_surface_split`, fractions × decoded size) with `evaluate_detections`; print `full-side: n_sides, n_gt, map50, precision, recall, fp_per_side` where `fp_per_side` is predictions above `--score-thr` unmatched at IoU 0.5 divided by n_sides; write `eval_<split>_fullside.csv`. Library function `merge_tiles(preds_per_tile: list[tuple[int, int, dict]], iou=0.5) -> dict` (translate + NMS) is public and tested.

- [ ] **Step 1: Write the failing tests**

`training/tests/test_evaluate_surface.py`:

```python
import pandas as pd
import pytest
import torch

from conftest import make_tile_index
from trainlib import detector, evaluate_surface as es


def test_merge_tiles_translates_and_suppresses_duplicates():
    # the same defect seen twice from overlapping tiles (IoU 0.9) keeps only the higher score;
    # a detection from the tile at (300, 300) is translated into image coordinates
    a_img = {"boxes": torch.tensor([[10.0, 10.0, 50.0, 50.0]]), "labels": torch.tensor([1]), "scores": torch.tensor([0.9])}
    dup = {"boxes": torch.tensor([[12.0, 10.0, 52.0, 50.0]]), "labels": torch.tensor([1]), "scores": torch.tensor([0.8])}
    other = {"boxes": torch.tensor([[5.0, 5.0, 25.0, 25.0]]), "labels": torch.tensor([2]), "scores": torch.tensor([0.7])}
    merged = es.merge_tiles([(0, 0, a_img), (0, 0, dup), (300, 300, other)])
    assert merged["boxes"].tolist() == [[10.0, 10.0, 50.0, 50.0], [305.0, 305.0, 325.0, 325.0]]
    assert merged["labels"].tolist() == [1, 2] and merged["scores"].tolist() == [0.9, 0.7]


def test_merge_tiles_empty():
    m = es.merge_tiles([(0, 0, {"boxes": torch.zeros(0, 4), "labels": torch.zeros(0, dtype=torch.int64), "scores": torch.zeros(0)})])
    assert m["boxes"].shape == (0, 4) and m["labels"].shape == (0,)


def _cfg(tmp_path):
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    return cfg


def test_tile_eval_writes_per_grade_and_per_class_tables(tmp_path, capsys):
    cache, idx = make_tile_index(tmp_path, n=4, size=96)
    idx.to_parquet(cache / "tiles" / "val.parquet", index=False)
    m = detector.build_detector(num_classes=8, pretrained=False)
    ck = tmp_path / "best.pt"; detector.save_checkpoint(m, ck, ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"], 1, 0.0)
    es.main(["--config", str(_cfg(tmp_path)), "--checkpoint", str(ck), "--split", "val", "--device", "cpu",
             "--workers", "0", "--batch-size", "2", "--min-size", "96"])
    out = capsys.readouterr().out
    assert "ALL" in out
    grade = pd.read_csv(tmp_path / "eval_val.csv")
    assert list(grade.columns) == ["grade", "n_tiles", "n_gt", "map50", "precision", "recall"]
    assert grade.grade.iloc[-1] == "ALL" and int(grade.n_tiles.iloc[-1]) == 4 and int(grade.n_gt.iloc[-1]) == 3
    cls = pd.read_csv(tmp_path / "eval_val_classes.csv")
    assert list(cls.columns) == ["class", "n_gt", "ap50", "precision", "recall"] and len(cls) == 7


def test_test_split_requires_final_eval(tmp_path):
    cache, idx = make_tile_index(tmp_path, n=2, size=96)
    idx.to_parquet(cache / "tiles" / "test.parquet", index=False)
    m = detector.build_detector(num_classes=8, pretrained=False)
    ck = tmp_path / "best.pt"; detector.save_checkpoint(m, ck, ["A"] * 7, 1, 0.0)
    with pytest.raises(SystemExit):
        es.main(["--config", str(_cfg(tmp_path)), "--checkpoint", str(ck), "--split", "test", "--device", "cpu",
                 "--workers", "0", "--min-size", "96"])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_evaluate_surface.py`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

`training/trainlib/evaluate_surface.py`:

```python
"""Per-grade / per-class tile evaluation and merged full-side evaluation for the surface detector."""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import pandas as pd
import torch
from PIL import Image
from torch.utils.data import DataLoader
from torchvision.ops import batched_nms

from .cache import cache_path
from .config import load_config
from .det_metrics import evaluate_detections, match
from .detector import load_detector
from .surface_tables import SURFACE_CLASSES, load_surface_split
from .tile_data import TileDataset, collate_det
from .tiles import TILE, tile_grid


def merge_tiles(preds_per_tile: list[tuple[int, int, dict]], iou: float = 0.5) -> dict:
    """Translate per-tile detections to image coordinates and apply per-class NMS."""
    boxes, labels, scores = [], [], []
    for x0, y0, p in preds_per_tile:
        if len(p["boxes"]) == 0:
            continue
        boxes.append(p["boxes"] + torch.tensor([x0, y0, x0, y0], dtype=p["boxes"].dtype))
        labels.append(p["labels"]); scores.append(p["scores"])
    if not boxes:
        return {"boxes": torch.zeros(0, 4), "labels": torch.zeros(0, dtype=torch.int64), "scores": torch.zeros(0)}
    b, l, s = torch.cat(boxes), torch.cat(labels), torch.cat(scores)
    keep = batched_nms(b, s, l, iou)
    return {"boxes": b[keep], "labels": l[keep], "scores": s[keep]}


@torch.no_grad()
def _predict(model, imgs, device):
    with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
        out = model([i.to(device) for i in imgs])
    return [{"boxes": o["boxes"].float().cpu(), "labels": o["labels"].cpu(), "scores": o["scores"].float().cpu()} for o in out]


def _fmt(v: float) -> str:
    return "nan" if (isinstance(v, float) and math.isnan(v)) else f"{v:.4f}"


def tile_eval(model, index: pd.DataFrame, cache_dir: Path, device, batch_size: int, workers: int, score_thr: float):
    loader = DataLoader(TileDataset(index, cache_dir, False), batch_size=batch_size, shuffle=False,
                        num_workers=workers, collate_fn=collate_det)
    preds, gts = [], []
    model.eval()
    for imgs, tgts in loader:
        preds += _predict(model, imgs, device)
        gts += tgts
    rows = []
    for grade, g in index.groupby("grade_label", sort=True):
        ii = g.index.tolist()
        m = evaluate_detections([preds[i] for i in ii], [gts[i] for i in ii], len(SURFACE_CLASSES), score_thr=score_thr)
        rows.append({"grade": grade, "n_tiles": len(ii), "n_gt": sum(m["n_gt"].values()), "map50": m["map50"],
                     "precision": m["precision"], "recall": m["recall"]})
    m = evaluate_detections(preds, gts, len(SURFACE_CLASSES), score_thr=score_thr)
    rows.append({"grade": "ALL", "n_tiles": len(index), "n_gt": sum(m["n_gt"].values()), "map50": m["map50"],
                 "precision": m["precision"], "recall": m["recall"]})
    classes = [{"class": c, "n_gt": m["n_gt"][i + 1], "ap50": m["ap50"][i + 1],
                "precision": m["precision_by_class"][i + 1], "recall": m["recall_by_class"][i + 1]}
               for i, c in enumerate(SURFACE_CLASSES)]
    return pd.DataFrame(rows), pd.DataFrame(classes)


def full_side_eval(model, cfg, split: str, n_cards: int, device, score_thr: float, allow_test: bool) -> pd.DataFrame:
    sides, boxes = load_surface_split(cfg.dataset_dir, cfg.splits_path, split, allow_test=allow_test)
    certs = sorted(sides.cert.unique())[:n_cards]
    sides = sides[sides.cert.isin(certs)]
    by_side = {k: g for k, g in boxes.groupby(["cert", "side"])}
    preds, gts, fp = [], [], 0
    model.eval()
    for r in sides.itertuples():
        path = cache_path(cfg.cache_dir, r.image_key)
        if not path.exists():
            continue
        with Image.open(path) as im:
            img = im.convert("RGB")
        w, h = img.size
        per_tile = []
        for x0, y0 in tile_grid(w, h):
            crop = img.crop((x0, y0, x0 + TILE, y0 + TILE))
            t = torch.from_numpy(__import__("numpy").asarray(crop, dtype="float32") / 255.0).permute(2, 0, 1)
            per_tile.append((x0, y0, _predict(model, [t], device)[0]))
        p = merge_tiles(per_tile)
        g = by_side.get((r.cert, r.side))
        gb = torch.tensor([[b.x * w, b.y * h, (b.x + b.w) * w, (b.y + b.h) * h] for b in g.itertuples()],
                          dtype=torch.float32).reshape(-1, 4) if g is not None else torch.zeros(0, 4)
        gl = torch.tensor([int(b.label) for b in g.itertuples()], dtype=torch.int64) if g is not None else torch.zeros(0, dtype=torch.int64)
        preds.append(p); gts.append({"boxes": gb, "labels": gl})
        keep = p["scores"] >= score_thr
        fp += sum(1 for f in match(p["boxes"][keep], p["scores"][keep], gb) if not f)
    m = evaluate_detections(preds, gts, len(SURFACE_CLASSES), score_thr=score_thr)
    n = len(preds)
    return pd.DataFrame([{"n_sides": n, "n_gt": sum(m["n_gt"].values()), "map50": m["map50"], "precision": m["precision"],
                          "recall": m["recall"], "fp_per_side": (fp / n if n else float("nan"))}])


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="evaluate_surface")
    p.add_argument("--config", default="config.toml"); p.add_argument("--checkpoint", required=True)
    p.add_argument("--split", choices=["val", "test"], default="val"); p.add_argument("--final-eval", action="store_true")
    p.add_argument("--batch-size", type=int, default=8); p.add_argument("--workers", type=int, default=8)
    p.add_argument("--limit-tiles", type=int); p.add_argument("--full-cards", type=int)
    p.add_argument("--score-thr", type=float, default=0.5); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu"); p.add_argument("--min-size", type=int)
    args = p.parse_args(argv)
    if args.split == "test" and not args.final_eval:
        raise SystemExit("the test split is read only with --final-eval, once per accepted checkpoint")
    cfg = load_config(args.config)
    device = torch.device(args.device)
    model, ckpt = load_detector(args.checkpoint, device)
    if args.min_size:
        model.transform.min_size = (args.min_size,); model.transform.max_size = args.min_size
    index = pd.read_parquet(Path(cfg.cache_dir) / "tiles" / f"{args.split}.parquet")
    if args.limit_tiles is not None and args.limit_tiles < len(index):
        index = index.sample(n=args.limit_tiles, random_state=args.seed).sort_index().reset_index(drop=True)
    grade_df, class_df = tile_eval(model, index, cfg.cache_dir, device, args.batch_size, args.workers, args.score_thr)
    out_dir = Path(args.checkpoint).parent
    grade_df.to_csv(out_dir / f"eval_{args.split}.csv", index=False)
    class_df.to_csv(out_dir / f"eval_{args.split}_classes.csv", index=False)
    print(f"checkpoint epoch {ckpt['epoch']} (map50 at save {ckpt['map50']:.4f}); split {args.split}; {len(index)} tiles")
    print(grade_df.to_string(index=False, float_format=lambda v: _fmt(v)))
    print(class_df.to_string(index=False, float_format=lambda v: _fmt(v)))
    if args.full_cards:
        fs = full_side_eval(model, cfg, args.split, args.full_cards, device, args.score_thr, allow_test=args.final_eval)
        fs.to_csv(out_dir / f"eval_{args.split}_fullside.csv", index=False)
        print("full-side:"); print(fs.to_string(index=False, float_format=lambda v: _fmt(v)))


if __name__ == "__main__":
    main()
```

Implementer note: replace the `__import__("numpy")` shortcut with a normal `import numpy as np` at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q tests/test_evaluate_surface.py`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/evaluate_surface.py training/tests/test_evaluate_surface.py
git commit -m "feat(training): surface evaluation per grade/class and merged full-side eval"
```

---

### Task 8: Deduction regressor

**Files:**
- Create: `training/trainlib/deduction_model.py`
- Modify: `training/pyproject.toml` (add `"scikit-learn>=1.5"`, `"joblib>=1.3"` to `dependencies`), `.gitignore` (add `training/weights/**/*.joblib`)
- Test: `training/tests/test_deduction_model.py`

**Interfaces:**
- Produces: `features(boxes: pd.DataFrame) -> np.ndarray` with columns, in order: 7 one-hot class columns, `log_area`, `log_w`, `log_h`, `aspect = log(w/h)`, `cx`, `cy`, `border_dist = min(cx, cy, 1-cx, 1-cy)`, `is_back` (boxes columns `label, x, y, w, h, side`); `fit(train_boxes, val_boxes, seed=42) -> (model, report: pd.DataFrame)` using `sklearn.ensemble.HistGradientBoostingRegressor(max_iter=500, learning_rate=0.05, max_leaf_nodes=31, early_stopping=True, validation_fraction=0.1, random_state=seed)`, target `deduction`, predictions clipped to `[0, 1000]`; `report` has one row per class plus `ALL`: `class, n, mae, baseline_mae` (baseline = class median from train); `predict(model, boxes) -> np.ndarray`; `save(model, path)` / `load(path)` via joblib. CLI: `python -m trainlib.deduction_model --out weights/surface/v1/deduction.joblib [--final-eval]` fits on train, reports on val (and on test only with `--final-eval`), writes `deduction_val.csv` next to the output.

- [ ] **Step 1: Write the failing tests**

`training/tests/test_deduction_model.py`:

```python
import numpy as np
import pandas as pd

from trainlib import deduction_model as dmod
from trainlib import surface_tables as st


def _boxes(n, seed):
    rng = np.random.default_rng(seed)
    label = rng.integers(1, 8, size=n)
    w = rng.uniform(0.002, 0.2, size=n); h = rng.uniform(0.002, 0.2, size=n)
    ded = np.clip(60 * label + 900 * np.sqrt(w * h) + rng.normal(0, 10, size=n), 0, 1000)
    return pd.DataFrame({"cert": [f"C{i}" for i in range(n)], "side": rng.choice(["F", "B"], size=n), "label": label,
                         "cls": [st.SURFACE_CLASSES[l - 1] for l in label], "x": rng.uniform(0, 0.8, size=n),
                         "y": rng.uniform(0, 0.8, size=n), "w": w, "h": h, "deduction": ded})


def test_feature_layout():
    b = _boxes(3, 0)
    X = dmod.features(b)
    assert X.shape == (3, 7 + 8)
    assert X[:, :7].sum(axis=1).tolist() == [1.0, 1.0, 1.0]
    assert np.allclose(X[:, 7], np.log(b.w * b.h))
    assert np.allclose(X[:, 14], (b.side == "B").astype(float))


def test_fit_beats_class_median_and_roundtrips(tmp_path):
    train, val = _boxes(2000, 1), _boxes(300, 2)
    model, report = dmod.fit(train, val, seed=0)
    assert list(report.columns) == ["class", "n", "mae", "baseline_mae"]
    allrow = report[report["class"] == "ALL"].iloc[0]
    assert allrow.mae < 0.5 * allrow.baseline_mae
    p = dmod.predict(model, val)
    assert p.min() >= 0.0 and p.max() <= 1000.0
    path = tmp_path / "d.joblib"; dmod.save(model, path)
    assert np.allclose(dmod.predict(dmod.load(path), val), p)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd training && .venv/Scripts/python -m pip install -e ".[dev]"` after editing `pyproject.toml`, then `.venv/Scripts/python -m pytest -q tests/test_deduction_model.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'trainlib.deduction_model'`

- [ ] **Step 3: Implement**

`training/trainlib/deduction_model.py`:

```python
"""Box -> TAG deduction regressor (class + geometry), gradient boosted."""
from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from .config import load_config
from .surface_tables import SURFACE_CLASSES, load_surface_split

FEATURE_NAMES = [f"is_{c}" for c in SURFACE_CLASSES] + ["log_area", "log_w", "log_h", "aspect", "cx", "cy", "border_dist", "is_back"]


def features(boxes: pd.DataFrame) -> np.ndarray:
    n = len(boxes)
    X = np.zeros((n, len(FEATURE_NAMES)), dtype=np.float64)
    lab = boxes.label.to_numpy().astype(int)
    X[np.arange(n), lab - 1] = 1.0
    w = np.clip(boxes.w.to_numpy(float), 1e-6, None); h = np.clip(boxes.h.to_numpy(float), 1e-6, None)
    cx = boxes.x.to_numpy(float) + w / 2; cy = boxes.y.to_numpy(float) + h / 2
    k = len(SURFACE_CLASSES)
    X[:, k] = np.log(w * h); X[:, k + 1] = np.log(w); X[:, k + 2] = np.log(h); X[:, k + 3] = np.log(w / h)
    X[:, k + 4] = cx; X[:, k + 5] = cy
    X[:, k + 6] = np.minimum.reduce([cx, cy, 1 - cx, 1 - cy])
    X[:, k + 7] = (boxes.side.to_numpy() == "B").astype(float)
    return X


def predict(model, boxes: pd.DataFrame) -> np.ndarray:
    return np.clip(model.predict(features(boxes)), 0.0, 1000.0)


def _report(train: pd.DataFrame, val: pd.DataFrame, pred: np.ndarray) -> pd.DataFrame:
    med = train.groupby("label").deduction.median()
    base = val.label.map(med).fillna(train.deduction.median()).to_numpy()
    err = np.abs(pred - val.deduction.to_numpy()); berr = np.abs(base - val.deduction.to_numpy())
    rows = []
    for i, c in enumerate(SURFACE_CLASSES):
        m = (val.label.to_numpy() == i + 1)
        rows.append({"class": c, "n": int(m.sum()), "mae": float(err[m].mean()) if m.any() else float("nan"),
                     "baseline_mae": float(berr[m].mean()) if m.any() else float("nan")})
    rows.append({"class": "ALL", "n": len(val), "mae": float(err.mean()), "baseline_mae": float(berr.mean())})
    return pd.DataFrame(rows)


def fit(train: pd.DataFrame, val: pd.DataFrame, seed: int = 42):
    model = HistGradientBoostingRegressor(max_iter=500, learning_rate=0.05, max_leaf_nodes=31, early_stopping=True,
                                          validation_fraction=0.1, random_state=seed)
    model.fit(features(train), train.deduction.to_numpy(float))
    return model, _report(train, val, predict(model, val))


def save(model, path: Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True); joblib.dump(model, path)


def load(path: Path):
    return joblib.load(path)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="deduction_model")
    p.add_argument("--config", default="config.toml"); p.add_argument("--out", required=True)
    p.add_argument("--final-eval", action="store_true"); p.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    _, train = load_surface_split(cfg.dataset_dir, cfg.splits_path, "train")
    _, val = load_surface_split(cfg.dataset_dir, cfg.splits_path, "val")
    model, report = fit(train, val, args.seed)
    out = Path(args.out); save(model, out)
    report.to_csv(out.parent / "deduction_val.csv", index=False)
    print(f"fit on {len(train)} boxes; val:"); print(report.to_string(index=False, float_format=lambda v: f"{v:.1f}"))
    if args.final_eval:
        _, test = load_surface_split(cfg.dataset_dir, cfg.splits_path, "test", allow_test=True)
        rep = _report(train, test, predict(model, test)); rep.to_csv(out.parent / "deduction_test.csv", index=False)
        print("test:"); print(rep.to_string(index=False, float_format=lambda v: f"{v:.1f}"))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd training && .venv/Scripts/python -m pytest -q`
Expected: all tests pass (64 existing + the new ones from Tasks 1–8)

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/deduction_model.py training/tests/test_deduction_model.py training/pyproject.toml .gitignore
git commit -m "feat(training): box-to-deduction gradient boosted regressor"
```

---

### Task 9: Local smoke run, README, handoff Step 7

**Files:**
- Modify: `training/README.md` (new "Surface detector" section + Results rows), `training/HANDOFF-rented-gpu.md` (new "Step 7: surface detector")

This task runs commands rather than writing code. The local box is the RTX 4070 SUPER 12 GB; run training detached with `--workers 0` if the interactive shell's memory guard kills worker-based runs (see README notes). R2 credentials come from `scripts/tag-dataset/data/env.ps1` (dot-source it in PowerShell before the pull).

- [ ] **Step 1: Pull and tile 300 cards locally**

```powershell
cd training
. ..\scripts\tag-dataset\data\env.ps1
.\.venv\Scripts\python.exe -m trainlib.surface_cache_cli pull --splits train:300,val:60 --workers 8
.\.venv\Scripts\python.exe -m trainlib.surface_cache_cli tile --splits train:300,val:60 --workers 8
```
Expected: 720 images (~2.4 GB); tile counts printed per split. Record the counts (tiles, positive tiles, boxes) for the README.

- [ ] **Step 2: Smoke train 2 epochs**

```powershell
.\.venv\Scripts\python.exe -m trainlib.train_surface --run-name smoke --epochs 2 --batch-size 4 --workers 2 --warmup-iters 50
.\.venv\Scripts\python.exe -m trainlib.evaluate_surface --checkpoint runs\surface\smoke\best.pt --split val --batch-size 4 --workers 2 --full-cards 20
```
Expected: two log rows, `map50` above 0 by epoch 2 (any value; this checks plumbing, not accuracy), peak VRAM under 12 GiB. If VRAM overflows at batch 4, use batch 2 and note it.

- [ ] **Step 3: Fit the deduction model on the full tables (no images needed)**

```powershell
.\.venv\Scripts\python.exe -m trainlib.deduction_model --out weights\surface\smoke\deduction.joblib
```
Expected: per-class MAE table on val with `mae < baseline_mae` for CREASE, DENT, SCRATCH, PIT.

- [ ] **Step 4: README section**

Add to `training/README.md`, after the corner/edge sections, a "Surface detector" section covering: the seven classes and the exclusion rules with the measured counts (25,575 kept boxes on 14,768 sides; 2,557 whole-card frames excluded; ESW_CSW and PLAY_WEAR excluded), the tiling constants and why (median box sizes per class from the 2026-09-16 measurement: pits 11 px, scratches 160 px, dents 280 px, creases 390 px, print lines 3175×24 px), the cache layout, the four commands (pull, tile, train, evaluate) and the deduction model command, the license reasoning for torchvision over Ultralytics, and a Results row for the smoke (tiles, epochs, s/epoch, peak VRAM, map50, per-class AP where non-NaN).

- [ ] **Step 5: Handoff Step 7**

Append to `training/HANDOFF-rented-gpu.md` a "Step 7: surface detector" section with, in order: `git pull` and `uv pip install -e ".[dev]"` (scikit-learn is new) and the test count; copy the key file back (`scp env.ps1` from the main session, then `/workspace/env.sh` as in Step 1); `pull --splits train,val,test --workers 32` (55,500 images, ~184 GB, ~$7.50 of bandwidth); `tile --splits train,val,test --workers 32` (expect ~58k train tiles, ~25 GB); train `--run-name v1 --epochs 8 --batch-size 8 --workers 8` (~65 min per epoch expected on the 5880 Ada, judge from the `map50` column; peak VRAM expected under 20 GiB); `evaluate_surface --split val --full-cards 300`; acceptance: val `ALL` `map50` ≥ 0.50 and CREASE/DENT/SCRATCH AP50 each ≥ 0.50 (a first-version bar; report whatever it is); then `--split test --final-eval --full-cards 300` once; `deduction_model --out weights/surface/v1/deduction.joblib --final-eval`; leave artifacts in place for the main session to pull. Include the failure playbook additions: DataLoader `Bus error` → `--workers 4`; OOM → `--batch-size 4`; `map50` still `nan` after epoch 2 → stop and report (the model is producing no detections above 0.05 score; likely a tiling/index problem, not a tuning problem).

- [ ] **Step 6: Commit**

```bash
git add training/README.md training/HANDOFF-rented-gpu.md
git commit -m "docs(training): surface detector smoke, README section, handoff Step 7"
```

---

## Self-review

**Spec coverage.** §7 Surface row: architecture (Task 4, deviation 1 recorded), input (Tasks 2–3, deviation 2), outputs boxes + type (Tasks 4, 6) + deduction (Task 8, deviation 3), metrics precision/recall/mAP50 by type and deduction MAE (Tasks 5, 7, 8), per-grade table (Task 7), smoke then full run then frozen weights (Task 9 + handoff). Type mapping to engine keys: the `engine_type` column already carries the mapping produced by the dataset build; the detector uses those keys directly.

**Placeholder scan.** No TBDs; every code step carries the full code. Task 9 is a run-and-record task by design.

**Type consistency.** `boxes` DataFrame columns (`cert, side, label, cls, x, y, w, h, deduction`) are produced in Task 1 and consumed unchanged in Tasks 3, 7, 8. Index columns are fixed in the Global Constraints and used identically in Tasks 3, 4, 6, 7. Checkpoint keys are fixed in the Global Constraints and used in Tasks 4, 6, 7. `evaluate_detections` output keys are fixed in Task 5 and consumed in Tasks 6 and 7.
