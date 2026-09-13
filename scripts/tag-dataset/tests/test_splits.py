import pandas as pd

from tagdataset import splits


def _manifest(n_per=(("9 MINT", "2023+", 100), ("1 POOR", "1999-2003", 30), ("5 EXCELLENT", "2011-2016", 7))):
    rows = []
    for grade, era, n in n_per:
        for i in range(n):
            rows.append({"cert": f"{grade[:1]}{era[:4]}{i:04d}", "grade_label": grade, "era": era})
    return pd.DataFrame(rows)


def test_assign_columns_and_coverage():
    m = _manifest()
    out = splits.assign_splits(m, None, seed=1)
    assert list(out.columns) == ["cert", "split", "stratum", "assigned_at"]
    assert set(out.cert) == set(m.cert) and set(out.split) <= set(splits.SPLITS)
    assert out.cert.is_unique


def test_assign_is_stratified_and_deterministic():
    m = _manifest()
    a = splits.assign_splits(m, None, seed=7)
    b = splits.assign_splits(m, None, seed=7)
    assert a.drop(columns="assigned_at").equals(b.drop(columns="assigned_at"))
    big = a[a.stratum == "9 MINT|2023+"].split.value_counts()
    assert 76 <= big["train"] <= 84 and 6 <= big["val"] <= 14 and 6 <= big["test"] <= 14
    small = a[a.stratum == "5 EXCELLENT|2011-2016"].split.value_counts()
    assert small.get("test", 0) >= 1 and small.get("val", 0) >= 1 and small.get("train", 0) >= 1


def test_existing_assignments_are_preserved_and_new_certs_added():
    m = _manifest()
    first = splits.assign_splits(m.iloc[:60], None, seed=3)
    more = m.copy()
    second = splits.assign_splits(more, first, seed=99)
    merged = second.set_index("cert")
    for _, r in first.iterrows():
        assert merged.loc[r.cert, "split"] == r.split and merged.loc[r.cert, "assigned_at"] == r.assigned_at
    assert len(second) == len(m)
    new = second[~second.cert.isin(first.cert)]
    assert len(new) == len(m) - 60 and set(new.split) <= set(splits.SPLITS)


def test_existing_certs_missing_from_manifest_are_kept():
    m = _manifest()
    first = splits.assign_splits(m, None, seed=3)
    second = splits.assign_splits(m.iloc[:10], first, seed=3)
    assert len(second) == len(first)


def test_null_stratum_fields_do_not_crash():
    m = pd.DataFrame({"cert": ["A", "B", "C"], "grade_label": [None, "9 MINT", None], "era": ["2023+", None, None]})
    out = splits.assign_splits(m, None, seed=1)
    assert len(out) == 3 and out.stratum.str.contains("?", regex=False).all() is not None
