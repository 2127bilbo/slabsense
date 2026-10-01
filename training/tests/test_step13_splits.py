"""Step 13.1: arbitrary split names (foil2026-train/-val) through tables, train, evaluate, the
cutout and centering-prep CLIs, plus the edges_hr task."""
import json

import pandas as pd
import pytest

from conftest import make_boxes_table, make_cache, orange_card_png
from trainlib import cache as cache_mod
from trainlib import card_cutouts as cc
from trainlib import centering_prep as cp
from trainlib import evaluate, train
from trainlib import tables as tables_mod
from trainlib import surface_tables as st


def _reassign(sp_path, old="test", new="extra"):
    """Move the first `old`-split cert into a new split name; returns that cert."""
    sp = pd.read_parquet(sp_path)
    cert = sp[sp.split == old].cert.iloc[0]
    sp.loc[sp.cert == cert, "split"] = new
    sp.to_parquet(sp_path, index=False)
    return cert


def _write_cfg(tmp_path):
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg = tmp_path / "config.toml"
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    return cfg


# --- tables -----------------------------------------------------------------------------------

def test_edges_hr_task_is_edges_at_double_resolution():
    hr, base = tables_mod.TASKS["edges_hr"], tables_mod.TASKS["edges"]
    assert hr["table"] == base["table"] and hr["targets"] == base["targets"] and hr["key_cols"] == base["key_cols"]
    assert hr["input_size"] == (2048, 384) and hr["cache_resize"] == (2048, 384)
    assert hr["long_side_horizontal"] is True


def test_load_task_table_unknown_split_raises(tables):
    ds, sp = tables
    with pytest.raises(ValueError, match="foil2027"):
        tables_mod.load_task_table("corners", ds, sp, "foil2027")


def test_load_task_tables_concatenates_named_splits(tables):
    ds, sp = tables
    cert = _reassign(sp)  # the old test cert now lives in split "extra"
    df = tables_mod.load_task_tables("corners", ds, sp, ["train", "extra"])
    assert set(df.cert) == {"A1", "B2", cert}
    assert len(df) == 3 * 8  # 2 sides x 4 corners per cert
    with pytest.raises(ValueError, match="frozen"):
        tables_mod.load_task_tables("corners", ds, sp, ["train", "test"])


def test_load_surface_split_unknown_split_raises(surface_tables):
    ds, sp = surface_tables
    with pytest.raises(ValueError, match="foil2027"):
        st.load_surface_split(ds, sp, "foil2027")


# --- train / evaluate -------------------------------------------------------------------------

def test_train_takes_split_lists(tables, tmp_path, capsys):
    ds, sp = tables
    _reassign(sp)
    df = pd.read_parquet(ds / "corners.parquet")
    make_cache(tmp_path, df, 96, 96)
    cfg = _write_cfg(tmp_path)
    run_dir = train.main(["--config", str(cfg), "--task", "corners", "--run-name", "t", "--epochs", "1",
                          "--batch-size", "4", "--backbone", "resnet18", "--no-pretrained", "--device", "cpu",
                          "--workers", "0", "--input-size", "64", "--train-splits", "train,extra", "--val-splits", "val"])
    out = capsys.readouterr().out
    assert "train: 24 rows from splits train,extra" in out  # A1, B2 + the reassigned cert
    assert "val: 8 rows from splits val" in out
    args = json.loads((run_dir / "args.json").read_text())
    assert args["train_splits"] == "train,extra" and args["val_splits"] == "val"


def test_evaluate_accepts_any_split_present_in_the_file(tables, tmp_path):
    ds, sp = tables
    df = pd.read_parquet(ds / "corners.parquet")
    make_cache(tmp_path, df, 96, 96)
    cfg = _write_cfg(tmp_path)
    run_dir = train.main(["--config", str(cfg), "--task", "corners", "--run-name", "t", "--epochs", "1",
                          "--batch-size", "4", "--backbone", "resnet18", "--no-pretrained", "--device", "cpu",
                          "--workers", "0", "--input-size", "64"])
    _reassign(sp)
    out = evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                         "--split", "extra", "--device", "cpu", "--workers", "0", "--input-size", "64"])
    assert out.name == "eval_extra.csv"
    assert pd.read_csv(out).n_rows.iloc[-1] == 8
    with pytest.raises(ValueError, match="frozen"):
        evaluate.main(["--config", str(cfg), "--task", "corners", "--checkpoint", str(run_dir / "best.pt"),
                       "--split", "test", "--device", "cpu", "--workers", "0", "--input-size", "64"])


# --- CLIs -------------------------------------------------------------------------------------

def test_card_cutouts_cli_accepts_a_split_named_in_the_file(surface_tables, tmp_path):
    ds, sp = surface_tables
    cert = _reassign(sp)
    sides, _ = st.load_surface_split(ds, sp, "extra")
    make_boxes_table(tmp_path, sides[sides.view == "rgb"], box=(50, 50, 350, 550), W=400, H=600)
    cfg = _write_cfg(tmp_path)
    with pytest.raises(SystemExit):
        cc.main(["--config", str(cfg), "--splits", "foil2027", "--workers", "1", "--from-cache"])
    cc.main(["--config", str(cfg), "--splits", "extra", "--workers", "1", "--from-cache"])


def test_centering_prep_cli_accepts_a_split_named_in_the_file(surface_tables, tmp_path):
    ds, sp = surface_tables
    cert = _reassign(sp)
    cfg = _write_cfg(tmp_path)
    sides, _ = st.load_surface_split(ds, sp, "extra")
    for key in sides[sides.view == "rgb"].image_key:
        p = cache_mod.cache_path(tmp_path / "cache", key); p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(orange_card_png(400, 600))
    out = tmp_path / "derived" / "boxes.parquet"
    cp.main(["--config", str(cfg), "--view", "rgb", "--splits", "extra", "--workers", "1", "--out", str(out)])
    df = pd.read_parquet(out)
    assert set(df.cert) == {cert} and len(df) == 2 and df.ok.all()
