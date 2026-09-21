"""Card segmentation model: an FPN-lite decoder over a `timm` `features_only` backbone.

`CardSegNet` predicts one logit per pixel (card vs. not-card) at the input resolution. The
encoder's four feature maps (strides 4, 8, 16, 32) are each projected to 64 channels with a
1x1 "lateral" conv, then combined top-down (deepest first, bilinear-upsampled to the next
level's spatial size and summed) the way an FPN does. At the stride-4 level, two 3x3
conv-BN-ReLU blocks refine the fused features before a final 1x1 conv drops to a single
channel; a last bilinear upsample brings the logits back to the input's H, W. Every resize in
the decoder is driven by the actual feature-map/input shapes, so the model works for any input
size that is a multiple of 32 (the encoder's coarsest stride), not just the training default.
"""
from __future__ import annotations

import timm
import torch
import torch.nn.functional as F
from torch import nn

OUT_INDICES = (1, 2, 3, 4)  # strides 4, 8, 16, 32
LATERAL_CHANNELS = 64


class CardSegNet(nn.Module):
    def __init__(self, encoder: str = "mobilenetv3_large_100", pretrained: bool = True) -> None:
        super().__init__()
        self.encoder_name = encoder
        self.backbone = timm.create_model(encoder, pretrained=pretrained, features_only=True,
                                          out_indices=OUT_INDICES)
        channels = self.backbone.feature_info.channels()
        self.laterals = nn.ModuleList([nn.Conv2d(c, LATERAL_CHANNELS, kernel_size=1) for c in channels])
        self.refine = nn.Sequential(
            nn.Conv2d(LATERAL_CHANNELS, LATERAL_CHANNELS, kernel_size=3, padding=1),
            nn.BatchNorm2d(LATERAL_CHANNELS),
            nn.ReLU(inplace=True),
            nn.Conv2d(LATERAL_CHANNELS, LATERAL_CHANNELS, kernel_size=3, padding=1),
            nn.BatchNorm2d(LATERAL_CHANNELS),
            nn.ReLU(inplace=True),
        )
        self.head = nn.Conv2d(LATERAL_CHANNELS, 1, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        feats = self.backbone(x)
        laterals = [lat(f) for lat, f in zip(self.laterals, feats)]
        y = laterals[-1]
        for lateral in reversed(laterals[:-1]):
            up = F.interpolate(y, size=lateral.shape[-2:], mode="bilinear", align_corners=False)
            y = up + lateral
        y = self.refine(y)
        logits = self.head(y)
        return F.interpolate(logits, size=x.shape[-2:], mode="bilinear", align_corners=False)


def bce_dice(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """BCEWithLogits + (1 - Dice on the sigmoid), equal weight (plan 2026-09-21-card-model)."""
    bce = F.binary_cross_entropy_with_logits(logits, target)
    p = torch.sigmoid(logits)
    dice = (2.0 * (p * target).sum() + 1.0) / (p.sum() + target.sum() + 1.0)
    return bce + (1.0 - dice)


def count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
