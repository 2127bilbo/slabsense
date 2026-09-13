import asyncio
import hashlib

from conftest import FakeSession
from tagdataset import download, files
from tagdataset.fetch import Throttle
from tagdataset.store import Store


def run(coro):
    return asyncio.run(coro)


async def no_sleep(_):
    pass


def fast_throttle(sleep=no_sleep):
    """A Throttle with negligible spacing so tests don't wait, but real trip/cooldown logic."""
    return Throttle(1000, sleep=sleep)


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


def test_pending_files_excludes_gone_unless_include_gone(tmp_path, detail_fixture, score_fixture):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    expected = files.expected_files(detail_fixture, score_fixture)
    gone_name = expected[0][0]
    store.add_failure("download", "C1240631", gone_name, "HTTP 403")
    pending = download.pending_files(store)
    assert gone_name not in [n for _, n, _ in pending]
    assert len(pending) == len(expected) - 1
    pending_all = download.pending_files(store, include_gone=True)
    assert gone_name in [n for _, n, _ in pending_all]
    assert len(pending_all) == len(expected)


def test_download_one_uploads_and_records(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = detail_fixture["data"]["imageFileDeskewedFront"]
    body = b"\xff\xd8jpegbytes"
    session = FakeSession({url: body})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       fast_throttle(), no_sleep))
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
                              fast_throttle(), no_sleep))
    assert fake_bucket.objects["tag-dataset/C1240631/corner_FTL.png"][1] == "image/png"


def test_download_one_retries_then_fails(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [503, 503, 503, 503]})
    slept = []

    async def sleep(s):
        slept.append(s)

    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       fast_throttle(), sleep))
    assert result == "failed"
    assert slept == [1, 4, 16]
    assert not store.has_file("C1240631", "front.jpg")
    assert store.list_failures("download") == [("C1240631", "front.jpg", "HTTP 503", 1)]


def test_download_one_recovers_after_transient_error(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [ConnectionError("reset"), b"ok"]})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       fast_throttle(), no_sleep))
    assert result == "ok"
    assert store.list_failures("download") == []


def test_download_one_bucket_failure_is_retried_and_recorded(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    fake_bucket.fail_names.add("front.jpg")
    url = "https://cdn/x.jpg"
    session = FakeSession({url: b"ok"})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       fast_throttle(), no_sleep))
    assert result == "failed"
    assert store.list_failures("download")[0][2].startswith("RuntimeError")


def test_run_download_processes_all_pending(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    items = download.pending_files(store)
    session = FakeSession({url: b"data-" + name.encode() for _, name, url in items})
    counts = run(download.run_download(session, fake_bucket, store, items, concurrency=4, rate=1000,
                                       sleep=no_sleep))
    assert counts == {"ok": len(items), "gone": 0, "failed": 0, "throttled": 0}
    assert download.pending_files(store) == []
    assert len(fake_bucket.objects) == len(items)


def test_download_one_gone_on_403_no_retry(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [(403, b"<Code>AccessDenied</Code>"), b"would-succeed"]})
    slept = []

    async def sleep(s):
        slept.append(s)

    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       fast_throttle(), sleep))
    assert result == "gone"
    assert slept == []
    assert len(session.calls) == 1
    assert store.list_failures("download") == [("C1240631", "front.jpg", "HTTP 403", 1)]
    assert not store.has_file("C1240631", "front.jpg")


def test_download_one_gone_on_404_no_retry(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [404, b"would-succeed"]})
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       fast_throttle(), no_sleep))
    assert result == "gone"
    assert len(session.calls) == 1
    assert store.list_failures("download") == [("C1240631", "front.jpg", "HTTP 404", 1)]
    assert not store.has_file("C1240631", "front.jpg")


