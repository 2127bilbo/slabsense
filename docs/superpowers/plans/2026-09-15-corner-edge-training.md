# Corner and Edge Model Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `training/` package that pulls corner and edge crops from R2 into a local cache, trains ConvNeXt-Tiny regressors that predict TAG's corner scores (angle, fill, fray) and edge scores (fill, fray), evaluates them per grade against the frozen test split, and runs end to end as a 500-card smoke test on the local RTX 4070 Super before full runs on a rented V100.

**Architecture:** One package with five modules: `cache` (R2 → local files, resumable), `data` (parquet + split join → PyTorch datasets with NaN-masked targets), `models` (timm backbone + regression head), `train` (AMP loop, cosine LR, best-checkpoint on val MAE, CSV log) and `evaluate` (per-grade MAE tables). Corners and edges share every module; the only differences are the table, the crop geometry, and the number of outputs. Tests run on CPU with synthetic PNGs and a fake bucket, never touching R2 or a GPU.

**Tech Stack:** Python 3.12 venv at `training/.venv` (CUDA torch wheels exist for cp312 on Windows; the 3.14 system Python has CPU-only torch), `torch==2.9.1+cu128`, `torchvision`, `timm>=1.0`, `pandas`, `pyarrow`, `boto3`, `pillow`, `numpy`, `pytest`.

**Spec:** `docs/superpowers/specs/2026-09-12-tag-grading-models-design.md` §7 (models table, metrics, training plan), §11 (nulls masked in loss; test split never read by training), §12 (per-grade eval table).

## Global Constraints

- Inputs are the parquet tables built by `scripts/tag-dataset` in `scripts/tag-dataset/data/dataset/` (`corners.parquet`, `edges.parquet`, `manifest.parquet`) and the frozen split at `scripts/tag-dataset/splits/splits.parquet`. Training never modifies them.
- The `test` split is never read by `train.py`; `evaluate.py` refuses `--split test` unless `--final-eval` is passed (spec §11).
- Targets are TAG scores on 0–1000, normalised to 0–1 for the loss; metrics are reported in TAG points. NaN targets (all back-corner angles: 111,012 of 222,008 rows; a handful of fills) are masked out of the loss and the metrics, never imputed.
- Score distributions are heavily skewed to 1000 (median corner fill 1000, angle 997). Loss is Smooth L1 (Huber, β=0.05 in normalised units). Every metrics table reports MAE overall AND on the low-score subset (`target < 900`), so a model that predicts "1000" everywhere is visible.
- Corner input: 550×550 PNG resized to 384×384. Edge input: strips are 3296×550 (top/bottom) or 550×4992 (left/right); left/right strips are rotated 90° so the long axis is horizontal, then all are resized to 1024×192. Side (`F`/`B`) is appended to the model input as a scalar feature.
- Cache: full-resolution originals, at `scripts/tag-dataset/data/cache/<crop_path>` by default (gitignored under `data/`; G: has ~435 GB free). Resumable, never re-downloads a file that exists with the right size.
- R2 access reuses the acquisition config: endpoint/region/bucket from `scripts/tag-dataset/config.toml` `[bucket]`, credentials from env `B2_KEY_ID` / `B2_APP_KEY`. Reads only.
- Checkpoints and logs go to `training/runs/<task>/<run_name>/` (gitignored). Final weights are copied to `training/weights/<task>/<version>/` (tracked, ≤ 120 MB each; commit only the accepted version).
- Unit tests must pass on CPU with no network: `training/.venv/Scripts/python.exe -m pytest -q` from `training/`; zero warnings.
- Commit messages end with:
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QGLEdmut9ukoVuG8AAVUHV

## Rulings

- Corners and edges share one `train.py` and one `evaluate.py` selected by `--task`; no per-task scripts (spec §7 says "one train_<task>.py per model"; a shared script with a task switch is the same contract with less duplication).
- Backbone starts as ConvNeXt-Tiny per spec; a `--backbone` flag allows the EfficientNet-B0 comparison later without code changes.
- The smoke run uses 500 train + 100 val cards sampled from the split file with a fixed seed; it exists to prove the loop, not to produce a model.

---

## File structure

```
training/
├── pyproject.toml
├── README.md                    setup (3.12 venv, cu128 torch), commands, smoke results, V100 recipe
├── config.example.toml          paths; copy to config.toml (gitignored)
├── trainlib/
│   ├── __init__.py
│   ├── config.py                Config dataclass + load_config()
│   ├── r2.py                    Reader(get_bytes(key) -> bytes) over boto3; FakeReader for tests
│   ├── cache.py                 build_cache(reader, paths, cache_dir, workers) -> counts
│   ├── tables.py                load_task_table(task, dataset_dir, splits_path, split, limit_cards, seed)
│   ├── data.py                  CropDataset, edge/corner transforms, collate with mask
│   ├── models.py                ScoreRegressor(backbone, n_out), TASKS spec dict
│   ├── train.py                 main(argv): --task --run-name --epochs --limit-cards ...
│   └── evaluate.py              main(argv): --task --checkpoint --split [--final-eval]
├── tests/
│   ├── conftest.py              synthetic tables, PNGs, FakeReader
│   ├── test_config.py
│   ├── test_cache.py
│   ├── test_tables.py
│   ├── test_data.py
│   ├── test_models.py
│   ├── test_train.py
│   └── test_evaluate.py
├── runs/                        gitignored
└── weights/                     tracked (accepted versions only)
```

---

### Task 1: Package scaffold, config, CUDA venv

**Files:**
- Create: `training/pyproject.toml`, `training/config.example.toml`, `training/trainlib/__init__.py`, `training/trainlib/config.py`, `training/tests/test_config.py`
- Modify: `.gitignore` (append `training/.venv/`, `training/runs/`, `training/config.toml`)

**Interfaces:**
- Produces: `config.Config` with fields `dataset_dir: Path, splits_path: Path, cache_dir: Path, runs_dir: Path, weights_dir: Path, r2_endpoint: str, r2_region: str, r2_bucket: str, r2_key_id: str | None, r2_app_key: str | None`; `config.load_config(path="config.toml") -> Config`.

- [ ] **Step 1: Write the package files**

`training/pyproject.toml`:
```toml
[project]
name = "trainlib"
version = "0.1.0"
description = "Train SlabSense corner/edge/surface models on the TAG dataset"
requires-python = ">=3.12,<3.13"
dependencies = [
  "timm>=1.0",
  "pandas>=2.2",
  "pyarrow>=15",
  "boto3>=1.34",
  "pillow>=10",
  "numpy>=1.26",
]

[project.optional-dependencies]
dev = ["pytest>=8"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["trainlib*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
filterwarnings = ["error"]
```
(torch and torchvision are installed separately from the CUDA index in Step 2 so pip does not pull the CPU wheel.)

`training/config.example.toml`:
```toml
[paths]
dataset_dir = "../scripts/tag-dataset/data/dataset"
splits_path = "../scripts/tag-dataset/splits/splits.parquet"
cache_dir   = "../scripts/tag-dataset/data/cache"
runs_dir    = "runs"
weights_dir = "weights"

[r2]
# Same bucket the dataset package writes to. Credentials come from env B2_KEY_ID / B2_APP_KEY.
config_toml = "../scripts/tag-dataset/config.toml"
```

