import math

import pandas as pd
import pytest

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
    counts = build.build(store, str(out), seed=1, splits_path=tmp_path / "s.parquet")
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
    splits_path = tmp_path / "s.parquet"
    build.build(store, str(out), seed=1, splits_path=splits_path)
    first = pd.read_parquet(out / "splits.parquet").set_index("cert").split.to_dict()
    d3 = {"data": {**detail_fixture["data"], "certificateValue": "X3", "uuid": "u3"}}
    store.put_raw("X3", "7", d3, score_fixture, 200, None)
    counts = build.build(store, str(out), seed=999, splits_path=splits_path)
    second = pd.read_parquet(out / "splits.parquet").set_index("cert").split.to_dict()
    assert all(second[c] == v for c, v in first.items())
    assert counts["splits_new"] == 1 and counts["splits_total"] == 3 and "X3" in second


def test_build_empty_store_writes_empty_frames_with_columns(tmp_path):
    store = Store(str(tmp_path / "e.sqlite"))
    out = tmp_path / "out"
    counts = build.build(store, str(out), splits_path=tmp_path / "s.parquet")
    assert counts["cards"] == 0
    m = pd.read_parquet(out / "manifest.parquet")
    assert len(m) == 0 and list(m.columns) == labels.MANIFEST_COLUMNS


def test_build_non_numeric_marker_id_does_not_break_surface_parquet(tmp_path, detail_fixture, score_fixture):
    ann = score_fixture["data"]["surfaceFrontData"]["annotations"]
    bad_marker = {**ann["markers"][0], "ID": "ERROR"}
    good_marker = {**ann["markers"][0], "ID": 1}
    score = {"data": {**score_fixture["data"],
                       "surfaceFrontData": {"annotations": {**ann, "markers": [bad_marker, good_marker]}}}}
    store = Store(str(tmp_path / "t.sqlite"))
    store.put_raw("C1240631", "7", detail_fixture, score, 200, None)
    out = tmp_path / "out"
    build.build(store, str(out), seed=1, splits_path=tmp_path / "s.parquet")
    surface = pd.read_parquet(out / "surface.parquet")
    assert surface["marker_id"].dtype.kind == "f"


# ── splits durability (item 2) ───────────────────────────────────────────
def test_build_default_splits_path_is_tracked_splits_dir(tmp_path, detail_fixture, score_fixture, monkeypatch):
    """With no splits_path given, build reads/writes cwd-relative splits/splits.parquet
    (a tracked location) rather than only the gitignored out_dir copy."""
    store = _store(tmp_path, detail_fixture, score_fixture)
    out = tmp_path / "out"
    monkeypatch.chdir(tmp_path)
    build.build(store, str(out), seed=1)
    tracked = tmp_path / "splits" / "splits.parquet"
    assert tracked.exists()
    assert set(pd.read_parquet(tracked).cert) == {"C1240631", "X2"}


def test_build_writes_matching_splits_copy_into_out_dir(tmp_path, detail_fixture, score_fixture):
    """out_dir/splits.parquet must always equal the file at splits_path so `stats` keeps
    working unchanged even though splits_path is now the authoritative copy."""
    store = _store(tmp_path, detail_fixture, score_fixture)
    out = tmp_path / "out"
    splits_path = tmp_path / "s.parquet"
    build.build(store, str(out), seed=1, splits_path=splits_path)
    authoritative = pd.read_parquet(splits_path)
    copy = pd.read_parquet(out / "splits.parquet")
    pd.testing.assert_frame_equal(authoritative, copy)


# ── schema pinning (item 5) ───────────────────────────────────────────────
def test_manifest_dtypes_stable_regardless_of_which_certs_are_present(tmp_path, detail_fixture, score_fixture):
    store1 = Store(str(tmp_path / "one.sqlite"))
    store1.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    out1 = tmp_path / "out1"
    build.build(store1, str(out1), seed=1, splits_path=tmp_path / "s1.parquet")

    store2 = Store(str(tmp_path / "two.sqlite"))
    store2.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    d2 = {"data": {**detail_fixture["data"], "certificateValue": "X2", "uuid": "u2",
                   "cardSet": {**detail_fixture["data"]["cardSet"], "setYear": None}}}
    store2.put_raw("X2", "7", d2, score_fixture, 200, None)
    out2 = tmp_path / "out2"
    build.build(store2, str(out2), seed=1, splits_path=tmp_path / "s2.parquet")

    m1 = pd.read_parquet(out1 / "manifest.parquet")
    m2 = pd.read_parquet(out2 / "manifest.parquet")
    assert m1.dtypes.to_dict() == m2.dtypes.to_dict()
    assert str(m2["year"].dtype) == "Int64"
    missing_year = m2.set_index("cert").loc["X2", "year"]
    assert missing_year is pd.NA or (isinstance(missing_year, float) and math.isnan(missing_year))


# ── per-cert error context (item 6) ──────────────────────────────────────
def test_build_wraps_per_cert_error_with_cert_id(tmp_path, detail_fixture, score_fixture, monkeypatch):
    store = Store(str(tmp_path / "t.sqlite"))
    store.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)

    def boom(cert, detail, score, store_counts=None, **kwargs):
        raise ValueError("boom")

    monkeypatch.setattr(labels, "card_row", boom)
    with pytest.raises(RuntimeError) as exc_info:
        build.build(store, str(tmp_path / "out"), seed=1, splits_path=tmp_path / "s.parquet")
    assert "C1240631" in str(exc_info.value)
    assert "boom" in str(exc_info.value)


# ── slot targets (corner/edge redesign Task 1) ────────────────────────────
def test_build_fills_slot_target_columns_with_expected_dtypes(tmp_path, detail_fixture, score_fixture):
    store = _store(tmp_path, detail_fixture, score_fixture)
    out = tmp_path / "out"
    build.build(store, str(out), seed=1, splits_path=tmp_path / "s.parquet")

    corners = pd.read_parquet(out / "corners.parquet")
    edges = pd.read_parquet(out / "edges.parquet")
    assert corners.columns.tolist() == labels.CORNER_COLUMNS
    assert edges.columns.tolist() == labels.EDGE_COLUMNS

    # Every cert in the fixture store has ding data, so ding_count must never be NaN.
    assert not corners.ding_count.isna().any()
    assert not edges.ding_count.isna().any()
    assert str(corners.ding_count.dtype) == "Int64"
    assert str(corners.marker_deduction.dtype) == "float64"
    assert str(corners.marker_source.dtype) == "string"
    assert str(edges.ding_count.dtype) == "Int64"
    assert str(edges.marker_deduction.dtype) == "float64"
    assert str(edges.marker_source.dtype) == "string"

    present_sources = set(corners.marker_source.dropna().unique()) | set(edges.marker_source.dropna().unique())
    assert present_sources.issubset({"rollup", "constituent"})
    # The fixture's back-side CORNER WEAR dings must land as positive corner slots.
    assert (corners.ding_count > 0).any()


def test_build_manifest_gains_n_dings_unassigned_column(tmp_path, detail_fixture, score_fixture):
    store = _store(tmp_path, detail_fixture, score_fixture)
    out = tmp_path / "out"
    build.build(store, str(out), seed=1, splits_path=tmp_path / "s.parquet")
    m = pd.read_parquet(out / "manifest.parquet")
    assert list(m.columns) == labels.MANIFEST_COLUMNS
    assert str(m.n_dings_unassigned.dtype) == "Int64"
    assert (m.n_dings_unassigned >= 0).all()
