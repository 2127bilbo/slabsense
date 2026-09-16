import math

import torch

from trainlib import metrics


def test_auroc_perfect_separation():
    scores = torch.tensor([0.1, 0.2, 0.8, 0.9])
    labels = torch.tensor([0.0, 0.0, 1.0, 1.0])
    assert metrics.auroc(scores, labels) == 1.0


def test_auroc_anti_separation():
    scores = torch.tensor([0.9, 0.8, 0.2, 0.1])
    labels = torch.tensor([0.0, 0.0, 1.0, 1.0])
    assert metrics.auroc(scores, labels) == 0.0


def test_auroc_single_class_is_nan():
    scores = torch.tensor([0.1, 0.5, 0.9])
    labels_all_pos = torch.tensor([1.0, 1.0, 1.0])
    labels_all_neg = torch.tensor([0.0, 0.0, 0.0])
    assert math.isnan(metrics.auroc(scores, labels_all_pos))
    assert math.isnan(metrics.auroc(scores, labels_all_neg))


def test_auroc_ties_are_averaged():
    # a tied pair straddling the classes contributes half credit
    scores = torch.tensor([0.5, 0.5])
    labels = torch.tensor([0.0, 1.0])
    assert metrics.auroc(scores, labels) == 0.5


def test_precision_recall_hand_computed():
    scores = torch.tensor([0.9, 0.6, 0.3, 0.2])
    labels = torch.tensor([1.0, 0.0, 1.0, 0.0])
    # threshold 0.5 -> predicted positive: idx 0, 1
    # tp = idx0 (label1); fp = idx1 (label0); fn = idx2 (label1, missed)
    precision, recall = metrics.precision_recall_at(scores, labels, threshold=0.5)
    assert precision == 0.5
    assert recall == 0.5


def test_precision_recall_undefined_is_nan():
    scores = torch.tensor([0.1, 0.2])
    labels = torch.tensor([0.0, 0.0])
    precision, recall = metrics.precision_recall_at(scores, labels, threshold=0.5)
    assert math.isnan(precision)  # no predicted positives
    assert math.isnan(recall)  # no actual positives
