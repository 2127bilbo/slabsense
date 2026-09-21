import pandas as pd
import pytest
import torch
from PIL import Image

from conftest import make_boxes_table, make_cache
from trainlib import cache as cache_mod
from trainlib import surface_tables as st
from trainlib import tables as tables_mod
from trainlib import evaluate, train


def _trained(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    make_cache(tmp_path, df, 96, 96)
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg = tmp_path / "config.toml"
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train.main(["--config", str(cfg), "--task", "corners", "--run-name", "t", "--epochs", "1", "--batch-size", "4",
                          "--backbone", "resnet18", "--no-pretrained", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    return cfg, run_dir


def test_evaluate_val_writes_per_grade_table(tables, tmp_path):
    cfg, run_dir = _trained(tables, tmp_path)
    out = evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                         "--split", "val", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    t = pd.read_csv(out)
    expected_cols = ["grade_label", "n_rows", "auroc_wear", "precision_wear", "recall_wear", "npos_wear",
                     "mae_deduction", "mae_angle"]
    assert list(t.columns) == expected_cols
    assert t.grade_label.iloc[-1] == "ALL" and set(t.grade_label[:-1]) == {"9 MINT"}  # val split is cert C3
    assert t.n_rows.iloc[-1] == 8  # 8 crops for cert C3 (2 sides x 4 corners)
    assert t.npos_wear.notna().all()


def test_evaluate_phone_sim_writes_separate_csv(tables, tmp_path):
    cfg, run_dir = _trained(tables, tmp_path)
    out = evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                         "--split", "val", "--device", "cpu", "--workers", "0", "--input-size", "64", "--phone-sim"])
    assert out.name == "eval_val_phonesim.csv"
    t = pd.read_csv(out)
    expected_cols = ["grade_label", "n_rows", "auroc_wear", "precision_wear", "recall_wear", "npos_wear",
                     "mae_deduction", "mae_angle"]
    assert list(t.columns) == expected_cols


def test_evaluate_refuses_test_without_final_eval(tables, tmp_path):
    cfg, run_dir = _trained(tables, tmp_path)
    with pytest.raises(ValueError):
        evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                       "--split", "test", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    out = evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                         "--split", "test", "--final-eval", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    assert out.name == "eval_test.csv"


# ---------------------------------------------------------------------------
# Task 3: centering ratio/compression metrics (pure functions) and buckets
# ---------------------------------------------------------------------------

# Six hand-built rows (dte_l, dte_r, dte_t, dte_b on the 0-1 scale). Chosen so l+r == t+b == 1,
# which makes each ratio equal to `a` exactly (up to the loss function's 1e-6 epsilon) and keeps
# the by-hand arithmetic below tractable. Target ratio points (lr, tb): (50,50) (49,51) via the
# design symmetric pairs A..F below; deviations from 50 land cleanly across all 5 buckets
# (edges 2, 5, 10, 20): A=0 -> bucket0, B=3 -> bucket1, C=7 -> bucket2, D=15 -> bucket3,
# E=25 and F=22 -> bucket4.
_TARGETS_LR = [50.0, 53.0, 49.0, 65.0, 75.0, 58.0]
_TARGETS_TB = [50.0, 51.0, 43.0, 45.0, 40.0, 72.0]
_PRED_LR = [50.0, 55.0, 46.0, 70.0, 71.0, 59.0]
_PRED_TB = [50.0, 50.0, 47.0, 43.0, 46.0, 69.0]


def _hand_built_centering_tensors():
    def to_lr_tb(lr, tb):
        l = torch.tensor(lr) / 100.0; r = 1.0 - l
        t = torch.tensor(tb) / 100.0; b = 1.0 - t
        return torch.stack([l, r, t, b], dim=1)

    targets = to_lr_tb(_TARGETS_LR, _TARGETS_TB)
    scores = to_lr_tb(_PRED_LR, _PRED_TB)
    masks = torch.ones_like(targets)
    pairs = [(0, 1), (2, 3)]
    return scores, targets, masks, pairs


def test_ratio_metrics_hand_computed():
    scores, targets, masks, pairs = _hand_built_centering_tensors()
    result = evaluate.ratio_metrics(scores, targets, masks, pairs)
    # |delta_lr| per row: 0, 2, 3, 5, 4, 1 -> mean 15/6 = 2.5
    assert result["mae_ratio_lr"] == pytest.approx(2.5, abs=1e-3)
    # |delta_tb| per row: 0, 1, 4, 2, 6, 3 -> mean 16/6 = 2.66667
    assert result["mae_ratio_tb"] == pytest.approx(16 / 6, abs=1e-3)
    # row-max(delta_lr, delta_tb): 0, 2, 4, 5, 6, 3 -> only row 0 is <= 1, rows 0 and 1 are <= 2
    assert result["within1"] == pytest.approx(1 / 6, abs=1e-6)
    assert result["within2"] == pytest.approx(2 / 6, abs=1e-6)
    # pooled (pred_dev, tag_dev) points, OLS slope (numpy.polyfit degree 1) of PREDICTED
    # deviation on TAG's (the compression test; see ratio_metrics docstring)
    assert result["slope"] == pytest.approx(0.85908, abs=2e-3)


def test_ratio_metrics_excludes_rows_with_any_missing_mask():
    scores, targets, masks, pairs = _hand_built_centering_tensors()
    masks = masks.clone()
    masks[0, 1] = 0.0  # row 0's dte_r is missing -> row 0 dropped from every metric
    result = evaluate.ratio_metrics(scores, targets, masks, pairs)
    # dropping the (0, 0) point leaves lr deltas 2,3,5,4,1 (mean 15/5=3.0) and
    # tb deltas 1,4,2,6,3 (mean 16/5=3.2)
    assert result["mae_ratio_lr"] == pytest.approx(3.0, abs=1e-3)
    assert result["mae_ratio_tb"] == pytest.approx(3.2, abs=1e-3)
    assert result["within1"] == pytest.approx(0.0, abs=1e-6)


def test_ratio_metrics_nan_when_no_row_qualifies():
    scores, targets, masks, pairs = _hand_built_centering_tensors()
    masks = torch.zeros_like(masks)
    result = evaluate.ratio_metrics(scores, targets, masks, pairs)
    assert all(pd.isna(v) for v in result.values())


def test_bucket_table_hand_computed():
    scores, targets, masks, pairs = _hand_built_centering_tensors()
    target_df = pd.DataFrame({
        "dte_l": targets[:, 0].numpy() * 1000, "dte_r": targets[:, 1].numpy() * 1000,
        "dte_t": targets[:, 2].numpy() * 1000, "dte_b": targets[:, 3].numpy() * 1000,
    })
    buckets = tables_mod.centering_deviation_bucket(target_df)
    assert buckets.tolist() == [0, 1, 2, 3, 4, 4]

    bt = evaluate.bucket_table(scores, targets, masks, pairs, buckets)
    assert list(bt.columns) == ["bucket", "n", "tag_mean_dev", "pred_mean_dev"]
    assert bt.bucket.tolist() == [0, 1, 2, 3, 4]
    assert bt.n.tolist() == [1, 1, 1, 1, 2]
    assert bt.tag_mean_dev.tolist() == pytest.approx([0.0, 3.0, 7.0, 15.0, 23.5], abs=1e-2)
    assert bt.pred_mean_dev.tolist() == pytest.approx([0.0, 5.0, 4.0, 20.0, 20.0], abs=1e-2)


def _trained_centering(surface_tables, tmp_path, monkeypatch, extra_args=()):
    ds, sp = surface_tables
    train_sides, _ = st.load_surface_split(ds, sp, "train")
    val_sides, _ = st.load_surface_split(ds, sp, "val")
    sides = pd.concat([train_sides, val_sides])
    boxes_path = make_boxes_table(tmp_path, sides[sides.view == "rgb"])
    monkeypatch.setenv("TRAINLIB_BOXES", str(boxes_path))

    df = tables_mod.load_task_table("centering_rgb", ds, sp, "train")
    val_df = tables_mod.load_task_table("centering_rgb", ds, sp, "val")
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
                          "--workers", "0", "--input-size", "64", *extra_args])
    return cfg, run_dir


