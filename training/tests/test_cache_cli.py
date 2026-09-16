from trainlib import cache_cli


def _write_config(tmp_path, ds, sp):
    (tmp_path / "ds.toml").write_text(
        '[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8"
    )
    cfg = tmp_path / "config.toml"
    cfg.write_text(
        f'[paths]\ndataset_dir = "{ds.as_posix()}"\nsplits_path = "{sp.as_posix()}"\n'
        f'cache_dir = "cache"\nruns_dir = "runs"\n[r2]\nconfig_toml = "ds.toml"\n',
        encoding="utf-8",
    )
    return cfg


def _capture_build_cache(monkeypatch, calls):
    def fake_build_cache(reader, keys, cache_dir, workers, progress, resize=None, **kwargs):
        calls.append({"resize": resize})
        return {"downloaded": 0, "skipped": 0, "failed": 0}

    monkeypatch.setattr(cache_cli, "build_cache", fake_build_cache)
    monkeypatch.setattr(cache_cli, "reader_from_config", lambda cfg: object())


def test_cache_cli_passes_task_resize_for_edges(tables, tmp_path, monkeypatch):
    ds, sp = tables
    cfg = _write_config(tmp_path, ds, sp)
    calls = []
    _capture_build_cache(monkeypatch, calls)
    cache_cli.main(["--config", str(cfg), "--task", "edges"])
    assert calls == [{"resize": (1024, 192)}]


def test_cache_cli_no_resize_flag_forces_full_resolution(tables, tmp_path, monkeypatch):
    ds, sp = tables
    cfg = _write_config(tmp_path, ds, sp)
    calls = []
    _capture_build_cache(monkeypatch, calls)
    cache_cli.main(["--config", str(cfg), "--task", "edges", "--no-resize"])
    assert calls == [{"resize": None}]


def test_cache_cli_corners_has_no_resize_by_default(tables, tmp_path, monkeypatch):
    ds, sp = tables
    cfg = _write_config(tmp_path, ds, sp)
    calls = []
    _capture_build_cache(monkeypatch, calls)
    cache_cli.main(["--config", str(cfg), "--task", "corners"])
    assert calls == [{"resize": None}]
