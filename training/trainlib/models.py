"""Backbone + regression head and the masked Huber loss (spec §7)."""
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
        f = self.backbone(images)
        return torch.sigmoid(self.head(torch.cat([f, sides.to(f.dtype)], dim=1)))


def masked_huber(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor, beta: float = 0.05) -> torch.Tensor:
    per = F.smooth_l1_loss(pred, target, reduction="none", beta=beta) * mask
    denom = mask.sum()
    return per.sum() / denom if denom > 0 else per.sum() * 0.0


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
