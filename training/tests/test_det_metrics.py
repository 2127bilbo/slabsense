import math

import torch

from trainlib import det_metrics as dm


def _p(boxes, labels, scores):
    return {"boxes": torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4), "labels": torch.tensor(labels), "scores": torch.tensor(scores)}


def _g(boxes, labels):
    return {"boxes": torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4), "labels": torch.tensor(labels)}


def test_average_precision_perfect_and_empty():
    assert dm.average_precision([(0.9, True), (0.8, True)], n_gt=2) == 1.0
    assert dm.average_precision([], n_gt=2) == 0.0
    assert math.isnan(dm.average_precision([(0.9, True)], n_gt=0))


def test_average_precision_voc_all_point():
    # TP, FP, TP with 2 GT: precision at recalls 0.5 and 1.0 are 1.0 and 2/3 -> AP = 0.5*1 + 0.5*(2/3)
    ap = dm.average_precision([(0.9, True), (0.8, False), (0.7, True)], n_gt=2)
    assert abs(ap - (0.5 + 0.5 * 2 / 3)) < 1e-6


def test_match_is_greedy_by_score_and_one_to_one():
    pred = torch.tensor([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], dtype=torch.float32)
    scores = torch.tensor([0.5, 0.9, 0.7])
    gt = torch.tensor([[0, 0, 10, 10]], dtype=torch.float32)
    assert dm.match(pred, scores, gt) == [False, True, False]


def test_evaluate_detections_two_classes():
    preds = [_p([[0, 0, 10, 10], [20, 20, 30, 30]], [1, 2], [0.9, 0.4]),
             _p([[0, 0, 10, 10]], [1], [0.8])]
    gts = [_g([[0, 0, 10, 10], [20, 20, 30, 30]], [1, 2]),
           _g([[40, 40, 50, 50]], [1])]
    r = dm.evaluate_detections(preds, gts, n_classes=7)
    assert r["n_gt"][1] == 2 and r["n_gt"][2] == 1 and r["n_gt"][3] == 0
    assert r["ap50"][1] == 0.5                      # one TP at 0.9, one FP at 0.8, 2 GT
    assert r["ap50"][2] == 1.0                      # score 0.4 still counts for AP
    assert math.isnan(r["ap50"][3])
    assert abs(r["map50"] - 0.75) < 1e-9
    # at score >= 0.5: class 1 has preds (TP, FP) -> P 0.5, R 0.5; class 2 has no preds -> P nan, R 0
    assert r["precision_by_class"][1] == 0.5 and r["recall_by_class"][1] == 0.5
    assert math.isnan(r["precision_by_class"][2]) and r["recall_by_class"][2] == 0.0
    assert r["precision"] == 0.5 and abs(r["recall"] - 1 / 3) < 1e-9
