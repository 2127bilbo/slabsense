"""Backbone + regression head and the combined masked loss (spec §7)."""
from __future__ import annotations

from collections import namedtuple

import timm
import torch
import torch.nn as nn
import torch.nn.functional as F

LossTerms = namedtuple("LossTerms", "dist ratio")


class ScoreRegressor(nn.Module):
    def __init__(self, n_out: int, backbone: str = "convnext_tiny", pretrained: bool = True,
                 drop_path_rate: float = 0.0):
        """`drop_path_rate` > 0 enables stochastic depth in the backbone (regularization; v2 runs use 0.2).
        It adds no parameters or buffers, so checkpoints load into a model built with any rate."""
        super().__init__()
        self.backbone = timm.create_model(backbone, pretrained=pretrained, num_classes=0,
                                          drop_path_rate=drop_path_rate)
        feat = self.backbone.num_features
        self.head = nn.Sequential(nn.Linear(feat + 1, 256), nn.GELU(), nn.Dropout(0.1), nn.Linear(256, n_out))

    def forward(self, images: torch.Tensor, sides: torch.Tensor) -> torch.Tensor:
        """Raw logits; apply `to_scores` for probabilities/0-1 scores."""
        f = self.backbone(images)
        return self.head(torch.cat([f, sides.to(f.dtype)], dim=1))


def to_scores(pred: torch.Tensor, kinds: list[str]) -> torch.Tensor:
    """Sigmoid on every channel: probabilities for binary targets, 0-1 scores for regression targets."""
    return torch.sigmoid(pred)


def masked_loss(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor, kinds: list[str],
                beta: float = 0.05, pos_weight: float | None = None,
                ratio_pairs: list[tuple[int, int]] | None = None, ratio_weight: float = 0.0,
                return_terms: bool = False):
    """Masked BCE-with-logits (binary channels) + masked Huber on sigmoid(logits) (regress channels),
    plus an optional centering-ratio term.

    All masked elements across every channel share one denominator, so a channel that is
    entirely masked out (e.g. no marker data in this batch) contributes nothing to either
    the numerator or the denominator.

    `ratio_pairs` is a list of `(i, j)` channel-index tuples. For each pair, the 0-1-scale ratio
    `r(x) = x[:, i] / (x[:, i] + x[:, j] + 1e-6)` is compared (L1) between `sigmoid(pred)` and
    `target`, summed over pairs, per row; only rows where the mask is 1 for both channels of
    EVERY pair count, and the result is the mean over those rows (0, with grad, if none qualify).
    `total = dist + ratio_weight * ratio`. With `return_terms=True`, returns
    `(total, LossTerms(dist=..., ratio=...))`; otherwise just `total`.
    """
    pw = torch.as_tensor(pos_weight, dtype=pred.dtype, device=pred.device) if pos_weight is not None else None
    cols = []
    for j, kind in enumerate(kinds):
        if kind == "binary":
            cols.append(F.binary_cross_entropy_with_logits(pred[:, j], target[:, j], reduction="none", pos_weight=pw))
        else:
            cols.append(F.smooth_l1_loss(torch.sigmoid(pred[:, j]), target[:, j], reduction="none", beta=beta))
    per = torch.stack(cols, dim=1) * mask
    denom = mask.sum()
    dist = per.sum() / denom if denom > 0 else per.sum() * 0.0

    if ratio_pairs:
        probs = torch.sigmoid(pred)
        row_sum = torch.zeros(pred.shape[0], dtype=pred.dtype, device=pred.device)
        row_valid = torch.ones(pred.shape[0], dtype=pred.dtype, device=pred.device)
        for i, j in ratio_pairs:
            p_r = probs[:, i] / (probs[:, i] + probs[:, j] + 1e-6)
            t_r = target[:, i] / (target[:, i] + target[:, j] + 1e-6)
            row_sum = row_sum + torch.abs(p_r - t_r)
            row_valid = row_valid * mask[:, i] * mask[:, j]
        n_valid = row_valid.sum()
        ratio = (row_sum * row_valid).sum() / n_valid if n_valid > 0 else (row_sum * row_valid).sum() * 0.0
    else:
        ratio = dist * 0.0

    total = dist + ratio_weight * ratio
    if return_terms:
        return total, LossTerms(dist=dist, ratio=ratio)
    return total


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
