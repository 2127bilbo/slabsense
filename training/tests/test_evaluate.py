import pandas as pd
import pytest

from conftest import make_cache
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


def test_evaluate_refuses_test_without_final_eval(tables, tmp_path):
    cfg, run_dir = _trained(tables, tmp_path)
    with pytest.raises(ValueError):
        evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                       "--split", "test", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    out = evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                         "--split", "test", "--final-eval", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    assert out.name == "eval_test.csv"
