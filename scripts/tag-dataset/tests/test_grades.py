from tagdataset import grades


def test_era_boundaries():
    assert grades.era_for_year(1999) == "1999-2003"
    assert grades.era_for_year(2003) == "1999-2003"
    assert grades.era_for_year(2004) == "2004-2010"
    assert grades.era_for_year(2010) == "2004-2010"
    assert grades.era_for_year(2011) == "2011-2016"
    assert grades.era_for_year(2016) == "2011-2016"
    assert grades.era_for_year(2017) == "2017-2022"
    assert grades.era_for_year(2022) == "2017-2022"
    assert grades.era_for_year(2023) == "2023+"
    assert grades.era_for_year("2026") == "2023+"


def test_grade_num():
    assert grades.grade_num("10P") == 10.0
    assert grades.grade_num("10") == 10.0
    assert grades.grade_num("8.5") == 8.5
    assert grades.grade_num("1") == 1.0


def test_grade_key_sets_are_disjoint_and_complete():
    all_keys = {"1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5",
                "6", "6.5", "7", "7.5", "8", "8.5", "9", "10", "10P", "VA"}
    union = grades.FULL_GRADE_KEYS | grades.CAPPED_GRADE_KEYS | grades.SKIP_GRADE_KEYS
    assert union == all_keys
    assert not (grades.FULL_GRADE_KEYS & grades.CAPPED_GRADE_KEYS)
    assert "VA" in grades.SKIP_GRADE_KEYS
    assert "10P" in grades.FULL_GRADE_KEYS


def test_allocate_returns_everything_when_under_cap():
    avail = {"1999-2003": 100, "2023+": 200}
    assert grades.allocate(avail, cap=1500, floor=150) == avail


def test_allocate_sums_to_cap_and_respects_floor():
    avail = {"1999-2003": 10, "2004-2010": 300, "2011-2016": 2000, "2017-2022": 5000, "2023+": 40000}
    q = grades.allocate(avail, cap=1500, floor=150)
    assert sum(q.values()) == 1500
    assert q["1999-2003"] == 10            # fewer than floor available: take all
    assert q["2004-2010"] >= 150           # floor honoured
    assert q["2023+"] > q["2017-2022"] > q["2011-2016"]   # proportional above floor
    for era, n in q.items():
        assert n <= avail[era]


def test_allocate_is_deterministic():
    avail = {"a": 700, "b": 900, "c": 5}
    assert grades.allocate(avail, cap=1000, floor=100) == grades.allocate(avail, cap=1000, floor=100)
