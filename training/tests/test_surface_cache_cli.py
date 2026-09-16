import json

import numpy as np
import pandas as pd
from PIL import Image

from conftest import FakeReader, png_bytes
from trainlib import surface_cache_cli as scc
from trainlib import surface_tables as st


def _image(w, h):
    return png_bytes(w, h, 120)


def test_pull_caches_every_side_image_for_requested_splits(surface_tables, tmp_path):
    ds, sp = surface_tables
    cache = tmp_path / "cache"
    sides, _ = st.load_surface_split(ds, sp, "train")
    reader = FakeReader({k: _image(64, 64) for k in sides.image_key})
    counts = scc.pull(reader, ds, sp, cache, "train", workers=2)
    assert counts["downloaded"] == 8
    assert all((cache / k).exists() for k in sides.image_key)


def test_tile_writes_tiles_and_index(surface_tables, tmp_path):
    ds, sp = surface_tables
    cache = tmp_path / "cache"
    sides, boxes = st.load_surface_split(ds, sp, "train")
    for k in sides.image_key:
        p = cache / k; p.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.full((2100, 2000, 3), 120, dtype=np.uint8)).save(p, format="JPEG")
    idx = scc.build_tile_index(cache, "train", sides, boxes, workers=1, seed=0, neg_per_side=1)
    assert (cache / "tiles" / "train.parquet").exists()
    assert list(idx.columns) == ["tile_path", "cert", "side", "view", "grade_label", "x0", "y0", "tile_w", "tile_h", "n_boxes", "boxes"]
    # A1/F in a 2000x2100 image: crease at px (200,210)-(300,630) lands in tile (0,0) only;
    # the dent at px (1000,1050)-(1080,1113) lands in the four tiles around (896..976, 896..1076).
    a1f = idx[(idx.cert == "A1") & (idx.side == "F")]
    sfx = a1f[a1f.view == "sfx"]; rgb = a1f[a1f.view == "rgb"]
    assert (a1f.n_boxes > 0).all()
    first = sfx[(sfx.x0 == 0) & (sfx.y0 == 0)].iloc[0]
    assert json.loads(first.boxes) == [[1, 200.0, 210.0, 300.0, 630.0]]
    assert first.tile_path == "tiles/train/A1_F_sfx_0_0.jpg"
    sfx_labels = {b[0] for bx in sfx.boxes for b in json.loads(bx)}
    rgb_labels = {b[0] for bx in rgb.boxes for b in json.loads(bx)}
    assert sfx_labels == {1, 2} and rgb_labels == {1}          # dent only in the sfx view
    assert len(rgb) == 1 and len(sfx) == 5
    # every tile file exists at the recorded path and is 1024x1024 (image larger than a tile on both axes)
    for _, r in idx.iterrows():
        with Image.open(cache / r.tile_path) as im:
            assert im.size == (r.tile_w, r.tile_h) == (1024, 1024)
    # negatives only come from side-views with zero kept boxes: none in train (every train side has a box). Check val.
    sides_v, boxes_v = st.load_surface_split(ds, sp, "val")
    for k in sides_v.image_key:
        p = cache / k; p.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.full((2100, 2000, 3), 120, dtype=np.uint8)).save(p, format="JPEG")
    idx_v = scc.build_tile_index(cache, "val", sides_v, boxes_v, workers=1, seed=0, neg_per_side=1)
    assert len(idx_v) == 4 and (idx_v.n_boxes == 0).all() and (idx_v.boxes == "[]").all()
    assert sorted(idx_v.view.unique()) == ["rgb", "sfx"]


def test_tile_skips_sides_without_cached_image_and_is_resumable(surface_tables, tmp_path):
    ds, sp = surface_tables
    cache = tmp_path / "cache"
    sides, boxes = st.load_surface_split(ds, sp, "train")
    k = sides.image_key.iloc[0]
    p = cache / k; p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.full((1100, 1100, 3), 120, dtype=np.uint8)).save(p, format="JPEG")
    idx = scc.build_tile_index(cache, "train", sides, boxes, workers=1, seed=0, neg_per_side=1)
    assert set(idx.cert) == {sides.cert.iloc[0]} and set(idx.side) == {sides.side.iloc[0]} and set(idx.view) == {sides.view.iloc[0]}
    first = (cache / idx.tile_path.iloc[0]).stat().st_mtime_ns
    idx2 = scc.build_tile_index(cache, "train", sides, boxes, workers=1, seed=0, neg_per_side=1)
    assert (cache / idx2.tile_path.iloc[0]).stat().st_mtime_ns == first   # existing tile not rewritten
    assert idx2.equals(idx)


def test_tile_survives_corrupt_cached_image(surface_tables, tmp_path):
    ds, sp = surface_tables
    cache = tmp_path / "cache"
    sides, boxes = st.load_surface_split(ds, sp, "train")
    bad_key = sides.image_key.iloc[0]
    for k in sides.image_key:
        p = cache / k; p.parent.mkdir(parents=True, exist_ok=True)
        if k == bad_key:
            p.write_bytes(b"not a real image")
        else:
            Image.fromarray(np.full((2100, 2000, 3), 120, dtype=np.uint8)).save(p, format="JPEG")
    idx = scc.build_tile_index(cache, "train", sides, boxes, workers=1, seed=0, neg_per_side=1)
    assert (cache / "tiles" / "train.parquet").exists()
    assert idx.attrs["failed_sides"] == 1
    bad_row = sides[sides.image_key == bad_key].iloc[0]
    # the corrupt side-view contributes no rows; every other side-view still produced tiles
    assert not ((idx.cert == bad_row.cert) & (idx.side == bad_row.side) & (idx.view == bad_row.view)).any()
    assert len(idx) > 0
    assert set(zip(idx.cert, idx.side, idx.view)) == {
        (r.cert, r.side, r.view) for r in sides.itertuples() if r.image_key != bad_key
    }


def test_cli_parses_splits_with_limits(monkeypatch, tmp_path):
    seen = {}
    monkeypatch.setattr(scc, "_run_pull", lambda cfg, split, limit, workers, seed: seen.setdefault("pull", []).append((split, limit)))
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\n[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    scc.main(["pull", "--config", str(cfg), "--splits", "train:500,val"])
    assert seen["pull"] == [("train", 500), ("val", None)]
