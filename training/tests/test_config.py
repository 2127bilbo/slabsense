from pathlib import Path

from trainlib.config import load_config


def test_load_config_resolves_paths_and_reads_bucket(tmp_path, monkeypatch):
    (tmp_path / "ds.toml").write_text(
        '[bucket]\nendpoint = "https://x.r2.cloudflarestorage.com"\nregion = "auto"\nname = "b"\nprefix = "tag-dataset"\n',
        encoding="utf-8")
    (tmp_path / "config.toml").write_text(
        '[paths]\ndataset_dir = "d"\nsplits_path = "s/splits.parquet"\ncache_dir = "c"\n'
        '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    monkeypatch.setenv("B2_KEY_ID", "k"); monkeypatch.setenv("B2_APP_KEY", "s")
    cfg = load_config(tmp_path / "config.toml")
    assert cfg.dataset_dir == (tmp_path / "d").resolve()
    assert cfg.splits_path == (tmp_path / "s" / "splits.parquet").resolve()
    assert cfg.runs_dir == (tmp_path / "runs").resolve()
    assert cfg.r2_endpoint == "https://x.r2.cloudflarestorage.com" and cfg.r2_bucket == "b"
    assert cfg.r2_key_id == "k" and cfg.r2_app_key == "s"
