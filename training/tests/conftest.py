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


def make_cache(tmp_path: Path, table: pd.DataFrame, w: int, h: int, vertical_for_lr: bool = False,
              resized: bool = False, resize_size: tuple[int, int] = (1024, 192)) -> Path:
    """Write PNGs at the full-res path, or (resized=True) JPEGs at the resized path — mirroring
    the production rotate-then-resize rule so dataset tests can exercise both cache modes."""
    cache = tmp_path / "cache"
    rw, rh = resize_size
    for p in table.crop_path:
        stem = Path(p).stem
        edge = stem[-1]
        vertical = vertical_for_lr and stem.startswith("edge_") and edge in "LR"
        ww, hh = (h, w) if vertical else (w, h)
        if resized:
            dest = cache / "resized" / f"{rw}x{rh}" / Path(p).with_suffix(".jpg")
            dest.parent.mkdir(parents=True, exist_ok=True)
            arr = np.full((hh, ww, 3), 128, dtype=np.uint8)
            img = Image.fromarray(arr)
            if img.height > img.width:
                img = img.transpose(Image.Transpose.ROTATE_90)
            img = img.resize((rw, rh), Image.Resampling.LANCZOS)
            img.save(dest, format="JPEG", quality=95)
        else:
            dest = cache / p
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(png_bytes(ww, hh))
    return cache


@pytest.fixture
def tables(tmp_path):
    return make_tables(tmp_path)


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
        "path_front": [f"tag-dataset/{c}/front.jpg" for c in certs],
        "path_back": [f"tag-dataset/{c}/back.jpg" for c in certs],
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
        view = "sfx" if i % 2 == 0 else "rgb"
        name = f"C{i}_F_{view}_0_0.jpg"
        Image.fromarray(arr).save(out / name, format="JPEG", quality=95, subsampling=0)
        boxes = [] if i == n - 1 else [[i % 7 + 1, float(x1), float(y1), float(x1 + 40), float(y1 + 30)]]
        rows.append({"tile_path": f"tiles/train/{name}", "cert": f"C{i}", "side": "F", "view": view,
                     "grade_label": ["9 MINT", "1 POOR", "5 EXCELLENT", "7 NEAR MINT"][i % 4],
                     "x0": 0, "y0": 0, "tile_w": size, "tile_h": size, "n_boxes": len(boxes), "boxes": json.dumps(boxes)})
    idx = pd.DataFrame(rows)
    idx.to_parquet(cache / "tiles" / "train.parquet", index=False)
    return cache, idx
