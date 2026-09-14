import pandas as pd

from tagdataset import stats
from tagdataset.cli import _grade_keys, main
from tagdataset.store import Store


def test_grade_keys_maps_cert_to_grade_key_with_nulls_as_none(tmp_path):
    path = tmp_path / "certs.parquet"
    pd.DataFrame({"cert": ["A", "B"], "grade_key": ["7", None]}).to_parquet(path)

    assert _grade_keys(str(path)) == {"A": "7", "B": None}


def _write_config(tmp_path, db_path) -> str:
    path = tmp_path / "config.toml"
    path.write_text(
        f"""
[paths]
db = "{db_path.as_posix()}"

[bucket]
endpoint = "https://example.invalid"
region = "us-000"
name = "dummy-bucket"
prefix = "tag-dataset"
""",
        encoding="utf-8",
    )
    return str(path)


def _seeded_store(tmp_path, detail_fixture, score_fixture) -> str:
    db_path = tmp_path / "raw.sqlite"
    s = Store(str(db_path))
    s.put_raw("C1240631", "7", detail_fixture, score_fixture, 200, None)
    for name in ("front.jpg", "back.jpg", "ding_1.jpg", "ding_2.jpg", "ding_3.jpg", "ding_4.jpg", "ding_5.jpg"):
        s.put_file("C1240631", name, "u", 1, "h")
    s.close()
    return db_path


def test_build_splits_writes_outputs_and_splits_file_at_given_path(tmp_path, detail_fixture, score_fixture):
    db_path = _seeded_store(tmp_path, detail_fixture, score_fixture)
    config_path = _write_config(tmp_path, db_path)
    out_dir = tmp_path / "out"
    splits_path = tmp_path / "s.parquet"

    rc = main(["--config", config_path, "build", "--out", str(out_dir), "--splits", str(splits_path)])

    assert rc == 0
    for name in ("manifest.parquet", "corners.parquet", "edges.parquet", "surface.parquet",
                 "dings.parquet", "splits.parquet"):
        assert (out_dir / name).exists()
    assert splits_path.exists()


def test_stats_save_writes_report_with_joined_ding_count(tmp_path, detail_fixture, score_fixture):
    db_path = _seeded_store(tmp_path, detail_fixture, score_fixture)
    config_path = _write_config(tmp_path, db_path)
    out_dir = tmp_path / "out"
    splits_path = tmp_path / "s.parquet"
    rc = main(["--config", config_path, "build", "--out", str(out_dir), "--splits", str(splits_path)])
    assert rc == 0

    save_path = tmp_path / "r.txt"
    rc = main(["--config", config_path, "stats", "--out", str(out_dir), "--save", str(save_path)])

    assert rc == 0
    text = save_path.read_text(encoding="utf-8")
    assert "ding crops not in files table: 0" in text
    for heading in stats.SECTIONS:
        assert heading in text
