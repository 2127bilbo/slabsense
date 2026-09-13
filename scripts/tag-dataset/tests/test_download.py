import asyncio
import hashlib

from conftest import FakeSession
from tagdataset import download, files
from tagdataset.store import Store


def run(coro):
    return asyncio.run(coro)


async def no_sleep(_):
    pass


def seeded_store(tmp_path, detail_fixture, score_fixture):
    store = Store(str(tmp_path / "t.sqlite"))
    store.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    return store


def test_pending_files_lists_everything_then_nothing(tmp_path, detail_fixture, score_fixture):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    expected = files.expected_files(detail_fixture, score_fixture)
    pending = download.pending_files(store)
    assert [(c, n, u) for c, n, u in pending] == [("C1240631", n, u) for n, u in expected]
    for name, url in expected:
        store.put_file("C1240631", name, url, 1, "h")
    assert download.pending_files(store) == []


def test_pending_files_filters_by_cert(tmp_path, detail_fixture, score_fixture):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    assert download.pending_files(store, only_certs={"OTHER"}) == []
    assert len(download.pending_files(store, only_certs={"C1240631"})) > 0


def test_download_one_uploads_and_records(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = detail_fixture["data"]["imageFileDeskewedFront"]
    body = b"\xff\xd8jpegbytes"
    session = FakeSession({url: body})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       asyncio.Semaphore(4), no_sleep))
    assert result == "ok"
    assert fake_bucket.objects["tag-dataset/C1240631/front.jpg"] == (body, "image/jpeg")
    assert store.has_file("C1240631", "front.jpg")
    row = store.conn.execute("SELECT bytes, sha256 FROM files WHERE cert='C1240631' AND name='front.jpg'").fetchone()
    assert row == (len(body), hashlib.sha256(body).hexdigest())


def test_download_one_png_content_type(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = score_fixture["data"]["imageFileFTL"]
    session = FakeSession({url: b"\x89PNG"})
    run(download.download_one(session, fake_bucket, store, "C1240631", "corner_FTL.png", url,
                              asyncio.Semaphore(4), no_sleep))
    assert fake_bucket.objects["tag-dataset/C1240631/corner_FTL.png"][1] == "image/png"


def test_download_one_retries_then_fails(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [503, 503, 503, 503]})
    slept = []

    async def sleep(s):
        slept.append(s)

    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       asyncio.Semaphore(4), sleep))
    assert result == "failed"
    assert slept == [1, 4, 16]
    assert not store.has_file("C1240631", "front.jpg")
    assert store.list_failures("download") == [("C1240631", "front.jpg", "HTTP 503", 1)]


def test_download_one_recovers_after_transient_error(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [ConnectionError("reset"), b"ok"]})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       asyncio.Semaphore(4), no_sleep))
    assert result == "ok"
    assert store.list_failures("download") == []


def test_download_one_bucket_failure_is_retried_and_recorded(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    fake_bucket.fail_names.add("front.jpg")
    url = "https://cdn/x.jpg"
    session = FakeSession({url: b"ok"})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       asyncio.Semaphore(4), no_sleep))
    assert result == "failed"
    assert store.list_failures("download")[0][2].startswith("RuntimeError")


def test_run_download_processes_all_pending(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    items = download.pending_files(store)
    session = FakeSession({url: b"data-" + name.encode() for _, name, url in items})
    counts = run(download.run_download(session, fake_bucket, store, items, concurrency=4, sleep=no_sleep))
    assert counts == {"ok": len(items), "failed": 0}
    assert download.pending_files(store) == []
    assert len(fake_bucket.objects) == len(items)
