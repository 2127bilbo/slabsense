import numpy as np
import pytest
from PIL import Image

from conftest import FakeReader, make_boxes_table, orange_card_png, png_bytes
from trainlib import cache, cache_cli, tables
from trainlib import surface_tables as st


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


def _capture_build_cache(monkeypatch, calls):
    def fake_build_cache(reader, keys, cache_dir, workers, progress, resize=None, **kwargs):
        calls.append({"resize": resize})
        return {"downloaded": 0, "skipped": 0, "failed": 0}

    monkeypatch.setattr(cache_cli, "build_cache", fake_build_cache)
    monkeypatch.setattr(cache_cli, "reader_from_config", lambda cfg: object())


def test_cache_cli_passes_task_resize_for_edges(tables, tmp_path, monkeypatch):
    ds, sp = tables
    cfg = _write_config(tmp_path, ds, sp)
    calls = []
    _capture_build_cache(monkeypatch, calls)
    cache_cli.main(["--config", str(cfg), "--task", "edges"])
    assert calls == [{"resize": (1024, 192)}]


def test_cache_cli_no_resize_flag_forces_full_resolution(tables, tmp_path, monkeypatch):
    ds, sp = tables
    cfg = _write_config(tmp_path, ds, sp)
    calls = []
    _capture_build_cache(monkeypatch, calls)
    cache_cli.main(["--config", str(cfg), "--task", "edges", "--no-resize"])
    assert calls == [{"resize": None}]


def test_cache_cli_corners_has_no_resize_by_default(tables, tmp_path, monkeypatch):
    ds, sp = tables
    cfg = _write_config(tmp_path, ds, sp)
    calls = []
    _capture_build_cache(monkeypatch, calls)
    cache_cli.main(["--config", str(cfg), "--task", "corners"])
    assert calls == [{"resize": None}]


def test_cache_cli_from_cache_resizes_from_local_full_res_files(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    cfg = _write_config(tmp_path, ds, sp)
    cache_dir = tmp_path / "cache"
    keys = tables.load_task_table("surface_sfx", ds, sp, "train").crop_path.tolist()
    for key in keys:
        p = cache.cache_path(cache_dir, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(png_bytes(20, 30))
    reader = FakeReader({})
    monkeypatch.setattr(cache_cli, "reader_from_config", lambda cfg: reader)
    cache_cli.main(["--config", str(cfg), "--task", "surface_sfx", "--splits", "train",
                    "--from-cache", "--workers", "1"])
    assert reader.calls == []
    for key in keys:
        dest = cache.resized_path(cache_dir, key, (896, 1248))
        assert dest.exists()
        with Image.open(dest) as im:
            assert im.size == (896, 1248)


def test_cache_cli_from_cache_needs_no_reader_when_all_files_are_local(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    cfg = _write_config(tmp_path, ds, sp)
    cache_dir = tmp_path / "cache"
    for key in tables.load_task_table("surface_sfx", ds, sp, "train").crop_path:
        p = cache.cache_path(cache_dir, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(png_bytes(20, 30))

    def boom(cfg):
        raise RuntimeError("Set B2_KEY_ID and B2_APP_KEY in the environment")

    monkeypatch.setattr(cache_cli, "reader_from_config", boom)
    counts = cache_cli.main(["--config", str(cfg), "--task", "surface_sfx", "--splits", "train",
                             "--from-cache", "--workers", "1"])
    assert counts["failed"] == 0 and counts["downloaded"] == 3


def test_cache_cli_rejects_from_cache_with_no_resize(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    cfg = _write_config(tmp_path, ds, sp)
    monkeypatch.setattr(cache_cli, "reader_from_config", lambda cfg: FakeReader({}))
    with pytest.raises(SystemExit):
        cache_cli.main(["--config", str(cfg), "--task", "surface_sfx", "--splits", "train",
                        "--from-cache", "--no-resize"])


def test_cache_cli_centering_uses_card_boxes_and_variant(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    cfg = _write_config(tmp_path, ds, sp)
    sides, _ = st.load_surface_split(ds, sp, "train")
    rgb = sides[sides.view == "rgb"]
    make_boxes_table(tmp_path, rgb, box=(50, 50, 350, 550), W=400, H=600, not_ok=[("B2", "B")])
    monkeypatch.setenv("TRAINLIB_BOXES", str(tmp_path / "derived" / "centering_boxes_rgb.parquet"))
    for key in rgb.image_key:
        p = cache.cache_path(tmp_path / "cache", key); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(orange_card_png(400, 600, margin=50))
    monkeypatch.setattr(cache_cli, "reader_from_config", lambda cfg: FakeReader({}))
    cache_cli.main(["--config", str(cfg), "--task", "centering_rgb", "--splits", "train", "--from-cache", "--workers", "1"])
    done = [k for k in rgb.image_key if cache.resized_path(tmp_path / "cache", k, (896, 1248), "card").exists()]
    assert len(done) == 3                                       # the not-ok side is skipped
    with Image.open(cache.resized_path(tmp_path / "cache", done[0], (896, 1248), "card")) as im:
        assert im.size == (896, 1248) and np.asarray(im.convert("RGB"))[..., 0].max() < 200
