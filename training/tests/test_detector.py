import torch

from trainlib import detector


def test_build_detector_has_small_anchors_and_eight_classes():
    m = detector.build_detector(num_classes=8, pretrained=False)
    ag = m.rpn.anchor_generator
    assert ag.sizes == ((16,), (32,), (64,), (128,), (256,))
    assert ag.aspect_ratios == ((0.25, 0.5, 1.0, 2.0, 4.0),) * 5
    assert m.roi_heads.box_predictor.cls_score.out_features == 8
    assert m.transform.min_size == (1024,) and m.transform.max_size == 1024


def test_train_mode_returns_losses_and_eval_returns_detections():
    m = detector.build_detector(num_classes=8, pretrained=False)
    imgs = [torch.rand(3, 64, 64), torch.rand(3, 64, 64)]
    tgts = [{"boxes": torch.tensor([[5.0, 5.0, 30.0, 25.0]]), "labels": torch.tensor([2])},
            {"boxes": torch.zeros(0, 4), "labels": torch.zeros(0, dtype=torch.int64)}]
    m.train()
    losses = m(imgs, tgts)
    assert {"loss_classifier", "loss_box_reg", "loss_objectness", "loss_rpn_box_reg"} <= set(losses)
    assert torch.isfinite(sum(losses.values()))
    m.eval()
    with torch.no_grad():
        out = m(imgs)
    assert len(out) == 2 and {"boxes", "labels", "scores"} <= set(out[0])


def test_checkpoint_roundtrip(tmp_path):
    m = detector.build_detector(num_classes=8, pretrained=False)
    p = tmp_path / "best.pt"
    detector.save_checkpoint(m, p, classes=["A"] * 7, epoch=2, map50=0.5)
    m2, ckpt = detector.load_detector(p, torch.device("cpu"))
    assert ckpt["epoch"] == 2 and ckpt["map50"] == 0.5 and ckpt["classes"] == ["A"] * 7
    assert ckpt["anchor_sizes"] == ((16,), (32,), (64,), (128,), (256,))
    a = dict(m.named_parameters())["roi_heads.box_predictor.cls_score.weight"]
    b = dict(m2.named_parameters())["roi_heads.box_predictor.cls_score.weight"]
    assert torch.equal(a, b)
