"""Backbone + regression head and the combined masked loss (spec §7)."""
from __future__ import annotations

import timm
import torch
import torch.nn as nn
import torch.nn.functional as F


class ScoreRegressor(nn.Module):
    def __init__(self, n_out: int, backbone: str = "convnext_tiny", pretrained: bool = True):
        super().__init__()
        self.backbone = timm.create_model(backbone, pretrained=pretrained, num_classes=0)
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
                beta: float = 0.05, pos_weight: float | None = None) -> torch.Tensor:
    """Masked BCE-with-logits (binary channels) + masked Huber on sigmoid(logits) (regress channels).

    All masked elements across every channel share one denominator, so a channel that is
    entirely masked out (e.g. no marker data in this batch) contributes nothing to either
    the numerator or the denominator.
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
    return per.sum() / denom if denom > 0 else per.sum() * 0.0


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
