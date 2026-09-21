import io
import json

import numpy as np
import pandas as pd
import torch
from PIL import Image

from conftest import orange_card_png
from trainlib import card_cutouts as ccut
from trainlib import card_data
from trainlib import train_card
from trainlib.card_backgrounds import RealPool


def _write_cutout(path, w=400, h=600, margin=50, long_side=256):
    img = Image.open(io.BytesIO(orange_card_png(w, h, margin=margin)))
    box = (margin, margin, w - margin, h - margin)
    cutout = ccut.make_cutout(img, box, long_side=long_side)
    path.parent.mkdir(parents=True, exist_ok=True)
    cutout.save(path, format="PNG")


def _write_config(tmp_path, splits_name="splits.parquet"):
    (tmp_path / "ds.toml").write_text(
        '[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8"
    )
    (tmp_path / "dataset").mkdir(exist_ok=True)
    cfg = tmp_path / "config.toml"
    cfg.write_text(
        f'[paths]\ndataset_dir = "dataset"\nsplits_path = "{splits_name}"\ncache_dir = "cache"\n'
        f'runs_dir = "runs"\n[r2]\nconfig_toml = "ds.toml"\n',
        encoding="utf-8",
    )
    return cfg


def _write_splits(tmp_path):
    df = pd.DataFrame({"cert": ["A1", "B2", "C3"], "split": ["train", "train", "val"]})
    path = tmp_path / "splits.parquet"
    df.to_parquet(path, index=False)
    return path


def test_list_cutouts_filters_by_split(tmp_path):
    _write_splits(tmp_path)
    cache_dir = tmp_path / "cache"
    for cert in ("A1", "B2", "C3"):
        _write_cutout(cache_dir / "cutouts" / f"{cert}_F.png")
    train_paths = card_data.list_cutouts(cache_dir, tmp_path / "splits.parquet", "train")
    val_paths = card_data.list_cutouts(cache_dir, tmp_path / "splits.parquet", "val")
    assert {p.stem for p in train_paths} == {"A1_F", "B2_F"}
    assert {p.stem for p in val_paths} == {"C3_F"}


def test_synthetic_val_shapes_and_reproducible_per_index(tmp_path):
    cache_dir = tmp_path / "cache"
    paths = []
    for cert in ("A1", "B2"):
        p = cache_dir / "cutouts" / f"{cert}_F.png"
        _write_cutout(p)
        paths.append(p)
    bg_pool = RealPool(tmp_path / "no_such_backgrounds")

    ds1 = card_data.SyntheticVal(paths, bg_pool, n=4, seed=12345, canvas=128, out=64)
    ds2 = card_data.SyntheticVal(paths, bg_pool, n=4, seed=12345, canvas=128, out=64)

    img, mask, meta = ds1[0]
    assert img.shape == (3, 64, 64)
    assert img.dtype == torch.float32
    assert mask.shape == (1, 64, 64)
    assert mask.dtype == torch.float32

    img2, mask2, meta2 = ds2[0]
    torch.testing.assert_close(img, img2)
    torch.testing.assert_close(mask, mask2)
    np.testing.assert_allclose(meta["quad"], meta2["quad"])


def test_train_card_one_epoch_cpu_writes_artifacts(tmp_path):
    _write_splits(tmp_path)
    cache_dir = tmp_path / "cache"
    for cert in ("A1", "B2", "C3"):
        _write_cutout(cache_dir / "cutouts" / f"{cert}_F.png")
    cfg = _write_config(tmp_path)

    run_dir = train_card.main([
        "--config", str(cfg), "--run-name", "t", "--epochs", "1",
        "--samples-per-epoch", "8", "--batch-size", "2", "--workers", "0",
        "--val-n", "4", "--no-pretrained", "--device", "cpu",
        "--input-size", "64", "--warmup-iters", "1",
    ])

    assert (run_dir / "best.pt").exists()
    assert (run_dir / "last.pt").exists()
    assert (run_dir / "args.json").exists()

    log = pd.read_csv(run_dir / "log.csv")
    assert list(log.columns) == ["epoch", "train_loss", "val_loss", "lr", "seconds",
                                 "iou", "corner_err_pct", "fail_rate"]
    assert len(log) == 1
    assert np.isfinite(log.train_loss.iloc[0])
    assert np.isfinite(log.iou.iloc[0])

    args = json.loads((run_dir / "args.json").read_text())
    assert args["epochs"] == 1
    # --canvas omitted -> resolves to 2x --input-size, recorded in args.json
    assert args["canvas"] == 128

    ckpt = torch.load(run_dir / "best.pt", map_location="cpu", weights_only=False)
    assert {"model", "encoder", "epoch", "iou", "input_size"}.issubset(ckpt.keys())
    assert ckpt["input_size"] == 64
