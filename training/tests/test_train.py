import json
import math

import pandas as pd
import pytest
from PIL import Image

from conftest import make_boxes_table, make_cache
from trainlib import cache as cache_mod
from trainlib import surface_tables as st
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
    assert "loss_dist" not in log.columns and "loss_ratio" not in log.columns
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


def test_train_v2_flags_ema_drop_path_strong_aug(tables, tmp_path):
    import torch
    from trainlib import models

    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    cache = make_cache(tmp_path, df, 96, 96)
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train.main(["--config", str(cfg), "--task", "corners", "--run-name", "v2t", "--epochs", "1",
                          "--batch-size", "4", "--backbone", "resnet18", "--no-pretrained", "--device", "cpu",
                          "--workers", "0", "--input-size", "64",
                          "--ema-decay", "0.9", "--drop-path", "0.1", "--aug", "strong"])
    args = json.loads((run_dir / "args.json").read_text())
    assert args["ema_decay"] == 0.9 and args["drop_path"] == 0.1 and args["aug"] == "strong"
    ckpt = torch.load(run_dir / "best.pt", map_location="cpu", weights_only=False)
    assert ckpt["ema_decay"] == 0.9
    # the saved weights are the EMA copy, with plain (non-AveragedModel) keys that evaluate.py can load
    assert not any(k.startswith("module.") for k in ckpt["model"])
    m = models.ScoreRegressor(ckpt["n_out"], ckpt["backbone"], pretrained=False)
    m.load_state_dict(ckpt["model"])


def test_train_centering_rgb_logs_ratio_loss_columns(surface_tables, tmp_path, monkeypatch):
    ds, sp = surface_tables
    train_sides, _ = st.load_surface_split(ds, sp, "train")
    val_sides, _ = st.load_surface_split(ds, sp, "val")
    sides = pd.concat([train_sides, val_sides])
    boxes_path = make_boxes_table(tmp_path, sides[sides.view == "rgb"])
    monkeypatch.setenv("TRAINLIB_BOXES", str(boxes_path))

    df = tables.load_task_table("centering_rgb", ds, sp, "train")
    val_df = tables.load_task_table("centering_rgb", ds, sp, "val")
    cache = tmp_path / "cache"
    for p in pd.concat([df.crop_path, val_df.crop_path]):
        dest = cache_mod.resized_path(cache, p, (896, 1248), "card")
        dest.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (64, 64), (128, 128, 128)).save(dest, format="JPEG", quality=95)

    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train.main(["--config", str(cfg), "--task", "centering_rgb", "--run-name", "c", "--epochs", "1",
                          "--batch-size", "2", "--backbone", "resnet18", "--no-pretrained", "--device", "cpu",
                          "--workers", "0", "--input-size", "64"])
    log = pd.read_csv(run_dir / "log.csv")
    expected_cols = ["epoch", "train_loss", "val_loss", "lr", "loss_dist", "loss_ratio", "seconds",
                     "mae_dte_l", "mae_dte_r", "mae_dte_t", "mae_dte_b"]
    assert list(log.columns) == expected_cols
    assert train.log_columns("centering_rgb") == expected_cols
    assert len(log) == 1


def test_train_centering_rgb_balance_deviation_prints_buckets_and_writes_artifacts(surface_tables, tmp_path, monkeypatch,
                                                                                   capsys):
    ds, sp = surface_tables
    train_sides, _ = st.load_surface_split(ds, sp, "train")
    val_sides, _ = st.load_surface_split(ds, sp, "val")
    sides = pd.concat([train_sides, val_sides])
    boxes_path = make_boxes_table(tmp_path, sides[sides.view == "rgb"])
    monkeypatch.setenv("TRAINLIB_BOXES", str(boxes_path))

    df = tables.load_task_table("centering_rgb", ds, sp, "train")
    val_df = tables.load_task_table("centering_rgb", ds, sp, "val")
    cache = tmp_path / "cache"
    for p in pd.concat([df.crop_path, val_df.crop_path]):
        dest = cache_mod.resized_path(cache, p, (896, 1248), "card")
        dest.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (64, 64), (128, 128, 128)).save(dest, format="JPEG", quality=95)

    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train.main(["--config", str(cfg), "--task", "centering_rgb", "--run-name", "cbd", "--epochs", "1",
                          "--batch-size", "2", "--backbone", "resnet18", "--no-pretrained", "--device", "cpu",
                          "--workers", "0", "--input-size", "64", "--balance-deviation"])
    out = capsys.readouterr().out
    assert "balance-deviation buckets (first epoch draws): {0:" in out
    assert (run_dir / "best.pt").exists() and (run_dir / "last.pt").exists()
    args = json.loads((run_dir / "args.json").read_text())
    assert args["balance_deviation"] is True


def test_train_corners_balance_deviation_is_rejected(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    cache = make_cache(tmp_path, df, 96, 96)
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    with pytest.raises(SystemExit):
        train.main(["--config", str(cfg), "--task", "corners", "--run-name", "cbd", "--epochs", "1",
                   "--batch-size", "4", "--backbone", "resnet18", "--no-pretrained", "--device", "cpu",
                   "--workers", "0", "--input-size", "64", "--balance-deviation"])
