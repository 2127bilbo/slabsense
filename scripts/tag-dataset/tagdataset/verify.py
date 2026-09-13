"""Compare what the store says should exist with what landed (spec §5.4)."""
from __future__ import annotations

import pandas as pd

from .files import expected_files
from .store import Store

MISSING_COLUMNS = ["cert", "name", "url", "reason"]


def verify(store: Store, bucket=None) -> pd.DataFrame:
    in_bucket = bucket.list_keys() if bucket is not None else None
    rows = []
    for cert, detail, score in store.iter_raw_ok():
        have = store.files_for(cert)
        for name, url in expected_files(detail, score):
            if name not in have:
                rows.append((cert, name, url, "not_in_files_table"))
            elif in_bucket is not None and (cert, name) not in in_bucket:
                rows.append((cert, name, url, "missing_in_bucket"))
    return pd.DataFrame(rows, columns=MISSING_COLUMNS)


def completeness_by_grade(store: Store, missing: pd.DataFrame) -> pd.DataFrame:
    missing_by_cert = missing.groupby("cert").size().to_dict() if len(missing) else {}
    rows = []
    for cert, detail, score in store.iter_raw_ok():
        n_expected = len(expected_files(detail, score))
        n_missing = missing_by_cert.get(cert, 0)
        rows.append({"grade_key": store.grade_key_for(cert) or "?", "cert": cert,
                     "expected": n_expected, "missing": n_missing, "complete": n_missing == 0})
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["grade_key", "cards", "expected_files", "missing_files", "complete_cards"])
    out = df.groupby("grade_key").agg(cards=("cert", "count"), expected_files=("expected", "sum"),
                                      missing_files=("missing", "sum"), complete_cards=("complete", "sum"))
    return out.reset_index()
