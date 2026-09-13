import pandas as pd

from tagdataset import files, verify
from tagdataset.store import Store


def seeded(tmp_path, detail_fixture, score_fixture):
    store = Store(str(tmp_path / "t.sqlite"))
    store.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    store.put_raw("GONE", "9", None, None, 404, "nf")
    return store


def test_verify_reports_files_not_yet_downloaded(tmp_path, detail_fixture, score_fixture):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    missing = verify.verify(store)
    expected = files.expected_files(detail_fixture, score_fixture)
    assert list(missing.columns) == ["cert", "name", "url", "reason"]
    assert len(missing) == len(expected)
    assert set(missing.reason) == {"not_in_files_table"}
    assert set(missing.cert) == {"C1240631"}


def test_verify_clean_when_files_table_and_bucket_agree(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    for name, url in files.expected_files(detail_fixture, score_fixture):
        store.put_file("C1240631", name, url, 1, "h")
        fake_bucket.put("C1240631", name, b"x", "image/jpeg")
    assert verify.verify(store).empty
    assert verify.verify(store, fake_bucket).empty


def test_verify_detects_bucket_gap(tmp_path, detail_fixture, score_fixture, fake_bucket):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    for name, url in files.expected_files(detail_fixture, score_fixture):
        store.put_file("C1240631", name, url, 1, "h")
        if name != "back.jpg":
            fake_bucket.put("C1240631", name, b"x", "image/jpeg")
    missing = verify.verify(store, fake_bucket)
    assert missing.to_dict("records") == [{
        "cert": "C1240631", "name": "back.jpg",
        "url": detail_fixture["data"]["imageFileDeskewedBack"], "reason": "missing_in_bucket"}]


def test_completeness_by_grade(tmp_path, detail_fixture, score_fixture):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    store.put_raw("OTHER7", "7", detail_fixture, score_fixture, 200, None)
    for name, url in files.expected_files(detail_fixture, score_fixture):
        store.put_file("OTHER7", name, url, 1, "h")
    missing = verify.verify(store)
    table = verify.completeness_by_grade(store, missing)
    assert list(table.columns) == [
        "grade_key", "cards", "expected_files", "missing_files", "unavailable_files", "complete_cards"]
    row = table[table.grade_key == "7"].iloc[0]
    n = len(files.expected_files(detail_fixture, score_fixture))
    assert (row.cards, row.expected_files, row.missing_files, row.unavailable_files, row.complete_cards) == (
        2, 2 * n, n, 0, 1)


def test_verify_reports_unavailable_upstream(tmp_path, detail_fixture, score_fixture):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    expected = files.expected_files(detail_fixture, score_fixture)
    gone_name, gone_url = expected[0]
    store.add_failure("download", "C1240631", gone_name, "HTTP 403")
    for name, url in expected:
        if name != gone_name:
            store.put_file("C1240631", name, url, 1, "h")
    missing = verify.verify(store)
    assert missing.to_dict("records") == [
        {"cert": "C1240631", "name": gone_name, "url": gone_url, "reason": "unavailable_upstream"}]


def test_completeness_by_grade_counts_unavailable_separately_and_card_is_complete(
        tmp_path, detail_fixture, score_fixture):
    store = seeded(tmp_path, detail_fixture, score_fixture)
    expected = files.expected_files(detail_fixture, score_fixture)
    gone_name, gone_url = expected[0]
    store.add_failure("download", "C1240631", gone_name, "HTTP 403")
    for name, url in expected:
        if name != gone_name:
            store.put_file("C1240631", name, url, 1, "h")
    missing = verify.verify(store)
    table = verify.completeness_by_grade(store, missing)
    row = table[table.grade_key == "7"].iloc[0]
    assert (row.missing_files, row.unavailable_files, row.complete_cards) == (0, 1, 1)
