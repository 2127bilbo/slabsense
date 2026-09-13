"""Store → training parquet tables (spec §6.1)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from . import labels
from .splits import COLUMNS as SPLIT_COLUMNS, assign_splits
from .store import Store

OUTPUTS = ("manifest.parquet", "corners.parquet", "edges.parquet", "surface.parquet", "dings.parquet", "splits.parquet")

DEFAULT_SPLITS_PATH = Path("splits") / "splits.parquet"


def _schema(columns: list[str], string_cols: set[str] = frozenset(), bool_cols: set[str] = frozenset(),
            int_cols: set[str] = frozenset()) -> dict[str, str]:
    """Build a per-table {column: dtype} map: named columns get their pinned dtype, every
    other column defaults to float64. Pinning dtypes keeps a table's schema stable across
    builds regardless of which certs happen to be present (an all-null column would
    otherwise infer as object, or a column with no missing values as int64 instead of the
    nullable Int64 another build of the same table would need)."""
    schema = {}
    for c in columns:
        if c in string_cols:
            schema[c] = "string"
        elif c in bool_cols:
            schema[c] = "bool"
        elif c in int_cols:
            schema[c] = "Int64"
        else:
            schema[c] = "float64"
    return schema


MANIFEST_SCHEMA = _schema(
    labels.MANIFEST_COLUMNS,
    string_cols={
        "cert", "uuid", "grade_label", "grade_alias", "date_graded", "era", "brand",
        "set_name", "subset_name", "card_name", "card_number",
        "path_front", "path_back", "path_sfx_front", "path_sfx_back",
        "path_sfx_front_annotated", "path_sfx_back_annotated",
    },
    bool_cols={"is_pristine"},
    int_cols={"year", "n_dings", "n_markers_front", "n_markers_back", "n_files_uploaded", "n_files_unavailable"},
)
CORNER_SCHEMA = _schema(labels.CORNER_COLUMNS, string_cols={"cert", "side", "corner", "crop_path"})
EDGE_SCHEMA = _schema(labels.EDGE_COLUMNS, string_cols={"cert", "side", "edge", "crop_path"})
SURFACE_SCHEMA = _schema(
    labels.SURFACE_COLUMNS,
    string_cols={"cert", "side", "type_name", "subtype_name", "family", "engine_type", "location", "source"},
    bool_cols={"is_rollup"},
)
DING_SCHEMA = _schema(
    labels.DING_COLUMNS,
    string_cols={"cert", "side", "type_name", "engine_type", "location", "crop_path"},
    int_cols={"ordering"},
)
SPLITS_SCHEMA = {c: "string" for c in SPLIT_COLUMNS}


def _frame(rows: list[dict], columns: list[str], schema: dict[str, str] | None = None) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=columns)[columns]
    if schema:
        df = df.astype(schema)
    return df


def build(store: Store, out_dir: str, seed: int = 42, splits_path: str | Path | None = None) -> dict[str, int]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # The frozen test/val/train split lives at a tracked, cwd-relative path by default
    # (scripts/tag-dataset/splits/splits.parquet) so it survives in git across machines and
    # rebuilds, rather than only inside gitignored data/dataset/.
    sp = Path(splits_path) if splits_path is not None else DEFAULT_SPLITS_PATH
    sp.parent.mkdir(parents=True, exist_ok=True)

    cards, corners, edges, markers, dings = [], [], [], [], []
    for cert, detail, score in store.iter_raw_ok():
        try:
            counts = {"uploaded": len(store.files_for(cert)), "unavailable": len(store.gone_files(cert))}
            cards.append(labels.card_row(cert, detail, score, counts))
            corners.extend(labels.corner_rows(cert, score))
            edges.extend(labels.edge_rows(cert, score))
            markers.extend(labels.surface_rows(cert, score))
            dings.extend(labels.ding_rows(cert, detail))
        except Exception as e:
            raise RuntimeError(f"cert {cert}: {e}") from e

    manifest = _frame(cards, labels.MANIFEST_COLUMNS, MANIFEST_SCHEMA)
    existing = pd.read_parquet(sp) if sp.exists() else None
    n_before = len(existing) if existing is not None else 0
    splits = assign_splits(manifest, existing, seed=seed) if len(manifest) else (
        existing if existing is not None else pd.DataFrame(columns=SPLIT_COLUMNS))
    splits = splits.astype(SPLITS_SCHEMA)

    manifest.to_parquet(out / "manifest.parquet", index=False)
    _frame(corners, labels.CORNER_COLUMNS, CORNER_SCHEMA).to_parquet(out / "corners.parquet", index=False)
    _frame(edges, labels.EDGE_COLUMNS, EDGE_SCHEMA).to_parquet(out / "edges.parquet", index=False)
    _frame(markers, labels.SURFACE_COLUMNS, SURFACE_SCHEMA).to_parquet(out / "surface.parquet", index=False)
    _frame(dings, labels.DING_COLUMNS, DING_SCHEMA).to_parquet(out / "dings.parquet", index=False)
    splits.to_parquet(sp, index=False)
    # Also write a copy alongside the other tables so `stats` (and anything else reading
    # out_dir) keeps working unchanged, without out_dir being the authoritative location.
    splits.to_parquet(out / "splits.parquet", index=False)

    return {"cards": len(manifest), "corners": len(corners), "edges": len(edges), "markers": len(markers),
            "dings": len(dings), "splits_new": len(splits) - n_before, "splits_total": len(splits)}
