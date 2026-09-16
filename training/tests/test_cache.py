from conftest import FakeReader
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
