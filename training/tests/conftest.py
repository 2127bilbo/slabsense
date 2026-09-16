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
    k = 0
    for i, cert in enumerate(certs):
        for side in "FB":
            for c in ("TL", "TR", "BL", "BR"):
                corners.append({"cert": cert, "side": side, "corner": c,
                                "score_angle": float("nan") if side == "B" else 990.0 - i,
                                "score_fill": 1000.0 - 10 * i, "score_fray": 950.0 + i,
                                "fill_px": 1.0, "fray_px": 0.0, "angle_deg": 90.0,
                                "ding_count": k % 3, "marker_deduction": 40.0 + 10 * k,
                                "marker_source": "rollup" if k % 2 == 0 else "constituent",
                                "crop_path": f"tag-dataset/{cert}/corner_{side}{c}.png"})
                k += 1
    # one slot with no ding data at all (ding_count NaN); two slots with no marker at all
    corners[5]["ding_count"] = None
    corners[2]["marker_deduction"] = float("nan"); corners[2]["marker_source"] = None
    corners[7]["marker_deduction"] = float("nan"); corners[7]["marker_source"] = None

    k = 0
    for i, cert in enumerate(certs):
        for side in "FB":
            for e in "TBLR":
                edges.append({"cert": cert, "side": side, "edge": e, "score_fill": 999.0 - i, "score_fray": 1000.0,
                              "fill_px": 0.0, "fray_px": 0.0,
                              "ding_count": (k + 1) % 3, "marker_deduction": 25.0 + 5 * k,
                              "marker_source": "constituent" if k % 2 == 0 else "rollup",
                              "crop_path": f"tag-dataset/{cert}/edge_{side}{e}.png"})
                k += 1
    edges[3]["ding_count"] = None
    edges[9]["marker_deduction"] = float("nan"); edges[9]["marker_source"] = None

    corners_df = pd.DataFrame(corners)
    corners_df["ding_count"] = corners_df["ding_count"].astype("Int64")
    corners_df["marker_deduction"] = corners_df["marker_deduction"].astype("float64")
    corners_df["marker_source"] = corners_df["marker_source"].astype("string")
    corners_df.to_parquet(ds / "corners.parquet", index=False)

    edges_df = pd.DataFrame(edges)
    edges_df["ding_count"] = edges_df["ding_count"].astype("Int64")
    edges_df["marker_deduction"] = edges_df["marker_deduction"].astype("float64")
    edges_df["marker_source"] = edges_df["marker_source"].astype("string")
    edges_df.to_parquet(ds / "edges.parquet", index=False)

    pd.DataFrame({"cert": list(certs), "grade_label": list(grades), "era": ["1999-2003"] * len(certs)}).to_parquet(ds / "manifest.parquet", index=False)
    sp = tmp_path / "splits.parquet"
    pd.DataFrame({"cert": list(certs), "split": list(splits), "stratum": ["x"] * len(certs), "assigned_at": ["t"] * len(certs)}).to_parquet(sp, index=False)
    return ds, sp


def make_cache(tmp_path: Path, table: pd.DataFrame, w: int, h: int, vertical_for_lr: bool = False) -> Path:
    cache = tmp_path / "cache"
    for p in table.crop_path:
        dest = cache / p; dest.parent.mkdir(parents=True, exist_ok=True)
        stem = Path(p).stem
        edge = stem[-1]
        vertical = vertical_for_lr and stem.startswith("edge_") and edge in "LR"
        ww, hh = (h, w) if vertical else (w, h)
        dest.write_bytes(png_bytes(ww, hh))
    return cache


@pytest.fixture
def tables(tmp_path):
    return make_tables(tmp_path)
