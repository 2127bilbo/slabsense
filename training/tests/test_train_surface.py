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


def test_init_freezes_stem_and_layer1_like_a_pretrained_build(tmp_path):
    import torch
    from trainlib import detector

    m_pre = detector.build_detector(num_classes=8, pretrained=False)
    ck = tmp_path / "init.pt"
    detector.save_checkpoint(m_pre, ck, ["A"] * 7, 1, 0.0)
    cache, idx = make_tile_index(tmp_path, n=4, size=96)
    idx.to_parquet(cache / "tiles" / "val.parquet", index=False)
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train_surface.main(["--config", str(cfg), "--run-name", "t3", "--epochs", "1", "--batch-size", "2",
                                  "--device", "cpu", "--workers", "0", "--warmup-iters", "1", "--min-size", "96",
                                  "--init", str(ck)])
    ckpt = torch.load(run_dir / "best.pt", map_location="cpu", weights_only=False)
    m = detector.build_detector(num_classes=8, pretrained=False)
    m.load_state_dict(ckpt["model"])
    # stem/layer1 weights must be identical to the init checkpoint (frozen); layer4 must have moved
    init = torch.load(ck, map_location="cpu", weights_only=False)["model"]
    assert torch.equal(init["backbone.body.conv1.weight"], ckpt["model"]["backbone.body.conv1.weight"])
    assert torch.equal(init["backbone.body.layer1.0.conv1.weight"], ckpt["model"]["backbone.body.layer1.0.conv1.weight"])
    assert not torch.equal(init["backbone.body.layer4.0.conv1.weight"], ckpt["model"]["backbone.body.layer4.0.conv1.weight"])


def test_neg_grades_keeps_positives_and_filters_negatives_by_grade(tmp_path):
    cache, idx = make_tile_index(tmp_path, n=4, size=96)
    # tile 3 is the only negative; its grade is "7 NEAR MINT"
    kept = train_surface._index(cache, "train", None, 42, "sfx,rgb", neg_grades="9 MINT,10 GEM MINT")
    assert len(kept) == 3 and (kept.n_boxes > 0).all()
    kept2 = train_surface._index(cache, "train", None, 42, "sfx,rgb", neg_grades="7 NEAR MINT")
    assert len(kept2) == 4
    assert len(train_surface._index(cache, "train", None, 42, "sfx,rgb")) == 4


def test_tile_weights_favor_rare_classes_and_leave_negatives_at_one():
    import json as _json
    idx = pd.DataFrame({"boxes": [_json.dumps([[1, 0, 0, 5, 5]])] * 9 + [_json.dumps([[3, 0, 0, 5, 5]])] + ["[]"] * 2,
                        "n_boxes": [1] * 10 + [0, 0]})
    w = train_surface.tile_weights(idx)
    assert w.shape == (12,) and w.dtype == torch.double
    assert w[10] == 1.0 and w[11] == 1.0
    assert w[9] > w[0]                                   # the single PIT tile outweighs a crease tile
    assert abs(float(w[:10].mean()) - 1.0) < 1e-9          # positives normalized to mean 1


def test_balance_flag_trains(tmp_path):
    cache, idx = make_tile_index(tmp_path, n=4, size=96)
    idx.to_parquet(cache / "tiles" / "val.parquet", index=False)
    cfg = tmp_path / "config.toml"
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    run_dir = train_surface.main(["--config", str(cfg), "--run-name", "tb", "--epochs", "1", "--batch-size", "2",
                                  "--no-pretrained", "--device", "cpu", "--workers", "0", "--warmup-iters", "1",
                                  "--min-size", "96", "--balance", "--neg-grades", "7 NEAR MINT"])
    assert (run_dir / "best.pt").exists()
    assert json.loads((run_dir / "args.json").read_text())["balance"] is True


def test_classes_filter_drops_other_labels_and_emptied_tiles(tmp_path):
    cache, idx = make_tile_index(tmp_path, n=4, size=96)
    # tiles 0..2 carry labels 1, 2, 3; tile 3 is a negative
    kept = train_surface._index(cache, "train", None, 42, "sfx,rgb", classes="CREASE,SCRATCH")
    assert kept.n_boxes.tolist() == [1, 0]                 # label-1 tile kept, negative kept, label-2/3 tiles dropped
    assert json.loads(kept.boxes.iloc[0])[0][0] == 1
    assert len(train_surface._index(cache, "train", None, 42, "sfx,rgb")) == 4
