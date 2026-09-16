"""Per-task table specs and the split/grade join (spec §6.1, §11)."""
from __future__ import annotations

from collections import namedtuple
from pathlib import Path

import pandas as pd

from .cache import resized_path

Target = namedtuple("Target", "name kind column")

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
}


def target_names(task: str) -> list[str]:
    return [t.name for t in TASKS[task]["targets"]]


def target_kinds(task: str) -> list[str]:
    return [t.kind for t in TASKS[task]["targets"]]


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


def filter_cached(df: pd.DataFrame, cache_dir: Path, task: str | None = None) -> tuple[pd.DataFrame, int]:
    """Drop rows whose crop_path has no file under cache_dir (e.g. permanently missing upstream).

    When `task` has a `cache_resize`, a row counts as cached if either the resized or the
    full-res file exists.
    """
    cache_dir = Path(cache_dir)
    resize = TASKS[task]["cache_resize"] if task else None
    if resize:
        present = df.crop_path.map(
            lambda p: resized_path(cache_dir, p, resize).exists() or (cache_dir / p).exists()
        )
    else:
        present = df.crop_path.map(lambda p: (cache_dir / p).exists())
    dropped = int((~present).sum())
    return df[present].reset_index(drop=True), dropped
