import pytest

from trainlib import tables


def test_tasks_spec():
    assert set(tables.TASKS) == {"corners", "edges"}
    assert tables.TASKS["corners"]["targets"] == ["score_angle", "score_fill", "score_fray"]
    assert tables.TASKS["edges"]["targets"] == ["score_fill", "score_fray"]
    assert tables.TASKS["corners"]["input_size"] == (384, 384)
    assert tables.TASKS["edges"]["input_size"] == (1024, 192)


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
