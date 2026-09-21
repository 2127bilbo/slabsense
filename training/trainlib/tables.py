"""Per-task table specs and the split/grade join (spec §6.1, §11)."""
from __future__ import annotations

import os
from collections import namedtuple
from pathlib import Path

import pandas as pd

from .cache import resized_path

Target = namedtuple("Target", "name kind column")

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


def surface_front_rows(manifest: pd.DataFrame, view: str) -> pd.DataFrame:
    """One row per cert (front side only) for the front-score + rollup task. TAG's per-side back
    score does not follow the back image (unmarked backs are scored down, marked-up fronts leave
    the back at 1000), so the learnable targets are the front score and the card-level rollup;
    both are predicted from the front image. Either target may be missing (masked per row)."""
    _back_col, front_col = _VIEW_PATHS[view]
    rows = pd.DataFrame({"cert": manifest.cert, "side": "F", "crop_path": manifest[front_col],
                         "score_front": manifest["surface_front"].astype("float64"),
                         "rollup": manifest["rollup_surface"].astype("float64")})
    rows = rows[rows.crop_path.notna() & (rows.score_front.notna() | rows.rollup.notna())]
    return rows.sort_values("cert").reset_index(drop=True)


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


def _surface_front_task(view: str) -> dict:
    return {
        "table": "manifest.parquet",
        "rows": lambda df, v=view: surface_front_rows(df, v),
        "view": view,
        "targets": [Target("score_front", "regress", "score_front"), Target("rollup", "regress", "rollup")],
        "key_cols": ["side"],
        "input_size": (896, 1248),
        "long_side_horizontal": False,
        "cache_resize": (896, 1248),
    }


TASKS = {
    "corners": {
        "table": "corners.parquet",
        "targets": [
            Target("wear", "binary", "ding_count"),
            Target("deduction", "regress", "marker_deduction"),
            Target("angle", "regress", "score_angle"),
        ],
        "key_cols": ["side", "corner"],
        "input_size": (384, 384),
        "long_side_horizontal": False,
        "cache_resize": None,
    },
    "edges": {
        "table": "edges.parquet",
        "targets": [
            Target("wear", "binary", "ding_count"),
            Target("deduction", "regress", "marker_deduction"),
        ],
        "key_cols": ["side", "edge"],
        "input_size": (1024, 192),
        "long_side_horizontal": True,
        "cache_resize": (1024, 192),
    },
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
    "surface_front_sfx": _surface_front_task("sfx"),
    "surface_front_rgb": _surface_front_task("rgb"),
    "centering_rgb": {
        "table": "manifest.parquet",
        "rows": _centering_rows_from_manifest,
        "targets": [
            Target("dte_l", "regress", "dte_l"),
            Target("dte_r", "regress", "dte_r"),
            Target("dte_t", "regress", "dte_t"),
            Target("dte_b", "regress", "dte_b"),
        ],
        "key_cols": ["side"],
        "input_size": (896, 1248),
        "long_side_horizontal": False,
        "cache_resize": (896, 1248),
        "cache_variant": "card",
        "crop_boxes": "derived/centering_boxes_rgb.parquet",
        "edge_jitter": 0.03,
        "ratio_pairs": [("dte_l", "dte_r"), ("dte_t", "dte_b")],
    },
}


def target_names(task: str) -> list[str]:
    return [t.name for t in TASKS[task]["targets"]]


def target_kinds(task: str) -> list[str]:
    return [t.kind for t in TASKS[task]["targets"]]


def target_index(task: str, name: str) -> int:
    return target_names(task).index(name)


def load_task_table(task: str, dataset_dir: Path, splits_path: Path, split: str,
                    limit_cards: int | None = None, seed: int = 42, allow_test: bool = False) -> pd.DataFrame:
    if split == "test" and not allow_test:
        raise ValueError("the test split is frozen; pass allow_test=True only from evaluate --final-eval")
    spec = TASKS[task]
    df = pd.read_parquet(Path(dataset_dir) / spec["table"])
    if spec.get("rows") is not None:
        df = spec["rows"](df)
    splits = pd.read_parquet(splits_path)[["cert", "split"]]
    grades = pd.read_parquet(Path(dataset_dir) / "manifest.parquet")[["cert", "grade_label"]]
    df = df.merge(splits, on="cert", how="inner").merge(grades, on="cert", how="left")
    df = df[df.split == split]
    if limit_cards is not None:
        certs = sorted(df.cert.unique())
        keep = pd.Series(certs).sample(n=min(limit_cards, len(certs)), random_state=seed)
        df = df[df.cert.isin(set(keep))]
    return df.reset_index(drop=True)


def filter_cached(df: pd.DataFrame, cache_dir: Path, task: str | None = None) -> tuple[pd.DataFrame, int]:
    """Drop rows whose crop_path has no file under cache_dir (e.g. permanently missing upstream).

    When `task` has a `cache_resize`, a row counts as cached if either the resized or the
    full-res file exists.
    """
    cache_dir = Path(cache_dir)
    spec = TASKS[task] if task else None
    resize = spec["cache_resize"] if spec else None
    if resize:
        variant = spec.get("cache_variant")
        present = df.crop_path.map(
            lambda p: resized_path(cache_dir, p, resize, variant).exists() or (cache_dir / p).exists()
        )
    else:
        present = df.crop_path.map(lambda p: (cache_dir / p).exists())
    dropped = int((~present).sum())
    return df[present].reset_index(drop=True), dropped
