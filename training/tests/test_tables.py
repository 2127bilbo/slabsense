import pandas as pd
import pytest

from conftest import make_cache, make_boxes_table
from trainlib import tables
from trainlib import surface_tables as st


def test_tasks_spec():
    assert set(tables.TASKS) == {"corners", "edges", "surface_sfx", "surface_rgb", "surface_front_sfx",
                                 "surface_front_rgb", "centering_rgb"}
    assert tables.TASKS["corners"]["targets"] == [
        tables.Target("wear", "binary", "ding_count"),
        tables.Target("deduction", "regress", "marker_deduction"),
        tables.Target("angle", "regress", "score_angle"),
    ]
    assert tables.TASKS["edges"]["targets"] == [
        tables.Target("wear", "binary", "ding_count"),
        tables.Target("deduction", "regress", "marker_deduction"),
    ]
    assert tables.TASKS["corners"]["input_size"] == (384, 384)
    assert tables.TASKS["edges"]["input_size"] == (1024, 192)
    assert tables.TASKS["corners"]["key_cols"] == ["side", "corner"]
    assert tables.TASKS["edges"]["key_cols"] == ["side", "edge"]
    assert tables.TASKS["corners"]["cache_resize"] is None
    assert tables.TASKS["edges"]["cache_resize"] == (1024, 192)


def test_target_names_and_kinds():
    assert tables.target_names("corners") == ["wear", "deduction", "angle"]
    assert tables.target_kinds("corners") == ["binary", "regress", "regress"]
    assert tables.target_names("edges") == ["wear", "deduction"]
    assert tables.target_kinds("edges") == ["binary", "regress"]


def test_load_task_table_joins_split_and_grade(tables):
    ds, sp = tables
    df = tables_mod().load_task_table("corners", ds, sp, "train")
    assert set(df.cert) == {"A1", "B2"} and len(df) == 16
    assert set(df.columns) >= {"cert", "side", "corner", "score_fill", "crop_path", "split", "grade_label"}
    assert set(df.grade_label) == {"9 MINT", "1 POOR"}


def tables_mod():
    return tables


def test_load_task_table_refuses_test_split(tables):
    ds, sp = tables
    with pytest.raises(ValueError):
        tables_mod().load_task_table("edges", ds, sp, "test")
    assert len(tables_mod().load_task_table("edges", ds, sp, "test", allow_test=True)) == 8


def test_limit_cards_is_seeded_and_per_cert(tables):
    ds, sp = tables
    a = tables_mod().load_task_table("corners", ds, sp, "train", limit_cards=1, seed=3)
    b = tables_mod().load_task_table("corners", ds, sp, "train", limit_cards=1, seed=3)
    assert a.cert.nunique() == 1 and len(a) == 8 and set(a.cert) == set(b.cert)


def test_filter_cached_drops_missing_crop_files(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    cache = make_cache(tmp_path, df, 32, 32)
    (cache / df.crop_path.iloc[0]).unlink()
    filtered, dropped = tables_mod().filter_cached(df, cache)
    assert dropped == 1 and len(filtered) == len(df) - 1
    assert df.crop_path.iloc[0] not in set(filtered.crop_path)


def test_filter_cached_keeps_frame_unchanged_when_all_present(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    cache = make_cache(tmp_path, df, 32, 32)
    filtered, dropped = tables_mod().filter_cached(df, cache)
    assert dropped == 0 and len(filtered) == len(df)


def test_filter_cached_counts_resized_only_file_as_cached_for_edges(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "edges.parquet")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True, resized=True)
    filtered, dropped = tables_mod().filter_cached(df, cache, task="edges")
    assert dropped == 0 and len(filtered) == len(df)


def test_filter_cached_without_task_ignores_resized_only_edges(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "edges.parquet")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True, resized=True)
    filtered, dropped = tables_mod().filter_cached(df, cache)
    assert dropped == len(df) and len(filtered) == 0


def test_filter_cached_drops_row_missing_both_resized_and_full_res(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "edges.parquet")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True, resized=True)
    key = df.crop_path.iloc[0]
    from trainlib.cache import resized_path
    resized_path(cache, key, (1024, 192)).unlink()
    filtered, dropped = tables_mod().filter_cached(df, cache, task="edges")
    assert dropped == 1 and key not in set(filtered.crop_path)


