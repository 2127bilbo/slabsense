import io
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from PIL import Image

from conftest import FakeReader, make_boxes_table, orange_card_png
from trainlib import card_cutouts as cc
from trainlib import cache
from trainlib import surface_tables as st


def test_rounded_alpha_removes_orange_corner_notches():
    # card with rounded corners: orange trim margin 20 + orange quarter-circle notches of radius 30 at the box corners
    w, h, m, r = 300, 400, 20, 30
    arr = np.zeros((h, w, 3), np.uint8); arr[...] = (247, 126, 44)
    arr[m:h-m, m:w-m] = (200, 190, 60)
    yy, xx = np.mgrid[0:h, 0:w]
    for cy, cx in ((m, m), (m, w-1-m), (h-1-m, m), (h-1-m, w-1-m)):
        cyy = cy + (r if cy == m else -r); cxx = cx + (r if cx == m else -r)
        notch = ((xx - cxx)**2 + (yy - cyy)**2 > r*r) & (abs(xx - cx) < r) & (abs(yy - cy) < r) & (xx >= m) & (xx < w-m) & (yy >= m) & (yy < h-m)
        arr[notch] = (247, 126, 44)
    box = (m, m, w - m, h - m)
    crop = arr[box[1]:box[3], box[0]:box[2]]
    a = cc.rounded_alpha(crop)
    assert a.shape == crop.shape[:2] and a[a.shape[0]//2, a.shape[1]//2] == 255
    assert a[0, 0] == 0 and a[0, -1] == 0 and a[-1, 0] == 0 and a[-1, -1] == 0     # notches transparent
    assert a[5, a.shape[1]//2] == 255                                                # straight edge stays opaque
    assert 0 < a[0, r] < 255 or a[1, r] in (0, 255)                                  # feathered somewhere near the edge


def test_make_cutout_scales_to_long_side_and_keeps_alpha():
    img = Image.open(io.BytesIO(orange_card_png(400, 600, margin=50)))
    out = cc.make_cutout(img, (50, 50, 350, 550), long_side=200)
    assert out.mode == "RGBA" and max(out.size) == 200 and out.size == (120, 200)
    assert np.asarray(out)[100, 60, 3] == 255


def test_cutout_path_layout():
    assert cc.cutout_path(Path("/cache"), "A1", "F") == Path("/cache/cutouts/A1_F.png")


def _write_config(tmp_path, ds, sp):
    (tmp_path / "ds.toml").write_text(
        '[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8"
    )
    cfg = tmp_path / "config.toml"
    cfg.write_text(
        f'[paths]\ndataset_dir = "{ds.as_posix()}"\nsplits_path = "{sp.as_posix()}"\n'
        f'cache_dir = "cache"\nruns_dir = "runs"\n[r2]\nconfig_toml = "ds.toml"\n',
        encoding="utf-8",
    )
    return cfg


def _rgb_train_sides(ds, sp):
    sides, _ = st.load_surface_split(ds, sp, "train")
    return sides[sides.view == "rgb"].reset_index(drop=True)


def test_cli_writes_cutouts_and_skips_existing(surface_tables, tmp_path):
    ds, sp = surface_tables
    cfg = _write_config(tmp_path, ds, sp)
    rgb_sides = _rgb_train_sides(ds, sp)
    cache_dir = tmp_path / "cache"
    for key in rgb_sides.image_key:
        p = cache.cache_path(cache_dir, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(orange_card_png(400, 600, margin=50))
    make_boxes_table(tmp_path, rgb_sides, box=(50, 50, 350, 550), W=400, H=600)

    existing = cc.cutout_path(cache_dir, rgb_sides.iloc[0].cert, rgb_sides.iloc[0].side)
    existing.parent.mkdir(parents=True, exist_ok=True)
    existing.write_bytes(b"stub")

    counts = cc.main(["--config", str(cfg), "--splits", "train", "--workers", "1", "--from-cache"])

    assert counts["skipped"] == 1
    assert counts["written"] == len(rgb_sides) - 1
    assert counts["failed"] == 0 and counts["missing"] == 0
    for _, r in rgb_sides.iloc[1:].iterrows():
        out = cc.cutout_path(cache_dir, r.cert, r.side)
        assert out.exists()
        with Image.open(out) as im:
            assert im.mode == "RGBA"
    # skipped output was left untouched
    assert existing.read_bytes() == b"stub"


def test_cli_from_cache_counts_missing_without_touching_r2(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    cfg = _write_config(tmp_path, ds, sp)
    rgb_sides = _rgb_train_sides(ds, sp)
    make_boxes_table(tmp_path, rgb_sides, box=(50, 50, 350, 550), W=400, H=600)

    def boom(cfg):
        raise RuntimeError("must not touch R2 in --from-cache mode")

    monkeypatch.setattr(cc, "reader_from_config", boom)
    counts = cc.main(["--config", str(cfg), "--splits", "train", "--workers", "1", "--from-cache"])
    assert counts == {"written": 0, "skipped": 0, "failed": 0, "missing": len(rgb_sides)}


def test_cli_fetches_from_r2_when_not_cached_locally(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    cfg = _write_config(tmp_path, ds, sp)
    rgb_sides = _rgb_train_sides(ds, sp)
    make_boxes_table(tmp_path, rgb_sides, box=(50, 50, 350, 550), W=400, H=600)

    objects = {key: orange_card_png(400, 600, margin=50) for key in rgb_sides.image_key}
    reader = FakeReader(objects)
    monkeypatch.setattr(cc, "reader_from_config", lambda cfg: reader)

    counts = cc.main(["--config", str(cfg), "--splits", "train", "--workers", "1"])
    assert counts["written"] == len(rgb_sides) and counts["failed"] == 0 and counts["missing"] == 0
    assert sorted(reader.calls) == sorted(rgb_sides.image_key.tolist())


def test_cli_skips_sides_whose_box_is_not_ok(surface_tables, tmp_path):
    ds, sp = surface_tables
    cfg = _write_config(tmp_path, ds, sp)
    rgb_sides = _rgb_train_sides(ds, sp)
    cache_dir = tmp_path / "cache"
    for key in rgb_sides.image_key:
        p = cache.cache_path(cache_dir, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(orange_card_png(400, 600, margin=50))
    first = rgb_sides.iloc[0]
    make_boxes_table(tmp_path, rgb_sides, box=(50, 50, 350, 550), W=400, H=600,
                     not_ok=[(first.cert, first.side)])

    counts = cc.main(["--config", str(cfg), "--splits", "train", "--workers", "1", "--from-cache"])
    assert counts["written"] == len(rgb_sides) - 1
    assert not cc.cutout_path(cache_dir, first.cert, first.side).exists()
