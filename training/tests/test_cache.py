from pathlib import Path

import pandas as pd
from PIL import Image

from conftest import FakeReader, make_cache, make_tables, png_bytes
from trainlib import cache


def test_build_cache_downloads_skips_and_records_failures(tmp_path):
    reader = FakeReader({"tag-dataset/A1/x.png": b"abc", "tag-dataset/A1/y.png": b"defg", "tag-dataset/B2/z.png": b"q"})
    reader.fail.add("tag-dataset/B2/z.png")
    counts = cache.build_cache(reader, list(reader.objects), tmp_path / "c", workers=2)
    assert counts == {"downloaded": 2, "skipped": 0, "failed": 1}
    assert (tmp_path / "c" / "tag-dataset" / "A1" / "x.png").read_bytes() == b"abc"
    reader.calls.clear(); reader.fail.clear()
    counts = cache.build_cache(reader, list(reader.objects), tmp_path / "c", workers=2)
    assert counts == {"downloaded": 1, "skipped": 2, "failed": 0}
    assert reader.calls == ["tag-dataset/B2/z.png"]


def test_build_cache_redownloads_wrong_size(tmp_path):
    reader = FakeReader({"k.png": b"12345"})
    p = cache.cache_path(tmp_path / "c", "k.png"); p.parent.mkdir(parents=True); p.write_bytes(b"12")
    assert cache.build_cache(reader, ["k.png"], tmp_path / "c") == {"downloaded": 1, "skipped": 0, "failed": 0}
    assert p.read_bytes() == b"12345"


def test_build_cache_writes_atomically(tmp_path):
    reader = FakeReader({"k.png": b"12345"})
    cache.build_cache(reader, ["k.png"], tmp_path / "c")
    assert not list((tmp_path / "c").rglob("*.part"))


def test_build_cache_duplicate_keys_download_once(tmp_path):
    reader = FakeReader({"k.png": b"12345"})
    counts = cache.build_cache(reader, ["k.png", "k.png", "k.png"], tmp_path / "c")
    assert counts == {"downloaded": 1, "skipped": 0, "failed": 0}
    assert reader.calls == ["k.png"]


def _png_size(path):
    with Image.open(path) as im:
        return im.size


def test_make_cache_picks_edge_letter_not_side_letter(tmp_path):
    ds, _ = make_tables(tmp_path)
    edges = pd.read_parquet(ds / "edges.parquet")

    vertical_cache = make_cache(tmp_path / "vertical", edges, 3296, 550, vertical_for_lr=True)
    assert _png_size(vertical_cache / "tag-dataset/A1/edge_FL.png") == (550, 3296)
    assert _png_size(vertical_cache / "tag-dataset/A1/edge_FT.png") == (3296, 550)

    flat_cache = make_cache(tmp_path / "flat", edges, 3296, 550, vertical_for_lr=False)
    assert _png_size(flat_cache / "tag-dataset/A1/edge_FL.png") == (3296, 550)
    assert _png_size(flat_cache / "tag-dataset/A1/edge_FT.png") == (3296, 550)


def test_resized_path_layout():
    p = cache.resized_path(Path("/c"), "tag-dataset/A1/corner_FTL.png", (1024, 192))
    assert p == Path("/c/resized/1024x192/tag-dataset/A1/corner_FTL.jpg")


def test_build_cache_resize_rotates_vertical_strip_and_writes_jpeg(tmp_path):
    reader = FakeReader({"tag-dataset/A1/edge_FL.png": png_bytes(550, 4992)})
    counts = cache.build_cache(reader, ["tag-dataset/A1/edge_FL.png"], tmp_path / "c",
                               workers=2, resize=(1024, 192))
    assert counts == {"downloaded": 1, "skipped": 0, "failed": 0}
    dest = cache.resized_path(tmp_path / "c", "tag-dataset/A1/edge_FL.png", (1024, 192))
    assert dest.exists() and dest.suffix == ".jpg"
    with Image.open(dest) as im:
        assert im.size == (1024, 192)
        assert im.format == "JPEG"


def test_build_cache_resize_no_rotation_needed_for_horizontal_strip(tmp_path):
    reader = FakeReader({"tag-dataset/A1/edge_FT.png": png_bytes(3296, 550)})
    cache.build_cache(reader, ["tag-dataset/A1/edge_FT.png"], tmp_path / "c",
                      workers=2, resize=(1024, 192))
    dest = cache.resized_path(tmp_path / "c", "tag-dataset/A1/edge_FT.png", (1024, 192))
    with Image.open(dest) as im:
        assert im.size == (1024, 192)


def test_build_cache_resize_skips_when_resized_file_already_exists(tmp_path):
    key = "tag-dataset/A1/edge_FT.png"
    reader = FakeReader({key: png_bytes(3296, 550)})
    cache.build_cache(reader, [key], tmp_path / "c", resize=(1024, 192))
    reader.calls.clear()
    counts = cache.build_cache(reader, [key], tmp_path / "c", resize=(1024, 192))
    assert counts == {"downloaded": 0, "skipped": 1, "failed": 0}
    assert reader.calls == []


def test_build_cache_resize_does_not_write_full_res_copy(tmp_path):
    key = "tag-dataset/A1/edge_FT.png"
    reader = FakeReader({key: png_bytes(3296, 550)})
    cdir = tmp_path / "c"
    cache.build_cache(reader, [key], cdir, resize=(1024, 192))
    assert not cache.cache_path(cdir, key).exists()
    assert not list(cdir.rglob("*.part"))
