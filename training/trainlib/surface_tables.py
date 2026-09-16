"""Surface-defect detection targets from surface.parquet (spec §7, plan 2026-09-16-surface-detector)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

SURFACE_CLASSES = ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"]
LABEL_OF = {c: i + 1 for i, c in enumerate(SURFACE_CLASSES)}   # 0 is background
VIEWS = ("sfx", "rgb")                 # raking-light relief image; normal color image (same pixel frame)
RGB_EXCLUDED_LABELS = {LABEL_OF["DENT"]}   # dents are invisible under flat lighting
MAX_BOX_AREA = 0.25
MAX_DEDUCTION = 1000.0
VIEW_COLUMNS = {"sfx": ("path_sfx_back", "path_sfx_front"), "rgb": ("path_back", "path_front")}


def boxes_for_view(boxes: pd.DataFrame, view: str) -> pd.DataFrame:
    if view not in VIEWS:
        raise ValueError(f"view must be one of {VIEWS}, got {view!r}")
    if view == "rgb":
        return boxes[~boxes.label.isin(RGB_EXCLUDED_LABELS)].reset_index(drop=True)
    return boxes


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
                          columns=["cert", "grade_label", "path_sfx_front", "path_sfx_back", "path_front", "path_back"])
    man = man[man.cert.isin(certs)]
    parts = []
    for view in VIEWS:
        back_col, front_col = VIEW_COLUMNS[view]
        for side, col in (("B", back_col), ("F", front_col)):
            parts.append(pd.DataFrame({"cert": man.cert, "side": side, "view": view, "image_key": man[col],
                                       "grade_label": man.grade_label}))
    sides = pd.concat(parts).sort_values(["cert", "side", "view"]).reset_index(drop=True)

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
