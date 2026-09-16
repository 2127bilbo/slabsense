import json

import pandas as pd
import torch

from conftest import make_tile_index
from trainlib import train_surface


def test_train_one_epoch_cpu_writes_artifacts(tmp_path):
    cache, idx = make_tile_index(tmp_path, n=4, size=96)
    # val index: reuse the train tiles under a val parquet
    idx.to_parquet(cache / "tiles" / "val.parquet", index=False)
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train_surface.main(["--config", str(cfg), "--run-name", "t", "--epochs", "1", "--batch-size", "2",
                                  "--no-pretrained", "--device", "cpu", "--workers", "0", "--warmup-iters", "1",
                                  "--min-size", "96"])
    assert (run_dir / "best.pt").exists() and (run_dir / "last.pt").exists()
    log = pd.read_csv(run_dir / "log.csv")
    assert list(log.columns) == ["epoch", "train_loss", "val_loss_proxy", "lr", "seconds", "map50", "precision", "recall",
                                 "ap50_CREASE", "ap50_DENT", "ap50_PIT", "ap50_PRINT_DEFECT", "ap50_SCRATCH", "ap50_STAIN", "ap50_TEAR"]
    assert len(log) == 1 and log.train_loss.notna().all()
    args = json.loads((run_dir / "args.json").read_text())
    assert args["epochs"] == 1
    ckpt = torch.load(run_dir / "best.pt", map_location="cpu", weights_only=False)
    assert ckpt["classes"] == ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"]
    # fine-tune start from that checkpoint on the sfx view only
    run2 = train_surface.main(["--config", str(cfg), "--run-name", "t2", "--epochs", "1", "--batch-size", "2",
                               "--no-pretrained", "--device", "cpu", "--workers", "0", "--warmup-iters", "1",
                               "--min-size", "96", "--init", str(run_dir / "best.pt"), "--views", "sfx"])
    assert (run2 / "best.pt").exists()
    assert json.loads((run2 / "args.json").read_text())["views"] == "sfx"