`training/trainlib/config.py`:
```python
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    dataset_dir: Path
    splits_path: Path
    cache_dir: Path
    runs_dir: Path
    weights_dir: Path
    r2_endpoint: str
    r2_region: str
    r2_bucket: str
    r2_key_id: str | None
    r2_app_key: str | None


def load_config(path: str | Path = "config.toml") -> Config:
    path = Path(path)
    base = path.parent
    with open(path, "rb") as f:
        data = tomllib.load(f)
    p = data["paths"]
    with open(base / data["r2"]["config_toml"], "rb") as f:
        bucket = tomllib.load(f)["bucket"]
    return Config(
        dataset_dir=(base / p["dataset_dir"]).resolve(),
        splits_path=(base / p["splits_path"]).resolve(),
        cache_dir=(base / p["cache_dir"]).resolve(),
        runs_dir=(base / p.get("runs_dir", "runs")).resolve(),
        weights_dir=(base / p.get("weights_dir", "weights")).resolve(),
        r2_endpoint=bucket["endpoint"],
        r2_region=bucket["region"],
        r2_bucket=bucket["name"],
        r2_key_id=os.environ.get("B2_KEY_ID"),
        r2_app_key=os.environ.get("B2_APP_KEY"),
    )
```

`training/trainlib/__init__.py`: empty.

Append to `.gitignore`:
```
training/.venv/
training/runs/
training/config.toml
```

- [ ] **Step 2: Create the 3.12 venv and install CUDA torch**

From `training/` in PowerShell:
```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install torch==2.9.1 torchvision --index-url https://download.pytorch.org/whl/cu128
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```
Expected last line: `2.9.1+cu128 True NVIDIA GeForce RTX 4070 SUPER`. If `cuda.is_available()` is False, stop and report the driver/CUDA versions (driver 595.71 supports cu128).

- [ ] **Step 3: Write the failing config test**

`training/tests/test_config.py`:
```python
from pathlib import Path

from trainlib.config import load_config


def test_load_config_resolves_paths_and_reads_bucket(tmp_path, monkeypatch):
    (tmp_path / "ds.toml").write_text(
        '[bucket]\nendpoint = "https://x.r2.cloudflarestorage.com"\nregion = "auto"\nname = "b"\nprefix = "tag-dataset"\n',
        encoding="utf-8")
    (tmp_path / "config.toml").write_text(
        '[paths]\ndataset_dir = "d"\nsplits_path = "s/splits.parquet"\ncache_dir = "c"\n'
        '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    monkeypatch.setenv("B2_KEY_ID", "k"); monkeypatch.setenv("B2_APP_KEY", "s")
    cfg = load_config(tmp_path / "config.toml")
    assert cfg.dataset_dir == (tmp_path / "d").resolve()
    assert cfg.splits_path == (tmp_path / "s" / "splits.parquet").resolve()
    assert cfg.runs_dir == (tmp_path / "runs").resolve()
    assert cfg.r2_endpoint == "https://x.r2.cloudflarestorage.com" and cfg.r2_bucket == "b"
    assert cfg.r2_key_id == "k" and cfg.r2_app_key == "s"
```

- [ ] **Step 4: Run the test**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_config.py -v` → 1 passed.

- [ ] **Step 5: Commit**

```bash
git add training/pyproject.toml training/config.example.toml training/trainlib/__init__.py training/trainlib/config.py training/tests/test_config.py .gitignore
git commit -m "feat(training): package scaffold, config, CUDA venv"
```

---

### Task 2: R2 reader and resumable crop cache

**Files:**
- Create: `training/trainlib/r2.py`, `training/trainlib/cache.py`, `training/tests/conftest.py`, `training/tests/test_cache.py`

**Interfaces:**
- Produces: `r2.Reader(endpoint, region, bucket, key_id, app_key)` with `get(key: str) -> bytes` and `size(key) -> int`; `cache.build_cache(reader, keys: list[str], cache_dir: Path, workers: int = 16, progress=None) -> dict[str, int]` with keys `downloaded, skipped, failed`; files land at `cache_dir / key`; a file is skipped when it exists and its size equals `reader.size(key)`. `cache.cache_path(cache_dir, key) -> Path`.

- [ ] **Step 1: Write conftest and the failing cache tests**

`training/tests/conftest.py`:
```python
import io
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from PIL import Image


class FakeReader:
    def __init__(self, objects: dict[str, bytes]):
        self.objects = dict(objects)
        self.calls: list[str] = []
        self.fail: set[str] = set()

    def get(self, key: str) -> bytes:
        self.calls.append(key)
        if key in self.fail:
            raise RuntimeError("boom")
        return self.objects[key]

    def size(self, key: str) -> int:
        return len(self.objects[key])


def png_bytes(w: int, h: int, value: int = 128) -> bytes:
    arr = np.full((h, w, 3), value, dtype=np.uint8)
    buf = io.BytesIO(); Image.fromarray(arr).save(buf, format="PNG"); return buf.getvalue()


def make_tables(tmp_path: Path, certs=("A1", "B2", "C3", "D4"), grades=("9 MINT", "1 POOR", "9 MINT", "5 EXCELLENT"),
                splits=("train", "train", "val", "test")):
    ds = tmp_path / "dataset"; ds.mkdir(exist_ok=True)
    corners, edges = [], []
    for i, cert in enumerate(certs):
        for side in "FB":
            for c in ("TL", "TR", "BL", "BR"):
                corners.append({"cert": cert, "side": side, "corner": c,
                                "score_angle": float("nan") if side == "B" else 990.0 - i,
                                "score_fill": 1000.0 - 10 * i, "score_fray": 950.0 + i,
                                "fill_px": 1.0, "fray_px": 0.0, "angle_deg": 90.0,
                                "crop_path": f"tag-dataset/{cert}/corner_{side}{c}.png"})
            for e in "TBLR":
                edges.append({"cert": cert, "side": side, "edge": e, "score_fill": 999.0 - i, "score_fray": 1000.0,
                              "fill_px": 0.0, "fray_px": 0.0, "crop_path": f"tag-dataset/{cert}/edge_{side}{e}.png"})
    pd.DataFrame(corners).to_parquet(ds / "corners.parquet", index=False)
    pd.DataFrame(edges).to_parquet(ds / "edges.parquet", index=False)
    pd.DataFrame({"cert": list(certs), "grade_label": list(grades), "era": ["1999-2003"] * len(certs)}).to_parquet(ds / "manifest.parquet", index=False)
    sp = tmp_path / "splits.parquet"
    pd.DataFrame({"cert": list(certs), "split": list(splits), "stratum": ["x"] * len(certs), "assigned_at": ["t"] * len(certs)}).to_parquet(sp, index=False)
    return ds, sp