def test_run_download_counts_gone_separately(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    items = download.pending_files(store)
    responses = {url: b"data-" + name.encode() for _, name, url in items}
    gone_cert, gone_name, gone_url = items[0]
    responses[gone_url] = (403, b"<Code>AccessDenied</Code>")
    session = FakeSession(responses)
    counts = run(download.run_download(session, fake_bucket, store, items, concurrency=4, rate=1000,
                                       sleep=no_sleep))
    assert counts == {"ok": len(items) - 1, "gone": 1, "failed": 0, "throttled": 0}


def test_classify_403_access_denied_is_gone():
    body = b'<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>x</Message></Error>'
    assert download.classify_403(body) == "gone"


def test_classify_403_no_such_key_is_gone():
    body = b'<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>'
    assert download.classify_403(body) == "gone"


def test_classify_403_html_block_page_is_throttled():
    body = b"<!DOCTYPE HTML><html><body>Request blocked</body></html>"
    assert download.classify_403(body) == "throttled"


def test_classify_403_empty_body_is_throttled():
    assert download.classify_403(b"") == "throttled"


def test_download_one_throttled_on_403_block_page(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [(403, b"<html>blocked</html>")]})
    throttle = fast_throttle()
    slept = []

    async def sleep(s):
        slept.append(s)

    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       throttle, sleep))
    assert result == "throttled"
    assert throttle.trips == 1
    assert store.list_failures("download") == []
    assert not store.has_file("C1240631", "front.jpg")
    assert slept == []


def test_download_one_throttled_on_429(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [429]})
    throttle = fast_throttle()
    result = run(download.download_one(session, fake_bucket, store, "C1240631", "front.jpg", url,
                                       throttle, no_sleep))
    assert result == "throttled"
    assert throttle.trips == 1
    assert store.list_failures("download") == []
    assert not store.has_file("C1240631", "front.jpg")


def test_run_download_requeues_throttled_and_lands_file(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    items = download.pending_files(store)
    responses = {url: b"data-" + name.encode() for _, name, url in items}
    target_cert, target_name, target_url = items[0]
    responses[target_url] = [(403, b"<html>blocked</html>"), responses[target_url]]
    session = FakeSession(responses)
    counts = run(download.run_download(session, fake_bucket, store, items, concurrency=1, rate=1000,
                                       sleep=no_sleep))
    assert counts == {"ok": len(items), "gone": 0, "failed": 0, "throttled": 1}
    assert store.has_file(target_cert, target_name)


def test_run_download_parks_after_20_throttles(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url = "https://cdn/x.jpg"
    session = FakeSession({url: [(403, b"<html>blocked</html>")] * 100})
    counts = run(download.run_download(session, fake_bucket, store, [("C1240631", "front.jpg", url)],
                                       concurrency=1, rate=1000, sleep=no_sleep))
    assert counts == {"ok": 0, "gone": 0, "failed": 1, "throttled": 20}
    assert store.list_failures("download") == [("C1240631", "front.jpg", "HTTP 403 x20", 1)]


def test_run_download_pins_park_reason_per_item_status(tmp_path, detail_fixture, score_fixture, fake_bucket):
    """Two items throttled forever by different statuses must each keep their own last-seen
    status in the park reason — this pins the last_status contract documented in download.py
    (read immediately after download_one returns, no await in between) against a future
    regression where an inserted await lets one item's status leak into the other's reason."""
    store = seeded_store(tmp_path, detail_fixture, score_fixture)
    url_a = "https://cdn/a.jpg"
    url_b = "https://cdn/b.jpg"
    session = FakeSession({
        url_a: [(403, b"<html>blocked</html>")] * 100,
        url_b: [429] * 100,
    })
    items = [("CERT_A", "front.jpg", url_a), ("CERT_B", "front.jpg", url_b)]
    counts = run(download.run_download(session, fake_bucket, store, items, concurrency=2, rate=1000,
                                       sleep=no_sleep))
    assert counts == {"ok": 0, "gone": 0, "failed": 2, "throttled": 40}
    assert store.list_failures("download") == [
        ("CERT_A", "front.jpg", "HTTP 403 x20", 1),
        ("CERT_B", "front.jpg", "HTTP 429 x20", 1),
    ]
