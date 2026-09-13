import pandas as pd

from tagdataset.cli import _grade_keys


def test_grade_keys_maps_cert_to_grade_key_with_nulls_as_none(tmp_path):
    path = tmp_path / "certs.parquet"
    pd.DataFrame({"cert": ["A", "B"], "grade_key": ["7", None]}).to_parquet(path)

    assert _grade_keys(str(path)) == {"A": "7", "B": None}