def make_cache(tmp_path: Path, table: pd.DataFrame, w: int, h: int, vertical_for_lr: bool = False) -> Path:
    cache = tmp_path / "cache"
    for p in table.crop_path:
        dest = cache / p; dest.parent.mkdir(parents=True, exist_ok=True)
        ww, hh = (h, w) if (vertical_for_lr and p[-6] in "LR") else (w, h)
        dest.write_bytes(png_bytes(ww, hh))
    return cache


@pytest.fixture
def tables(tmp_path):
    return make_tables(tmp_path)
```

`training/tests/test_cache.py`:
```python
from conftest import FakeReader
from trainlib import cache


def test_build_cache_downloads_skips_and_records_failures(tmp_path):
    reader = FakeReader({"tag-dataset/A1/x.png": b"abc", "tag-dataset/A1/y.png": b"defg", "tag-dataset/B2/z.png": b"q"})
    reader.fail.add("tag-dataset/B2/z.png")
    counts = cache.build_cache(reader, list(reader.objects), tmp_path / "c", workers=2)
    assert counts == {"downloaded": 2, "skipped": 0, "failed": 1}
    assert (tmp_path / "c" / "tag-dataset" / "A1" / "x.png").read_bytes() == b"abc"
    reader.calls.clear(); reader.fail.clear()
    counts = cache.build_cache(reader, list(reader.objects), tmp_path / "c", workers=2)
    assert counts == {"downloaded": 1, "skipped": 2, "failed": 0}
    assert reader.calls == ["tag-dataset/B2/z.png"]


def test_build_cache_redownloads_wrong_size(tmp_path):
    reader = FakeReader({"k.png": b"12345"})
    p = cache.cache_path(tmp_path / "c", "k.png"); p.parent.mkdir(parents=True); p.write_bytes(b"12")
    assert cache.build_cache(reader, ["k.png"], tmp_path / "c") == {"downloaded": 1, "skipped": 0, "failed": 0}
    assert p.read_bytes() == b"12345"


