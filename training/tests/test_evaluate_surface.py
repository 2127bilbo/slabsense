import pandas as pd
import pytest
import torch

from conftest import make_tile_index
from trainlib import detector, evaluate_surface as es


def test_merge_tiles_translates_and_suppresses_duplicates():
    # the same defect seen twice from overlapping tiles (IoU 0.9) keeps only the higher score;
    # a detection from the tile at (300, 300) is translated into image coordinates
    a_img = {"boxes": torch.tensor([[10.0, 10.0, 50.0, 50.0]]), "labels": torch.tensor([1]), "scores": torch.tensor([0.9])}
    dup = {"boxes": torch.tensor([[12.0, 10.0, 52.0, 50.0]]), "labels": torch.tensor([1]), "scores": torch.tensor([0.8])}
    other = {"boxes": torch.tensor([[5.0, 5.0, 25.0, 25.0]]), "labels": torch.tensor([2]), "scores": torch.tensor([0.7])}
    merged = es.merge_tiles([(0, 0, a_img), (0, 0, dup), (300, 300, other)])
    assert merged["boxes"].tolist() == [[10.0, 10.0, 50.0, 50.0], [305.0, 305.0, 325.0, 325.0]]
    assert merged["labels"].tolist() == [1, 2]
    assert torch.allclose(merged["scores"], torch.tensor([0.9, 0.7]))


def test_merge_tiles_empty():
    m = es.merge_tiles([(0, 0, {"boxes": torch.zeros(0, 4), "labels": torch.zeros(0, dtype=torch.int64), "scores": torch.zeros(0)})])
    assert m["boxes"].shape == (0, 4) and m["labels"].shape == (0,)


def _cfg(tmp_path):
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    return cfg


def test_tile_eval_writes_per_grade_and_per_class_tables(tmp_path, capsys):
    cache, idx = make_tile_index(tmp_path, n=4, size=96)
    idx.to_parquet(cache / "tiles" / "val.parquet", index=False)
    m = detector.build_detector(num_classes=8, pretrained=False)
    ck = tmp_path / "best.pt"; detector.save_checkpoint(m, ck, ["CREASE", "DENT", "PIT", "PRINT_DEFECT", "SCRATCH", "STAIN", "TEAR"], 1, 0.0)
    es.main(["--config", str(_cfg(tmp_path)), "--checkpoint", str(ck), "--split", "val", "--device", "cpu",
             "--workers", "0", "--batch-size", "2", "--min-size", "96"])
    out = capsys.readouterr().out
    assert "ALL" in out
    grade = pd.read_csv(tmp_path / "eval_val.csv")
    assert list(grade.columns) == ["grade", "n_tiles", "n_gt", "map50", "precision", "recall"]
    assert grade.grade.iloc[-1] == "ALL" and int(grade.n_tiles.iloc[-1]) == 4 and int(grade.n_gt.iloc[-1]) == 3
    cls = pd.read_csv(tmp_path / "eval_val_classes.csv")
    assert list(cls.columns) == ["class", "n_gt", "ap50", "precision", "recall"] and len(cls) == 7
    views = pd.read_csv(tmp_path / "eval_val_views.csv")
    assert list(views.columns) == ["view", "n_tiles", "n_gt", "map50", "precision", "recall"]
    assert views.view.tolist() == ["rgb", "sfx"] and views.n_tiles.tolist() == [2, 2]


def test_test_split_requires_final_eval(tmp_path):
    cache, idx = make_tile_index(tmp_path, n=2, size=96)
    idx.to_parquet(cache / "tiles" / "test.parquet", index=False)
    m = detector.build_detector(num_classes=8, pretrained=False)
    ck = tmp_path / "best.pt"; detector.save_checkpoint(m, ck, ["A"] * 7, 1, 0.0)
    with pytest.raises(SystemExit):
        es.main(["--config", str(_cfg(tmp_path)), "--checkpoint", str(ck), "--split", "test", "--device", "cpu",
                 "--workers", "0", "--min-size", "96"])
