import io

import numpy as np
import pandas as pd
from PIL import Image

from conftest import orange_card_png
from trainlib import cache, centering_prep as cp
from trainlib import surface_tables as st


def test_detect_card_box_finds_the_orange_margins():
    img = Image.open(io.BytesIO(orange_card_png(400, 600, margin=50)))
    box, ok = cp.detect_card_box(img)
    assert ok and box == (50, 50, 350, 550)


def test_detect_card_box_rejects_missing_or_huge_margins():
    plain = Image.fromarray(np.full((600, 400, 3), 120, dtype=np.uint8))
    box, ok = cp.detect_card_box(plain)
    assert not ok and box == (0, 0, 400, 600)
    big = Image.open(io.BytesIO(orange_card_png(400, 600, margin=250)))
    assert cp.detect_card_box(big)[1] is False


def test_measure_boxes_writes_one_row_per_cached_side(surface_tables, tmp_path):
    ds, sp = surface_tables
    cache_dir = tmp_path / "cache"
    sides, _ = st.load_surface_split(ds, sp, "train")
    sides = sides[sides.view == "rgb"].reset_index(drop=True)
    for key in sides.image_key.iloc[:3]:                       # leave the 4th image missing
        p = cache.cache_path(cache_dir, key); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(orange_card_png(400, 600, margin=40))
    df = cp.measure_boxes(cache_dir, sides, workers=1)
    assert list(df.columns) == ["cert", "side", "image_key", "W", "H", "x0", "y0", "x1", "y1", "ok"]
    assert len(df) == 3 and df.attrs["missing"] == 1
    assert df.ok.all() and (df.x0 == 40).all() and (df.x1 == 360).all() and (df.H == 600).all()


def test_cli_writes_parquet(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\n[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    sides, _ = st.load_surface_split(ds, sp, "train")
    for key in sides[sides.view == "rgb"].image_key:
        p = cache.cache_path(tmp_path / "cache", key); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(orange_card_png(400, 600))
    out = tmp_path / "derived" / "boxes.parquet"
    cp.main(["--config", str(cfg), "--view", "rgb", "--splits", "train", "--workers", "1", "--out", str(out)])
    df = pd.read_parquet(out)
    assert len(df) == 4 and df.ok.all()
