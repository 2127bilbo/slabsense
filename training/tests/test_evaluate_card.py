import json

import numpy as np
import pandas as pd
import torch
from PIL import Image

from test_train_card import _write_config, _write_cutout, _write_splits
from trainlib import evaluate_card
from trainlib.card_model import CardSegNet


def _write_tiny_checkpoint(path, input_size=64, encoder="mobilenetv3_large_100"):
    model = CardSegNet(encoder=encoder, pretrained=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {"model": model.state_dict(), "encoder": encoder, "epoch": 0, "iou": 0.0, "input_size": input_size},
        path,
    )


def _write_real_scan(scan_dir, sides, w=200, h=300):
    """`sides`: {name: (rotation, (x0, y0, x1, y1) as fractions)}."""
    scan_dir.mkdir(parents=True, exist_ok=True)
    sides_json = {}
    for name, (rotation, (x0, y0, x1, y1)) in sides.items():
        arr = np.full((h, w, 3), 40, dtype=np.uint8)
        px0, py0, px1, py1 = int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)
        arr[py0:py1, px0:px1] = 200
        Image.fromarray(arr).save(scan_dir / f"{name}.jpg", format="JPEG", quality=90)
        sides_json[name] = {
            "corners": {
                "tl": {"x": x0, "y": y0}, "tr": {"x": x1, "y": y0},
                "br": {"x": x1, "y": y1}, "bl": {"x": x0, "y": y1},
            },
            "imageWidth": w, "imageHeight": h, "rotation": rotation,
        }
    (scan_dir / "labels.json").write_text(json.dumps({"version": 1, "sides": sides_json}), encoding="utf-8")


def test_evaluate_card_main_writes_csvs_and_verdict(tmp_path):
    _write_splits(tmp_path)
    cache_dir = tmp_path / "cache"
    for cert in ("A1", "B2", "C3"):
        _write_cutout(cache_dir / "cutouts" / f"{cert}_F.png")
    cfg = _write_config(tmp_path)

    ckpt_path = tmp_path / "run" / "best.pt"
    _write_tiny_checkpoint(ckpt_path, input_size=64)

    real_folder = tmp_path / "card-val"
    box = (0.1, 0.1, 0.9, 0.9)
    _write_real_scan(real_folder / "scan1", {"front": (0, box), "back": (0, box)})
    _write_real_scan(real_folder / "scan2", {"front": (90, box), "back": (0, box)})

    ret = evaluate_card.main([
        "--config", str(cfg), "--checkpoint", str(ckpt_path), "--real", str(real_folder),
        "--synthetic-n", "4", "--batch-size", "2", "--workers", "0", "--device", "cpu",
        "--input-size", "64", "--backgrounds", str(tmp_path / "no_such_backgrounds"),
    ])
    assert ret == 0

    synth_csv = ckpt_path.parent / "eval_synth.csv"
    real_csv = ckpt_path.parent / "eval_real.csv"
    assert synth_csv.exists()
    assert real_csv.exists()

    synth_df = pd.read_csv(synth_csv)
    assert list(synth_df.columns) == ["index", "iou", "corner_err_pct", "failure", "reason"]
    assert len(synth_df) == 4

    real_df = pd.read_csv(real_csv)
    assert list(real_df.columns) == ["path", "iou", "corner_err_pct", "failure", "reason"]
    assert len(real_df) == 3

    # Numeric-plausibility invariants that hold regardless of the (untrained, near-random) model's
    # actual accuracy: `corner_err_pct` is NaN exactly for a failed row, and a real fitted value is
    # always finite and non-negative -- a spurious inf/NaN or negative value here (e.g. the
    # ordering-convention bug that let a wrong corner pairing through) is a plausibility bug, not
    # just an accuracy one, and this doesn't depend on the checkpoint being any good.
    for df in (synth_df, real_df):
        assert (df["corner_err_pct"].isna() == df["failure"]).all(), df
        finite = df.loc[~df["failure"], "corner_err_pct"]
        assert np.isfinite(finite).all(), finite
        assert (finite >= 0).all(), finite


def test_evaluate_card_main_prints_real_summary_and_provisional_verdict(tmp_path, capsys):
    _write_splits(tmp_path)
    cache_dir = tmp_path / "cache"
    for cert in ("A1", "B2", "C3"):
        _write_cutout(cache_dir / "cutouts" / f"{cert}_F.png")
    cfg = _write_config(tmp_path)

    ckpt_path = tmp_path / "run" / "best.pt"
    _write_tiny_checkpoint(ckpt_path, input_size=64)

    real_folder = tmp_path / "card-val"
    box = (0.1, 0.1, 0.9, 0.9)
    _write_real_scan(real_folder / "scan1", {"front": (0, box), "back": (0, box)})
    _write_real_scan(real_folder / "scan2", {"front": (90, box), "back": (0, box)})

    evaluate_card.main([
        "--config", str(cfg), "--checkpoint", str(ckpt_path), "--real", str(real_folder),
        "--synthetic-n", "4", "--batch-size", "2", "--workers", "0", "--device", "cpu",
        "--input-size", "64", "--backgrounds", str(tmp_path / "no_such_backgrounds"),
    ])

    out = capsys.readouterr().out
    assert "skipped_rotation=1" in out
    assert "n=3" in out
    assert ("provisional" in out) or ("reject" in out)