def test_evaluate_centering_writes_ratio_columns_and_buckets(surface_tables, tmp_path, monkeypatch):
    cfg, run_dir = _trained_centering(surface_tables, tmp_path, monkeypatch)
    out = evaluate.main(["--config", str(cfg), "--task", "centering_rgb", "--checkpoint", str(run_dir / "best.pt"),
                         "--split", "val", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    assert out.name == "eval_val.csv"
    t = pd.read_csv(out)
    expected_cols = ["grade_label", "n_rows", "mae_dte_l", "mae_dte_r", "mae_dte_t", "mae_dte_b",
                     "mae_ratio_lr", "mae_ratio_tb", "within1", "within2", "slope"]
    assert list(t.columns) == expected_cols
    assert t.grade_label.iloc[-1] == "ALL"
    # slope is only reported for the ALL row
    assert t.slope.iloc[:-1].isna().all()
    assert not pd.isna(t.slope.iloc[-1])

    bt_out = run_dir / "eval_val_buckets.csv"
    assert bt_out.exists()
    bt = pd.read_csv(bt_out)
    assert list(bt.columns) == ["bucket", "n", "tag_mean_dev", "pred_mean_dev"]
    assert bt.bucket.tolist() == [0, 1, 2, 3, 4]


def test_evaluate_centering_phone_sim_writes_buckets_and_does_not_raise(surface_tables, tmp_path, monkeypatch):
    cfg, run_dir = _trained_centering(surface_tables, tmp_path, monkeypatch)
    out = evaluate.main(["--config", str(cfg), "--task", "centering_rgb", "--checkpoint", str(run_dir / "best.pt"),
                         "--split", "val", "--device", "cpu", "--workers", "0", "--input-size", "64", "--phone-sim"])
    assert out.name == "eval_val_phonesim.csv"
    t = pd.read_csv(out)
    assert "mae_ratio_lr" in t.columns and "mae_ratio_tb" in t.columns
    bt_out = run_dir / "eval_val_phonesim_buckets.csv"
    assert bt_out.exists()
    bt = pd.read_csv(bt_out)
    assert len(bt) == 5
