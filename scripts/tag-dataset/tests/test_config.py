from tagdataset.config import load_config

_BASE = """
[paths]
db = "data/raw.sqlite"

[bucket]
endpoint = "https://example.backblazeb2.com"
region = "us-west-004"
name = "some-bucket"

[fetch]
rate = 4.0
workers = 8
{extra}
"""


def _write(tmp_path, extra=""):
    path = tmp_path / "config.toml"
    path.write_text(_BASE.format(extra=extra), encoding="utf-8")
    return str(path)


def test_load_config_defaults_cooldown_start_and_max(tmp_path):
    cfg = load_config(_write(tmp_path))
    assert cfg.cooldown_start == 300.0
    assert cfg.cooldown_max == 900.0


def test_load_config_reads_custom_cooldown_start(tmp_path):
    cfg = load_config(_write(tmp_path, extra="cooldown_start = 120\n"))
    assert cfg.cooldown_start == 120.0
    assert cfg.cooldown_max == 900.0


def test_load_config_defaults_download_rate(tmp_path):
    cfg = load_config(_write(tmp_path))
    assert cfg.download_rate == 8.0


def test_load_config_reads_custom_download_rate(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text(_BASE.format(extra="") + "\n[download]\nrate = 2\n", encoding="utf-8")
    cfg = load_config(str(path))
    assert cfg.download_rate == 2.0
