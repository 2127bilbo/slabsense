import pandas as pd

from tagdataset import build, labels
from tagdataset.store import Store


def _store(tmp_path, detail_fixture, score_fixture):
    s = Store(str(tmp_path / "t.sqlite"))
    s.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    d2 = {"data": {**detail_fixture["data"], "certificateValue": "X2", "uuid": "u2"}}
    s.put_raw("X2", "7", d2, score_fixture, 200, None)
    s.put_raw("GONE", "9", None, None, 404, "nf")
    s.put_file("C1240631", "front.jpg", "u", 1, "h")
    s.put_file("C1240631", "corner_FTL.png", "u", 1, "h")
    s.add_failure("download", "C1240631", "sfx_front_annotated.jpg", "HTTP 403")
    return s


def test_build_writes_all_outputs_with_expected_rows(tmp_path, detail_fixture, score_fixture):
    store = _store(tmp_path, detail_fixture, score_fixture)
    out = tmp_path / "out"
    counts = build.build(store, str(out), seed=1)
    for name in build.OUTPUTS:
        assert (out / name).exists()
    assert counts["cards"] == 2 and counts["corners"] == 16 and counts["edges"] == 16
    n_markers = sum(len(score_fixture["data"][k]["annotations"]["markers"]) for k in ("surfaceFrontData", "surfaceBackData"))
    assert counts["markers"] == 2 * n_markers
    assert counts["dings"] == 2 * len(detail_fixture["data"]["dingsJSON"]["Dings"])
    assert counts["splits_new"] == 2 and counts["splits_total"] == 2

    m = pd.read_parquet(out / "manifest.parquet")
    assert list(m.columns) == labels.MANIFEST_COLUMNS and set(m.cert) == {"C1240631", "X2"}
    row = m.set_index("cert").loc["C1240631"]
    assert row.n_files_uploaded == 2 and row.n_files_unavailable == 1
    assert pd.read_parquet(out / "corners.parquet").columns.tolist() == labels.CORNER_COLUMNS
    assert pd.read_parquet(out / "surface.parquet").columns.tolist() == labels.SURFACE_COLUMNS
    assert pd.read_parquet(out / "dings.parquet").columns.tolist() == labels.DING_COLUMNS
    sp = pd.read_parquet(out / "splits.parquet")
    assert set(sp.cert) == {"C1240631", "X2"}


def test_build_rebuild_keeps_split_assignments(tmp_path, detail_fixture, score_fixture):
    store = _store(tmp_path, detail_fixture, score_fixture)
    out = tmp_path / "out"
    build.build(store, str(out), seed=1)
    first = pd.read_parquet(out / "splits.parquet").set_index("cert").split.to_dict()
    d3 = {"data": {**detail_fixture["data"], "certificateValue": "X3", "uuid": "u3"}}
    store.put_raw("X3", "7", d3, score_fixture, 200, None)
    counts = build.build(store, str(out), seed=999)
    second = pd.read_parquet(out / "splits.parquet").set_index("cert").split.to_dict()
    assert all(second[c] == v for c, v in first.items())
    assert counts["splits_new"] == 1 and counts["splits_total"] == 3 and "X3" in second


def test_build_empty_store_writes_empty_frames_with_columns(tmp_path):
    store = Store(str(tmp_path / "e.sqlite"))
    out = tmp_path / "out"
    counts = build.build(store, str(out))
    assert counts["cards"] == 0
    m = pd.read_parquet(out / "manifest.parquet")
    assert len(m) == 0 and list(m.columns) == labels.MANIFEST_COLUMNS