def test_filter_cached_task_with_no_cache_resize_behaves_like_before(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    cache = make_cache(tmp_path, df, 32, 32)
    (cache / df.crop_path.iloc[0]).unlink()
    filtered, dropped = tables_mod().filter_cached(df, cache, task="corners")
    assert dropped == 1 and len(filtered) == len(df) - 1


def test_surface_side_rows_one_row_per_side_with_scores(surface_tables):
    ds, sp = surface_tables
    man = pd.read_parquet(ds / "manifest.parquet")
    rows = tables.surface_side_rows(man, "sfx")
    assert list(rows.columns) == ["cert", "side", "crop_path", "score"]
    assert rows[["cert", "side"]].values.tolist()[:3] == [["A1", "B"], ["A1", "F"], ["B2", "F"]]   # B2/B dropped: null score
    assert rows.crop_path.iloc[1] == "tag-dataset/A1/sfx_front.jpg" and rows.score.iloc[1] == 1000.0
    rgb = tables.surface_side_rows(man, "rgb")
    assert rgb.crop_path.iloc[0] == "tag-dataset/A1/back.jpg" and len(rgb) == 7


def test_surface_tasks_load_through_load_task_table(surface_tables):
    ds, sp = surface_tables
    for task in ("surface_sfx", "surface_rgb"):
        spec = tables.TASKS[task]
        assert spec["input_size"] == (896, 1248) and spec["cache_resize"] == (896, 1248)
        assert spec["long_side_horizontal"] is False and tables.target_names(task) == ["score"]
        df = tables.load_task_table(task, ds, sp, "train")
        assert set(df.cert) == {"A1", "B2"} and len(df) == 3
        assert "grade_label" in df.columns and "split" in df.columns
    with pytest.raises(ValueError):
        tables.load_task_table("surface_sfx", ds, sp, "test")


def test_surface_front_rows_front_only_with_two_targets(surface_tables):
    ds, sp = surface_tables
    man = pd.read_parquet(ds / "manifest.parquet")
    rows = tables.surface_front_rows(man, "sfx")
    assert list(rows.columns) == ["cert", "side", "crop_path", "score_front", "rollup"]
    assert rows.cert.tolist() == ["A1", "B2", "C3", "D4"] and (rows.side == "F").all()
    assert rows.crop_path.iloc[0] == "tag-dataset/A1/sfx_front.jpg"
    assert rows.score_front.tolist() == [1000.0, 110.0, 981.0, 705.0]
    assert rows.rollup.iloc[1] == 215.0 and pd.isna(rows.rollup.iloc[2])      # C3 rollup missing -> masked, row kept
    assert tables.surface_front_rows(man, "rgb").crop_path.iloc[0] == "tag-dataset/A1/front.jpg"


def test_surface_front_tasks_load_and_key_set(surface_tables):
    ds, sp = surface_tables
    for task in ("surface_front_sfx", "surface_front_rgb"):
        assert tables.target_names(task) == ["score_front", "rollup"]
        assert tables.target_kinds(task) == ["regress", "regress"]
        assert tables.TASKS[task]["cache_resize"] == (896, 1248)
        df = tables.load_task_table(task, ds, sp, "train")
        assert df.cert.tolist() == ["A1", "B2"] and "grade_label" in df.columns
    assert {"surface_front_sfx", "surface_front_rgb"} <= set(tables.TASKS)


def test_centering_rows_per_mille_of_card_dims(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    man = pd.read_parquet(ds / "manifest.parquet")
    sides, _ = st.load_surface_split(ds, sp, "train")
    boxes_path = make_boxes_table(tmp_path, sides[sides.view == "rgb"], not_ok=[("B2", "B")])
    rows = tables.centering_rows(man, pd.read_parquet(boxes_path))
    assert list(rows.columns) == ["cert", "side", "crop_path", "dte_l", "dte_r", "dte_t", "dte_b"]
    a1f = rows[(rows.cert == "A1") & (rows.side == "F")].iloc[0]
    assert abs(a1f.dte_l - 180 / 4300 * 1000) < 1e-9 and abs(a1f.dte_t - 185 / 6000 * 1000) < 1e-9
    assert a1f.crop_path == "tag-dataset/A1/front.jpg"
    assert not ((rows.cert == "B2") & (rows.side == "B")).any()          # not-ok box dropped
    monkeypatch.setenv("TRAINLIB_BOXES", str(boxes_path))
    df = tables.load_task_table("centering_rgb", ds, sp, "train")
    assert len(df) == 3 and tables.target_names("centering_rgb") == ["dte_l", "dte_r", "dte_t", "dte_b"]
    spec = tables.TASKS["centering_rgb"]
    assert spec["cache_variant"] == "card" and spec["edge_jitter"] == 0.03 and spec["crop_boxes"] == "derived/centering_boxes_rgb.parquet"
