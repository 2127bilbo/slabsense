import pandas as pd
import pytest

from conftest import make_cache
from trainlib import tables


def test_tasks_spec():
    assert set(tables.TASKS) == {"corners", "edges"}
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
