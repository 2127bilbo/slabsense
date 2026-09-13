from pathlib import Path

import pandas as pd

from tagdataset import sample

MINI = str(Path(__file__).parent / "fixtures" / "mini_cache.json")


def test_load_cache_flattens_to_cert_rows():
    rows = sample.load_cache(MINI)
    certs = {r["cert"] for r in rows}
    assert len(rows) == 2 + 3 + 1 + 6 + 1 + 10 + 1
    assert "A0000099" in certs                     # VA rows are loaded; filtered later
    row = next(r for r in rows if r["cert"] == "A0000001")
    assert row == {"cert": "A0000001", "grade_key": "3", "year": 1999, "brand": "WOTC Pokémon",
                   "set": "Base Set", "card_name": "Charizard", "card_number": "4", "variation": "Holo"}


def test_build_sample_full_grades_all_kept_and_va_skipped():
    df = sample.build_sample(sample.load_cache(MINI), exclude=set(), seed=1, cap=1500, floor=150)
    assert list(df.columns) == sample.COLUMNS
    assert set(df[df.grade_key == "3"].cert) == {"A0000001", "A0000002"}
    assert set(df[df.grade_key == "1"].cert) == {"C0000011"}
    assert set(df[df.grade_key == "10P"].cert) == {"B0000007"}
    assert "A0000099" not in set(df.cert)
    assert bool(df[df.cert == "B0000007"].is_pristine.iloc[0]) is True
    assert df[df.cert == "B0000007"].grade_num.iloc[0] == 10.0
    assert df[df.cert == "C0000011"].era.iloc[0] == "2023+"


def test_build_sample_caps_high_grade_across_eras():
    # grade 9 availability: 1999-2003 → 3, 2011-2016 → 6, 2023+ → 10 (19 total); cap 8, floor 2
    df = sample.build_sample(sample.load_cache(MINI), exclude=set(), seed=1, cap=8, floor=2)
    nines = df[df.grade_key == "9"]
    assert len(nines) == 8
    per_era = nines.era.value_counts().to_dict()
    assert per_era["1999-2003"] >= 2 and per_era["2011-2016"] >= 2 and per_era["2023+"] >= 2
    assert per_era["2023+"] >= per_era["2011-2016"] >= per_era["1999-2003"]


def test_build_sample_excludes_and_is_deterministic():
    rows = sample.load_cache(MINI)
    a = sample.build_sample(rows, exclude={"C0000001", "C0000002"}, seed=7, cap=8, floor=2)
    b = sample.build_sample(rows, exclude={"C0000001", "C0000002"}, seed=7, cap=8, floor=2)
    assert a.equals(b)
    assert not ({"C0000001", "C0000002"} & set(a.cert))
    assert len(a[a.grade_key == "9"]) == 8


def test_sample_from_cert_list_keeps_order_and_marks_unknown():
    rows = sample.load_cache(MINI)
    df = sample.sample_from_cert_list(rows, ["B0000007", "ZZZ", "A0000001"])
    assert list(df.columns) == sample.COLUMNS
    assert list(df.cert) == ["B0000007", "ZZZ", "A0000001"]
    assert df.iloc[0].grade_key == "10P" and df.iloc[0].era == "2011-2016"
    assert pd.isna(df.iloc[1].grade_key) and pd.isna(df.iloc[1].era) and pd.isna(df.iloc[1].grade_num)
