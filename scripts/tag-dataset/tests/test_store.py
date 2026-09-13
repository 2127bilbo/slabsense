from tagdataset.store import Store


def make_store(tmp_path):
    return Store(str(tmp_path / "t.sqlite"))


def test_put_and_get_raw_roundtrip(tmp_path, detail_fixture, score_fixture):
    s = make_store(tmp_path)
    assert not s.has_raw("C1240631")
    s.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    assert s.has_raw("C1240631")
    d, sc = s.get_raw("C1240631")
    assert d == detail_fixture and sc == score_fixture
    assert s.grade_key_for("C1240631") == "7"
    assert s.certs_with_raw() == {"C1240631"}


def test_gone_rows_are_stored_but_not_iterated(tmp_path, detail_fixture, score_fixture):
    s = make_store(tmp_path)
    s.put_raw("GONE1", "9", None, None, 404, "Not Found")
    s.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    assert s.has_raw("GONE1")
    assert [c for c, _, _ in s.iter_raw_ok()] == ["C1240631"]
    assert s.get_raw("GONE1") == (None, None)


def test_put_raw_replaces_existing(tmp_path, detail_fixture, score_fixture):
    s = make_store(tmp_path)
    s.put_raw("X", "9", None, None, 500, "boom")
    s.put_raw("X", "9", detail_fixture, score_fixture, 200, None)
    assert [c for c, _, _ in s.iter_raw_ok()] == ["X"]


def test_files_table(tmp_path):
    s = make_store(tmp_path)
    assert not s.has_file("X", "front.jpg")
    s.put_file("X", "front.jpg", "https://cdn/x.jpg", 1234, "abc")
    s.put_file("X", "back.jpg", "https://cdn/y.jpg", 99, "def")
    assert s.has_file("X", "front.jpg")
    assert s.files_for("X") == {"front.jpg", "back.jpg"}
    assert s.files_for("Y") == set()


def test_failures_count_attempts_and_clear(tmp_path):
    s = make_store(tmp_path)
    s.add_failure("fetch", "X", "", "HTTP 500")
    s.add_failure("fetch", "X", "", "HTTP 502")
    s.add_failure("download", "X", "front.jpg", "timeout")
    assert s.list_failures("fetch") == [("X", "", "HTTP 502", 2)]
    assert s.list_failures("download") == [("X", "front.jpg", "timeout", 1)]
    s.clear_failure("fetch", "X", "")
    assert s.list_failures("fetch") == []


def test_counts(tmp_path, detail_fixture, score_fixture):
    s = make_store(tmp_path)
    s.put_raw("A", "7", detail_fixture, score_fixture, 200, None)
    s.put_raw("B", "9", None, None, 404, "nf")
    s.put_file("A", "front.jpg", "u", 1, "h")
    s.add_failure("download", "A", "back.jpg", "x")
    c = s.counts()
    assert c == {"raw_ok": 1, "raw_gone": 1, "files": 1, "failures_fetch": 0, "failures_download": 1}
