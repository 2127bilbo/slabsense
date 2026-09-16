import pandas as pd
from PIL import Image

from conftest import FakeReader, make_cache, make_tables
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
