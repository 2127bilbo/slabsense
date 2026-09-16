import json

import pandas as pd

from conftest import make_cache
from trainlib import tables, train


def test_train_two_epochs_cpu_writes_artifacts(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    cache = make_cache(tmp_path, df, 96, 96)
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text(f'[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   f'[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train.main(["--config", str(cfg), "--task", "corners", "--run-name", "t", "--epochs", "2",
                          "--batch-size", "4", "--backbone", "resnet18", "--no-pretrained", "--device", "cpu",
                          "--workers", "0", "--input-size", "64"])
    assert (run_dir / "best.pt").exists() and (run_dir / "last.pt").exists()
    log = pd.read_csv(run_dir / "log.csv")
    assert list(log.columns) == ["epoch", "train_loss", "val_loss", "val_mae_points", "val_mae_low_points", "lr", "seconds"]
    assert len(log) == 2 and log.val_mae_points.notna().all()
    args = json.loads((run_dir / "args.json").read_text())
    assert args["task"] == "corners" and args["epochs"] == 2
