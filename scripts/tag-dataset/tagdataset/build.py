"""Store → training parquet tables (spec §6.1)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from . import labels
from .splits import COLUMNS as SPLIT_COLUMNS, assign_splits
from .store import Store

OUTPUTS = ("manifest.parquet", "corners.parquet", "edges.parquet", "surface.parquet", "dings.parquet", "splits.parquet")


def _frame(rows: list[dict], columns: list[str]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=columns)
    return df[columns]


def build(store: Store, out_dir: str, seed: int = 42) -> dict[str, int]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    cards, corners, edges, markers, dings = [], [], [], [], []
    for cert, detail, score in store.iter_raw_ok():
        counts = {"uploaded": len(store.files_for(cert)), "unavailable": len(store.gone_files(cert))}
        cards.append(labels.card_row(cert, detail, score, counts))
        corners.extend(labels.corner_rows(cert, score))
        edges.extend(labels.edge_rows(cert, score))
        markers.extend(labels.surface_rows(cert, score))
        dings.extend(labels.ding_rows(cert, detail))

    manifest = _frame(cards, labels.MANIFEST_COLUMNS)
    splits_path = out / "splits.parquet"
    existing = pd.read_parquet(splits_path) if splits_path.exists() else None
    n_before = len(existing) if existing is not None else 0
    splits = assign_splits(manifest, existing, seed=seed) if len(manifest) else (
        existing if existing is not None else pd.DataFrame(columns=SPLIT_COLUMNS))

    manifest.to_parquet(out / "manifest.parquet", index=False)
    _frame(corners, labels.CORNER_COLUMNS).to_parquet(out / "corners.parquet", index=False)
    _frame(edges, labels.EDGE_COLUMNS).to_parquet(out / "edges.parquet", index=False)
    _frame(markers, labels.SURFACE_COLUMNS).to_parquet(out / "surface.parquet", index=False)
    _frame(dings, labels.DING_COLUMNS).to_parquet(out / "dings.parquet", index=False)
    splits.to_parquet(splits_path, index=False)

    return {"cards": len(manifest), "corners": len(corners), "edges": len(edges), "markers": len(markers),
            "dings": len(dings), "splits_new": len(splits) - n_before, "splits_total": len(splits)}