def test_build_cache_writes_atomically(tmp_path):
    reader = FakeReader({"k.png": b"12345"})
    cache.build_cache(reader, ["k.png"], tmp_path / "c")
    assert not list((tmp_path / "c").rglob("*.part"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_cache.py -v` → ImportError on `trainlib.cache`.

- [ ] **Step 3: Implement r2.py and cache.py**

`training/trainlib/r2.py`:
```python
"""Read-only R2 access. Reader.get returns bytes; Reader.size returns Content-Length."""
from __future__ import annotations

import boto3
from botocore.config import Config as BotoConfig


class Reader:
    def __init__(self, endpoint: str, region: str, bucket: str, key_id: str | None, app_key: str | None):
        if not key_id or not app_key:
            raise RuntimeError("Set B2_KEY_ID and B2_APP_KEY in the environment")
        self.bucket = bucket
        self.client = boto3.client(
            "s3", endpoint_url=endpoint, region_name=region,
            aws_access_key_id=key_id, aws_secret_access_key=app_key,
            config=BotoConfig(retries={"max_attempts": 5, "mode": "standard"}, max_pool_connections=32),
        )

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def size(self, key: str) -> int:
        return int(self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"])


def reader_from_config(cfg) -> Reader:
    return Reader(cfg.r2_endpoint, cfg.r2_region, cfg.r2_bucket, cfg.r2_key_id, cfg.r2_app_key)
```

`training/trainlib/cache.py`:
```python
"""Resumable local cache of bucket objects, laid out as cache_dir/<key>."""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable


def cache_path(cache_dir: Path, key: str) -> Path:
    return Path(cache_dir) / key


def _fetch(reader, key: str, dest: Path) -> str:
    if dest.exists() and dest.stat().st_size == reader.size(key):
        return "skipped"
    data = reader.get(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    return "downloaded"


def build_cache(reader, keys: list[str], cache_dir: Path, workers: int = 16,
                progress: Callable[[dict], None] | None = None) -> dict[str, int]:
    counts = {"downloaded": 0, "skipped": 0, "failed": 0}
    with ThreadPoolExecutor(max(1, workers)) as ex:
        futures = {ex.submit(_fetch, reader, k, cache_path(cache_dir, k)): k for k in keys}
        for f in as_completed(futures):
            try:
                counts[f.result()] += 1
            except Exception:
                counts["failed"] += 1
            if progress:
                progress(counts)
    return counts
```

- [ ] **Step 4: Run tests** → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/r2.py training/trainlib/cache.py training/tests/conftest.py training/tests/test_cache.py
git commit -m "feat(training): R2 reader and resumable crop cache"
```

---

### Task 3: Task tables and split join

**Files:**
- Create: `training/trainlib/tables.py`, `training/tests/test_tables.py`

**Interfaces:**
- Produces: `tables.TASKS = {"corners": {...}, "edges": {...}}` where each entry has `table` (parquet file name), `targets` (list of score columns), `key_cols` (e.g. `["side", "corner"]`), `input_size` (tuple), `long_side_horizontal` (bool); `tables.load_task_table(task, dataset_dir, splits_path, split, limit_cards=None, seed=42) -> pd.DataFrame` returning the task table joined with `split` and `grade_label`, filtered to `split`, optionally limited to `limit_cards` distinct certs chosen by seeded sample. Raises `ValueError` for `split == "test"` unless `allow_test=True`.

- [ ] **Step 1: Write the failing tests**

`training/tests/test_tables.py`:
```python
import pytest

from trainlib import tables


def test_tasks_spec():
    assert set(tables.TASKS) == {"corners", "edges"}
    assert tables.TASKS["corners"]["targets"] == ["score_angle", "score_fill", "score_fray"]
    assert tables.TASKS["edges"]["targets"] == ["score_fill", "score_fray"]
    assert tables.TASKS["corners"]["input_size"] == (384, 384)
    assert tables.TASKS["edges"]["input_size"] == (1024, 192)


def test_load_task_table_joins_split_and_grade(tables):
    ds, sp = tables
    df = tables_mod().load_task_table("corners", ds, sp, "train")
    assert set(df.cert) == {"A1", "B2"} and len(df) == 16
    assert set(df.columns) >= {"cert", "side", "corner", "score_fill", "crop_path", "split", "grade_label"}
    assert set(df.grade_label) == {"9 MINT", "1 POOR"}


def tables_mod():
    return tables


def test_load_task_table_refuses_test_split(tables):
    ds, sp = tables
    with pytest.raises(ValueError):
        tables.load_task_table("edges", ds, sp, "test")
    assert len(tables.load_task_table("edges", ds, sp, "test", allow_test=True)) == 8


def test_limit_cards_is_seeded_and_per_cert(tables):
    ds, sp = tables
    a = tables.load_task_table("corners", ds, sp, "train", limit_cards=1, seed=3)
    b = tables.load_task_table("corners", ds, sp, "train", limit_cards=1, seed=3)
    assert a.cert.nunique() == 1 and len(a) == 8 and set(a.cert) == set(b.cert)
```

- [ ] **Step 2: Run tests to verify they fail** → ImportError on `trainlib.tables`.

- [ ] **Step 3: Implement tables.py**

`training/trainlib/tables.py`:
```python
"""Per-task table specs and the split/grade join (spec §6.1, §11)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

TASKS = {
    "corners": {"table": "corners.parquet", "targets": ["score_angle", "score_fill", "score_fray"],
                "key_cols": ["side", "corner"], "input_size": (384, 384), "long_side_horizontal": False},
    "edges": {"table": "edges.parquet", "targets": ["score_fill", "score_fray"],
              "key_cols": ["side", "edge"], "input_size": (1024, 192), "long_side_horizontal": True},
}


def load_task_table(task: str, dataset_dir: Path, splits_path: Path, split: str,
                    limit_cards: int | None = None, seed: int = 42, allow_test: bool = False) -> pd.DataFrame:
    if split == "test" and not allow_test:
        raise ValueError("the test split is frozen; pass allow_test=True only from evaluate --final-eval")
    spec = TASKS[task]
    df = pd.read_parquet(Path(dataset_dir) / spec["table"])
    splits = pd.read_parquet(splits_path)[["cert", "split"]]
    grades = pd.read_parquet(Path(dataset_dir) / "manifest.parquet")[["cert", "grade_label"]]
    df = df.merge(splits, on="cert", how="inner").merge(grades, on="cert", how="left")
    df = df[df.split == split]
    if limit_cards is not None:
        certs = sorted(df.cert.unique())
        keep = pd.Series(certs).sample(n=min(limit_cards, len(certs)), random_state=seed)
        df = df[df.cert.isin(set(keep))]
    return df.reset_index(drop=True)
```

- [ ] **Step 4: Run tests** → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/tables.py training/tests/test_tables.py
git commit -m "feat(training): task table specs and split join"
```

---

### Task 4: Datasets and transforms

**Files:**
- Create: `training/trainlib/data.py`, `training/tests/test_data.py`

**Interfaces:**
- Produces: `data.CropDataset(df, task, cache_dir, train: bool)` returning `(image_tensor[3,H,W] float, side_tensor[1] float, target_tensor[n_out] float, mask_tensor[n_out] float)`; `data.collate(batch)` stacking those; `data.load_crop(path, task, train) -> torch.Tensor`; targets normalised by `/1000`; NaN targets → target 0 with mask 0; `side` is 0 for F, 1 for B. Train transforms: small random brightness/contrast jitter and, for corners only, random horizontal flip is NOT applied (corner identity matters); for edges, random horizontal flip is applied (a strip flipped is still a valid strip). Eval: resize only. Normalisation with ImageNet mean/std.

- [ ] **Step 1: Write the failing tests**

`training/tests/test_data.py`:
```python
import math

import pandas as pd
import torch

from conftest import make_cache
from trainlib import data, tables


def test_corner_dataset_shapes_targets_and_mask(tables, tmp_path):
    ds, sp = tables
    df = tables.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    d = data.CropDataset(df, "corners", cache, train=False)
    img, side, target, mask = d[0]
    assert img.shape == (3, 384, 384) and img.dtype == torch.float32
    assert side.shape == (1,) and target.shape == (3,) and mask.shape == (3,)
    row = df.iloc[0]
    assert side.item() == (1.0 if row.side == "B" else 0.0)
    assert abs(target[1].item() - row.score_fill / 1000) < 1e-6 and mask[1].item() == 1.0
    back = next(i for i in range(len(d)) if df.iloc[i].side == "B")
    _, _, t, m = d[back]
    assert m[0].item() == 0.0 and t[0].item() == 0.0 and m[1].item() == 1.0


def test_edge_dataset_rotates_vertical_strips(tables, tmp_path):
    ds, sp = tables
    df = tables.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)
    d = data.CropDataset(df, "edges", cache, train=False)
    for i in range(len(d)):
        img, _, target, mask = d[i]
        assert img.shape == (3, 192, 1024)
        assert target.shape == (2,) and mask.tolist() == [1.0, 1.0]


def test_collate_stacks(tables, tmp_path):
    ds, sp = tables
    df = tables.load_task_table("corners", ds, sp, "train")
    cache = make_cache(tmp_path, df, 550, 550)
    d = data.CropDataset(df, "corners", cache, train=True)
    imgs, sides, targets, masks = data.collate([d[0], d[1], d[2]])
    assert imgs.shape == (3, 3, 384, 384) and sides.shape == (3, 1) and targets.shape == (3, 3) and masks.shape == (3, 3)


def test_train_transform_is_stochastic_but_bounded(tables, tmp_path):
    ds, sp = tables
    df = tables.load_task_table("edges", ds, sp, "train")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)
    d = data.CropDataset(df, "edges", cache, train=True)
    a = d[0][0]; b = d[0][0]
    assert torch.isfinite(a).all() and a.shape == b.shape
```

- [ ] **Step 2: Run tests to verify they fail** → ImportError on `trainlib.data`.

- [ ] **Step 3: Implement data.py**

`training/trainlib/data.py`:
```python
"""Crop datasets with NaN-masked targets (spec §7, §11)."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image, ImageEnhance
from torch.utils.data import Dataset

from .tables import TASKS

MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
SCALE = 1000.0


def load_crop(path: Path, task: str, train: bool, rng: np.random.Generator | None = None) -> torch.Tensor:
    spec = TASKS[task]
    w, h = spec["input_size"]
    img = Image.open(path).convert("RGB")
    if spec["long_side_horizontal"] and img.height > img.width:
        img = img.transpose(Image.Transpose.ROTATE_90)
    if train:
        rng = rng or np.random.default_rng()
        img = ImageEnhance.Brightness(img).enhance(float(rng.uniform(0.9, 1.1)))
        img = ImageEnhance.Contrast(img).enhance(float(rng.uniform(0.9, 1.1)))
        if spec["long_side_horizontal"] and rng.random() < 0.5:
            img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    img = img.resize((w, h), Image.Resampling.BILINEAR)
    t = torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0).permute(2, 0, 1)
    return (t - MEAN) / STD


class CropDataset(Dataset):
    def __init__(self, df: pd.DataFrame, task: str, cache_dir: Path, train: bool):
        self.df = df.reset_index(drop=True)
        self.task = task
        self.cache_dir = Path(cache_dir)
        self.train = train
        self.targets = TASKS[task]["targets"]
        self.rng = np.random.default_rng()

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, i: int):
        row = self.df.iloc[i]
        img = load_crop(self.cache_dir / row.crop_path, self.task, self.train, self.rng)
        side = torch.tensor([1.0 if row.side == "B" else 0.0])
        vals = [float(row[c]) for c in self.targets]
        mask = torch.tensor([0.0 if math.isnan(v) else 1.0 for v in vals])
        target = torch.tensor([0.0 if math.isnan(v) else v / SCALE for v in vals])
        return img, side, target, mask


def collate(batch):
    imgs, sides, targets, masks = zip(*batch)
    return torch.stack(imgs), torch.stack(sides), torch.stack(targets), torch.stack(masks)
```

- [ ] **Step 4: Run tests** → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/data.py training/tests/test_data.py
git commit -m "feat(training): crop datasets with masked targets and edge rotation"
```

---

### Task 5: Model and masked loss

**Files:**
- Create: `training/trainlib/models.py`, `training/tests/test_models.py`

**Interfaces:**
- Produces: `models.ScoreRegressor(n_out: int, backbone: str = "convnext_tiny", pretrained: bool = True)` whose `forward(images, sides) -> tensor[B, n_out]` (sigmoid output in 0–1); `models.masked_huber(pred, target, mask, beta=0.05) -> scalar` averaging only over masked-in elements; `models.count_params(model) -> int`.

- [ ] **Step 1: Write the failing tests**

`training/tests/test_models.py`:
```python
import torch

from trainlib import models


def test_regressor_forward_shape_and_range():
    m = models.ScoreRegressor(n_out=3, backbone="resnet18", pretrained=False)
    x = torch.randn(2, 3, 64, 64); s = torch.tensor([[0.0], [1.0]])
    y = m(x, s)
    assert y.shape == (2, 3) and (y >= 0).all() and (y <= 1).all()


def test_side_changes_output():
    torch.manual_seed(0)
    m = models.ScoreRegressor(n_out=2, backbone="resnet18", pretrained=False).eval()
    x = torch.randn(1, 3, 64, 64)
    a = m(x, torch.tensor([[0.0]])); b = m(x, torch.tensor([[1.0]]))
    assert not torch.allclose(a, b)


def test_masked_huber_ignores_masked_elements():
    pred = torch.tensor([[0.5, 0.5], [0.5, 0.5]])
    target = torch.tensor([[0.5, 0.0], [0.5, 0.0]])
    mask = torch.tensor([[1.0, 0.0], [1.0, 0.0]])
    assert models.masked_huber(pred, target, mask).item() == 0.0
    mask_all = torch.ones_like(mask)
    assert models.masked_huber(pred, target, mask_all).item() > 0.0


def test_masked_huber_all_masked_is_zero_not_nan():
    pred = torch.zeros(2, 2); target = torch.ones(2, 2); mask = torch.zeros(2, 2)
    assert models.masked_huber(pred, target, mask).item() == 0.0


def test_convnext_tiny_param_count():
    m = models.ScoreRegressor(n_out=3, backbone="convnext_tiny", pretrained=False)
    n = models.count_params(m)
    assert 27_000_000 < n < 30_000_000
```

- [ ] **Step 2: Run tests to verify they fail** → ImportError on `trainlib.models`.

- [ ] **Step 3: Implement models.py**

`training/trainlib/models.py`:
```python
"""Backbone + regression head and the masked Huber loss (spec §7)."""
from __future__ import annotations

import timm
import torch
import torch.nn as nn
import torch.nn.functional as F


class ScoreRegressor(nn.Module):
    def __init__(self, n_out: int, backbone: str = "convnext_tiny", pretrained: bool = True):
        super().__init__()
        self.backbone = timm.create_model(backbone, pretrained=pretrained, num_classes=0)
        feat = self.backbone.num_features
        self.head = nn.Sequential(nn.Linear(feat + 1, 256), nn.GELU(), nn.Dropout(0.1), nn.Linear(256, n_out))

    def forward(self, images: torch.Tensor, sides: torch.Tensor) -> torch.Tensor:
        f = self.backbone(images)
        return torch.sigmoid(self.head(torch.cat([f, sides.to(f.dtype)], dim=1)))


def masked_huber(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor, beta: float = 0.05) -> torch.Tensor:
    per = F.smooth_l1_loss(pred, target, reduction="none", beta=beta) * mask
    denom = mask.sum()
    return per.sum() / denom if denom > 0 else per.sum() * 0.0


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
```

- [ ] **Step 4: Run tests** → 5 passed (the convnext test builds the model on CPU without weights; ~2 s).

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/models.py training/tests/test_models.py
git commit -m "feat(training): score regressor and masked Huber loss"
```

---

### Task 6: Training loop

**Files:**
- Create: `training/trainlib/train.py`, `training/tests/test_train.py`

**Interfaces:**
- Produces: `train.main(argv: list[str] | None = None) -> Path` (returns the run directory) with flags `--task {corners,edges}` `--run-name NAME` `--epochs N` `--batch-size N` `--lr F` `--limit-cards N` `--val-limit-cards N` `--backbone NAME` `--no-pretrained` `--workers N` `--device {cuda,cpu}` `--config PATH` `--seed N`. Writes `runs/<task>/<run>/log.csv` (epoch, train_loss, val_loss, val_mae_points, val_mae_low_points, lr, seconds), `best.pt` (state dict + task + backbone + n_out + epoch + val_mae), `last.pt`, `args.json`. `train.run_epoch(...)` and `train.evaluate_loader(model, loader, device) -> dict` (`mae_points`, `mae_low_points`, `n`, `n_low`) are importable for `evaluate.py`.

- [ ] **Step 1: Write the failing test**

`training/tests/test_train.py`:
```python
import json

import pandas as pd

from conftest import make_cache
from trainlib import tables, train


def test_train_two_epochs_cpu_writes_artifacts(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    cache = make_cache(tmp_path, df, 96, 96)
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text(f'[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   f'[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train.main(["--config", str(cfg), "--task", "corners", "--run-name", "t", "--epochs", "2",
                          "--batch-size", "4", "--backbone", "resnet18", "--no-pretrained", "--device", "cpu",
                          "--workers", "0", "--input-size", "64"])
    assert (run_dir / "best.pt").exists() and (run_dir / "last.pt").exists()
    log = pd.read_csv(run_dir / "log.csv")
    assert list(log.columns) == ["epoch", "train_loss", "val_loss", "val_mae_points", "val_mae_low_points", "lr", "seconds"]
    assert len(log) == 2 and log.val_mae_points.notna().all()
    args = json.loads((run_dir / "args.json").read_text())
    assert args["task"] == "corners" and args["epochs"] == 2
```

- [ ] **Step 2: Run test to verify it fails** → ImportError on `trainlib.train`.

- [ ] **Step 3: Implement train.py**

`training/trainlib/train.py`:
```python
"""Train a corner or edge score regressor (spec §7)."""
from __future__ import annotations

import argparse
import csv
import json
import math
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from .config import load_config
from .data import SCALE, CropDataset, collate
from .models import ScoreRegressor, count_params, masked_huber
from .tables import TASKS, load_task_table

LOG_COLUMNS = ["epoch", "train_loss", "val_loss", "val_mae_points", "val_mae_low_points", "lr", "seconds"]
LOW_THRESHOLD = 900.0 / SCALE


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="train")
    p.add_argument("--config", default="config.toml")
    p.add_argument("--task", choices=list(TASKS), required=True)
    p.add_argument("--run-name", required=True)
    p.add_argument("--epochs", type=int, default=10)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--weight-decay", type=float, default=0.05)
    p.add_argument("--limit-cards", type=int)
    p.add_argument("--val-limit-cards", type=int)
    p.add_argument("--backbone", default="convnext_tiny")
    p.add_argument("--no-pretrained", action="store_true")
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--input-size", type=int, help="override the square input size (tests only)")
    return p


def make_loader(df, task, cache_dir, train, batch_size, workers, input_size=None):
    ds = CropDataset(df, task, cache_dir, train=train)
    if input_size:
        from . import tables as _t  # test-only override, keeps TASKS immutable elsewhere
        ds_spec = dict(_t.TASKS[task]); ds_spec["input_size"] = (input_size, input_size)
        ds.spec_override = ds_spec
        _patch_input_size(ds, input_size)
    return DataLoader(ds, batch_size=batch_size, shuffle=train, num_workers=workers, collate_fn=collate,
                      pin_memory=(workers > 0), drop_last=False, persistent_workers=(workers > 0))


def _patch_input_size(ds: CropDataset, size: int) -> None:
    from . import data as _d
    original = _d.load_crop

    def patched(path, task, train, rng=None):
        spec = TASKS[task]
        saved = spec["input_size"]
        spec["input_size"] = (size, size)
        try:
            return original(path, task, train, rng)
        finally:
            spec["input_size"] = saved

    ds.load_crop = patched  # type: ignore[attr-defined]
    ds.__class__ = type("PatchedCropDataset", (CropDataset,), {"__getitem__": _getitem_with_patch})


def _getitem_with_patch(self, i):
    row = self.df.iloc[i]
    img = self.load_crop(self.cache_dir / row.crop_path, self.task, self.train, self.rng)
    side = torch.tensor([1.0 if row.side == "B" else 0.0])
    vals = [float(row[c]) for c in self.targets]
    mask = torch.tensor([0.0 if math.isnan(v) else 1.0 for v in vals])
    target = torch.tensor([0.0 if math.isnan(v) else v / SCALE for v in vals])
    return img, side, target, mask


@torch.no_grad()
def evaluate_loader(model, loader, device) -> dict:
    model.eval()
    abs_sum = 0.0; n = 0; low_sum = 0.0; n_low = 0; loss_sum = 0.0; batches = 0
    for imgs, sides, targets, masks in loader:
        imgs, sides, targets, masks = imgs.to(device), sides.to(device), targets.to(device), masks.to(device)
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            pred = model(imgs, sides)
        pred = pred.float()
        loss_sum += masked_huber(pred, targets, masks).item(); batches += 1
        err = (pred - targets).abs() * masks
        abs_sum += err.sum().item(); n += int(masks.sum().item())
        low = masks * (targets < LOW_THRESHOLD)
        low_sum += ((pred - targets).abs() * low).sum().item(); n_low += int(low.sum().item())
    return {"loss": loss_sum / max(batches, 1), "mae_points": SCALE * abs_sum / max(n, 1),
            "mae_low_points": SCALE * low_sum / max(n_low, 1) if n_low else float("nan"), "n": n, "n_low": n_low}


def run_epoch(model, loader, optimizer, scaler, scheduler, device) -> float:
    model.train(); total = 0.0; batches = 0
    for imgs, sides, targets, masks in loader:
        imgs, sides, targets, masks = imgs.to(device), sides.to(device), targets.to(device), masks.to(device)
        optimizer.zero_grad(set_to_none=True)
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            pred = model(imgs, sides)
        loss = masked_huber(pred.float(), targets, masks)
        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optimizer); scaler.update(); scheduler.step()
        total += loss.item(); batches += 1
    return total / max(batches, 1)


def main(argv=None) -> Path:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    torch.manual_seed(args.seed)
    device = torch.device(args.device)
    spec = TASKS[args.task]

    train_df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, "train", args.limit_cards, args.seed)
    val_df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, "val", args.val_limit_cards, args.seed)
    train_loader = make_loader(train_df, args.task, cfg.cache_dir, True, args.batch_size, args.workers, args.input_size)
    val_loader = make_loader(val_df, args.task, cfg.cache_dir, False, args.batch_size, args.workers, args.input_size)

    model = ScoreRegressor(len(spec["targets"]), args.backbone, pretrained=not args.no_pretrained).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    steps = max(1, args.epochs * len(train_loader))
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=args.lr, total_steps=steps, pct_start=0.1)
    scaler = torch.amp.GradScaler(enabled=(device.type == "cuda"))

    run_dir = Path(cfg.runs_dir) / args.task / args.run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "args.json").write_text(json.dumps(vars(args), indent=1), encoding="utf-8")
    print(f"{args.task}: {len(train_df)} train rows / {len(val_df)} val rows; params {count_params(model):,}; device {device}")

    best = float("inf")
    with open(run_dir / "log.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(LOG_COLUMNS)
        for epoch in range(1, args.epochs + 1):
            t0 = time.time()
            train_loss = run_epoch(model, train_loader, optimizer, scaler, scheduler, device)
            val = evaluate_loader(model, val_loader, device)
            secs = time.time() - t0
            w.writerow([epoch, f"{train_loss:.5f}", f"{val['loss']:.5f}", f"{val['mae_points']:.2f}",
                        f"{val['mae_low_points']:.2f}", f"{scheduler.get_last_lr()[0]:.2e}", f"{secs:.1f}"]); f.flush()
            print(f"epoch {epoch}/{args.epochs} train {train_loss:.4f} val {val['loss']:.4f} "
                  f"MAE {val['mae_points']:.1f} pts (low<900: {val['mae_low_points']:.1f} on n={val['n_low']}) {secs:.0f}s")
            state = {"model": model.state_dict(), "task": args.task, "backbone": args.backbone,
                     "n_out": len(spec["targets"]), "epoch": epoch, "val_mae": val["mae_points"]}
            torch.save(state, run_dir / "last.pt")
            if val["mae_points"] < best:
                best = val["mae_points"]; torch.save(state, run_dir / "best.pt")
    print(f"best val MAE {best:.2f} points; artifacts in {run_dir}")
    return run_dir


if __name__ == "__main__":
    main()
```

Note for the implementer: the `--input-size` override exists so the CPU test can run at 64 px; production runs never pass it. If the patch mechanism above is awkward, an equivalent acceptable implementation is to give `CropDataset.__init__` an optional `input_size` argument that overrides the spec's size (and drop `_patch_input_size`); update Task 4's `data.py` accordingly and keep its tests green. Either way, `--input-size` must not mutate `TASKS` for other datasets.

- [ ] **Step 4: Run the test** → 1 passed (about 10–20 s on CPU with resnet18 at 64 px).

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/train.py training/tests/test_train.py training/trainlib/data.py
git commit -m "feat(training): AMP training loop with masked loss, best-checkpoint, CSV log"
```

---

### Task 7: Per-grade evaluation

**Files:**
- Create: `training/trainlib/evaluate.py`, `training/tests/test_evaluate.py`

**Interfaces:**
- Produces: `evaluate.main(argv) -> Path` with flags `--config --task --checkpoint PATH --split {val,test} [--final-eval] --batch-size --workers --device --limit-cards --input-size`; writes `<checkpoint dir>/eval_<split>.csv` with one row per `grade_label` plus `ALL`: `grade_label, n, n_low, mae_points, mae_low_points, <per-target mae columns>`; prints the table; `evaluate.per_grade_table(model, df, task, cache_dir, device, batch_size, workers, input_size=None) -> pd.DataFrame`.

- [ ] **Step 1: Write the failing test**

`training/tests/test_evaluate.py`:
```python
import pandas as pd
import pytest

from conftest import make_cache
from trainlib import evaluate, train


def _trained(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    make_cache(tmp_path, df, 96, 96)
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg = tmp_path / "config.toml"
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train.main(["--config", str(cfg), "--task", "corners", "--run-name", "t", "--epochs", "1", "--batch-size", "4",
                          "--backbone", "resnet18", "--no-pretrained", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    return cfg, run_dir


def test_evaluate_val_writes_per_grade_table(tables, tmp_path):
    cfg, run_dir = _trained(tables, tmp_path)
    out = evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                         "--split", "val", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    t = pd.read_csv(out)
    assert list(t.columns[:5]) == ["grade_label", "n", "n_low", "mae_points", "mae_low_points"]
    assert "mae_score_angle" in t.columns and "mae_score_fray" in t.columns
    assert t.grade_label.iloc[-1] == "ALL" and set(t.grade_label[:-1]) == {"9 MINT"}
    assert t.n.iloc[-1] == 8 * 3 - 4 * 1  # 8 crops x 3 targets minus 4 masked back angles


def test_evaluate_refuses_test_without_final_eval(tables, tmp_path):
    cfg, run_dir = _trained(tables, tmp_path)
    with pytest.raises(ValueError):
        evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                       "--split", "test", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    out = evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                         "--split", "test", "--final-eval", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    assert out.name == "eval_test.csv"
```

- [ ] **Step 2: Run test to verify it fails** → ImportError on `trainlib.evaluate`.

- [ ] **Step 3: Implement evaluate.py**

`training/trainlib/evaluate.py`:
```python
"""Per-grade MAE tables against TAG scores (spec §7 metrics, §12)."""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import torch

from .config import load_config
from .data import SCALE
from .models import ScoreRegressor
from .tables import TASKS, load_task_table
from .train import LOW_THRESHOLD, make_loader


@torch.no_grad()
def _predict(model, loader, device):
    model.eval(); preds, targets, masks = [], [], []
    for imgs, sides, t, m in loader:
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            p = model(imgs.to(device), sides.to(device))
        preds.append(p.float().cpu()); targets.append(t); masks.append(m)
    return torch.cat(preds), torch.cat(targets), torch.cat(masks)


def per_grade_table(model, df: pd.DataFrame, task: str, cache_dir, device, batch_size=64, workers=0, input_size=None) -> pd.DataFrame:
    loader = make_loader(df, task, cache_dir, False, batch_size, workers, input_size)
    pred, target, mask = _predict(model, loader, device)
    err = (pred - target).abs() * SCALE
    low = mask * (target < LOW_THRESHOLD)
    names = TASKS[task]["targets"]
    rows = []
    groups = list(df.groupby("grade_label").indices.items()) + [("ALL", list(range(len(df))))]
    for grade, idx in groups:
        idx = torch.as_tensor(list(idx))
        m, l, e = mask[idx], low[idx], err[idx]
        row = {"grade_label": grade, "n": int(m.sum()), "n_low": int(l.sum()),
               "mae_points": float((e * m).sum() / max(m.sum(), 1)),
               "mae_low_points": float((e * l).sum() / l.sum()) if l.sum() > 0 else float("nan")}
        for j, name in enumerate(names):
            row[f"mae_{name}"] = float((e[:, j] * m[:, j]).sum() / max(m[:, j].sum(), 1))
        rows.append(row)
    return pd.DataFrame(rows)


def main(argv=None) -> Path:
    p = argparse.ArgumentParser(prog="evaluate")
    p.add_argument("--config", default="config.toml"); p.add_argument("--task", choices=list(TASKS), required=True)
    p.add_argument("--checkpoint", required=True); p.add_argument("--split", choices=["val", "test"], default="val")
    p.add_argument("--final-eval", action="store_true"); p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--workers", type=int, default=6); p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--limit-cards", type=int); p.add_argument("--input-size", type=int)
    args = p.parse_args(argv)
    cfg = load_config(args.config); device = torch.device(args.device)
    df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, args.split, args.limit_cards, allow_test=args.final_eval)
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = ScoreRegressor(ckpt["n_out"], ckpt["backbone"], pretrained=False)
    model.load_state_dict(ckpt["model"]); model.to(device)
    table = per_grade_table(model, df, args.task, cfg.cache_dir, device, args.batch_size, args.workers, args.input_size)
    out = Path(args.checkpoint).parent / f"eval_{args.split}.csv"
    table.to_csv(out, index=False)
    print(table.to_string(index=False, float_format=lambda v: f"{v:.1f}"))
    return out


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests** → 2 passed; full suite green.

- [ ] **Step 5: Commit**

```bash
git add training/trainlib/evaluate.py training/tests/test_evaluate.py
git commit -m "feat(training): per-grade MAE evaluation with frozen-test gate"
```

---

### Task 8: `cache` CLI and the corner smoke run on the 4070

**Files:**
- Create: `training/trainlib/cache_cli.py`, `training/README.md`
- Create: `training/config.toml` (from the example; gitignored)

**Interfaces:**
- Produces: `python -m trainlib.cache_cli --task corners --split train --limit-cards 500 [--split val --limit-cards 100] --workers 16` which loads the task table for each `(split, limit)` pair, collects `crop_path`s, and calls `build_cache` with the R2 reader, printing counts. Accept `--splits train:500,val:100` as the compact form.

- [ ] **Step 1: Write cache_cli.py**

`training/trainlib/cache_cli.py`:
```python
"""Pull the crops a training run needs into the local cache."""
from __future__ import annotations

import argparse
import time

from .cache import build_cache
from .config import load_config
from .r2 import reader_from_config
from .tables import TASKS, load_task_table


def main(argv=None) -> dict:
    p = argparse.ArgumentParser(prog="cache")
    p.add_argument("--config", default="config.toml"); p.add_argument("--task", choices=list(TASKS), required=True)
    p.add_argument("--splits", default="train,val", help="e.g. train:500,val:100 (limit is cards; omit for all)")
    p.add_argument("--workers", type=int, default=16); p.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    keys: list[str] = []
    for part in args.splits.split(","):
        split, _, limit = part.partition(":")
        df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, split.strip(),
                             int(limit) if limit else None, args.seed, allow_test=(split.strip() == "test"))
        keys += df.crop_path.tolist()
    keys = sorted(set(keys))
    print(f"{args.task}: {len(keys)} crops → {cfg.cache_dir}")
    t0 = time.time(); last = [0.0]

    def progress(c):
        if time.time() - last[0] > 5:
            last[0] = time.time(); print(f"\r{c}  {sum(c.values()) / (time.time() - t0):.1f}/s", end="", flush=True)

    counts = build_cache(reader_from_config(cfg), keys, cfg.cache_dir, args.workers, progress)
    print(f"\ncache done: {counts} in {time.time() - t0:.0f}s")
    return counts


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the README (setup + commands; results filled in after the runs)**

`training/README.md`:
```markdown
# training

Corner and edge score models trained on the TAG dataset (spec §7). Reads the tables built by `scripts/tag-dataset`; never modifies them.

## Setup (once)
```powershell
cd training
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install torch==2.9.1 torchvision --index-url https://download.pytorch.org/whl/cu128
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
copy config.example.toml config.toml
.\.venv\Scripts\python.exe -c "import torch; print(torch.cuda.get_device_name(0))"
```
R2 credentials come from the same env vars the dataset package uses (`B2_KEY_ID`, `B2_APP_KEY`).

## Commands (from `training/`, venv python)
| Command | What it does |
|---|---|
| `python -m trainlib.cache_cli --task corners --splits train:500,val:100` | pull those cards' crops into the local cache (resumable) |
| `python -m trainlib.train --task corners --run-name smoke --epochs 3 --limit-cards 500 --val-limit-cards 100` | train; writes `runs/corners/smoke/{log.csv,best.pt,last.pt,args.json}` |
| `python -m trainlib.evaluate --task corners --checkpoint runs/corners/smoke/best.pt --split val` | per-grade MAE table → `eval_val.csv` |
| `... --split test --final-eval` | the frozen test split; only for an accepted model |

Cache location: `scripts/tag-dataset/data/cache/` (full-resolution originals; ~100 GB each for all corners or all edges).

## Metrics
MAE in TAG points (0–1000) overall and on targets below 900 (`mae_low_points`), per grade. Back-corner angle scores are always missing in TAG data and are masked.

## Results
(filled in by the smoke and full runs)
```

- [ ] **Step 3: Create config.toml and run the unit suite**

`copy config.example.toml config.toml` in `training/`; `.\.venv\Scripts\python.exe -m pytest -q` → all green.

- [ ] **Step 4: Cache the smoke set**

From `training/` with `B2_KEY_ID`/`B2_APP_KEY` set (`. ..\scripts\tag-dataset\data\env.ps1`):
```powershell
.\.venv\Scripts\python.exe -m trainlib.cache_cli --task corners --splits train:500,val:100 --workers 16
```
Expected: `corners: 4800 crops` and `cache done: {'downloaded': 4800, 'skipped': 0, 'failed': 0}`; record elapsed seconds and MB/s.

- [ ] **Step 5: Smoke-train corners on the 4070**

```powershell
.\.venv\Scripts\python.exe -m trainlib.train --task corners --run-name smoke --epochs 3 --limit-cards 500 --val-limit-cards 100 --batch-size 32 --workers 6
.\.venv\Scripts\python.exe -m trainlib.evaluate --task corners --checkpoint runs\corners\smoke\best.pt --split val
```
Expected: three epochs, each well under two minutes; `val_mae_points` decreasing across epochs; the eval table printed with one row per grade present plus ALL. If CUDA runs out of memory at batch 32, retry with 16 and record it. Record per-epoch seconds, peak GPU memory (`torch.cuda.max_memory_allocated()` printed at the end of `train.main` — add that print), best val MAE, and MAE on the low subset.

- [ ] **Step 6: Record results and commit**

Fill the README "Results" section with a table: date, task, cards, epochs, seconds/epoch, peak VRAM, best val MAE, low-subset MAE. Commit:
```bash
git add training/trainlib/cache_cli.py training/trainlib/train.py training/README.md
git commit -m "feat(training): cache CLI; corner smoke run on RTX 4070 SUPER"
```

---

### Task 9: Edge smoke run

**Files:**
- Modify: `training/README.md` (Results)

- [ ] **Step 1: Cache and train**

```powershell
.\.venv\Scripts\python.exe -m trainlib.cache_cli --task edges --splits train:500,val:100 --workers 16
.\.venv\Scripts\python.exe -m trainlib.train --task edges --run-name smoke --epochs 3 --limit-cards 500 --val-limit-cards 100 --batch-size 16 --workers 6
.\.venv\Scripts\python.exe -m trainlib.evaluate --task edges --checkpoint runs\edges\smoke\best.pt --split val
```
Expected: cache ~4,800 strips (larger files; record MB/s and total GB); training runs at 1024×192 with batch 16 in under 12 GB; per-epoch seconds and MAE recorded as for corners.

- [ ] **Step 2: Record and commit**

Add the edges row to the README Results table. Commit `docs(training): edge smoke run results`.

---

### Task 10: Full-run recipe for a rented V100

**Files:**
- Modify: `training/README.md` (add "Full runs on a rented GPU" section)

- [ ] **Step 1: Write the recipe** (documentation only; not executed in this plan)

Section content:
- Rent a V100 32 GB (or 16 GB for corners/edges) with Ubuntu, CUDA ≥ 12.8 driver, ≥ 300 GB disk.
- `git clone` the repo at the `tag-dataset` branch; `python3.12 -m venv .venv`; install torch cu128 + `pip install -e training[dev]`; copy `training/config.toml` with `cache_dir = /data/cache`; export `B2_KEY_ID`/`B2_APP_KEY`.
- Cache directly from R2 on the box (egress is free): `python -m trainlib.cache_cli --task corners --splits train,val --workers 32` (~100 GB; expect 30–60 min on a datacenter link), then edges.
- Train: `python -m trainlib.train --task corners --run-name v1 --epochs 12 --batch-size 64 --workers 8` (V100 has no bf16; the loop uses fp16 autocast with GradScaler, which is what it needs); edges with `--batch-size 32`.
- Evaluate on val; if accepted, `--split test --final-eval` once; copy `best.pt` to `training/weights/<task>/v1/best.pt`, commit with the `eval_test.csv` beside it.
- Expected wall time on a V100: corners 3–5 h, edges 4–6 h; cost under $5 each at $0.40/h. Sync `runs/<task>/<run>/log.csv` back for the README.

- [ ] **Step 2: Commit** `docs(training): V100 full-run recipe`.

---

## Self-review

**Spec coverage.** §7 corners/edges rows: architecture (ConvNeXt-Tiny + heads, Task 5), inputs (384² and 1024×192 with rotation, Tasks 3–4), outputs on 0–1000 (normalised in Task 4, reported in points in Tasks 6–7), metric MAE per score per grade (Task 7), smoke on 500 cards locally then full run rented (Tasks 8–10), weights frozen into `weights/<task>/<version>/` (Task 10). §11 nulls masked (Tasks 4–5), test split never read by training (Task 3 guard, Task 7 gate). §12 per-grade table (Task 7). Not in scope: centering, surface, rollup (later plans).

**Placeholder scan.** README "Results" is filled by Tasks 8–9 with measured numbers; Task 10 is documentation by design.

**Type consistency.** `TASKS` keys and `targets` lists are used identically in `tables`, `data`, `train`, `evaluate`. `make_loader` signature `(df, task, cache_dir, train, batch_size, workers, input_size)` matches its use in `evaluate.per_grade_table`. Checkpoint dict keys `model, task, backbone, n_out, epoch, val_mae` written in Task 6 are read in Task 7. `FakeReader`, `make_tables`, `make_cache`, `png_bytes` come from `conftest.py` in Task 2 and are used by Tasks 4–7.
