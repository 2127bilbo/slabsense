import json
import math

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
    expected_cols = ["epoch", "train_loss", "val_loss", "lr", "seconds",
                     "auroc_wear", "precision_wear", "recall_wear", "npos_wear",
                     "mae_deduction", "mae_angle"]
    assert list(log.columns) == expected_cols
    assert train.log_columns("corners") == expected_cols
    assert len(log) == 2
    # val split ("C3") has ding_count values 0, 1, 2 -> both classes present -> finite AUROC
    assert log.auroc_wear.notna().all()
    assert not math.isnan(log.auroc_wear.iloc[-1])
    args = json.loads((run_dir / "args.json").read_text())
    assert args["task"] == "corners" and args["epochs"] == 2

    import torch
    ckpt = torch.load(run_dir / "best.pt", map_location="cpu", weights_only=False)
    assert ckpt["kinds"] == ["binary", "regress", "regress"]
    assert ckpt["target_names"] == ["wear", "deduction", "angle"]


def test_train_edges_two_epochs_cpu(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "edges.parquet")
    cache = make_cache(tmp_path, df, 3296, 550, vertical_for_lr=True)
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train.main(["--config", str(cfg), "--task", "edges", "--run-name", "e", "--epochs", "1",
                          "--batch-size", "4", "--backbone", "resnet18", "--no-pretrained", "--device", "cpu",
                          "--workers", "0", "--input-size", "32"])
    log = pd.read_csv(run_dir / "log.csv")
    assert list(log.columns) == ["epoch", "train_loss", "val_loss", "lr", "seconds",
                                 "auroc_wear", "precision_wear", "recall_wear", "npos_wear",
                                 "mae_deduction"]
