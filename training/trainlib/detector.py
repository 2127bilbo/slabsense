"""Faster R-CNN ResNet50-FPN v2 with small anchors for surface defects (plan 2026-09-16-surface-detector)."""
from __future__ import annotations

from pathlib import Path

import torch
from torchvision.models.detection import FasterRCNN_ResNet50_FPN_V2_Weights, fasterrcnn_resnet50_fpn_v2
from torchvision.models.detection.anchor_utils import AnchorGenerator
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.models.detection.rpn import RPNHead

ANCHOR_SIZES = ((16,), (32,), (64,), (128,), (256,))
ASPECT_RATIOS = ((0.25, 0.5, 1.0, 2.0, 4.0),) * 5
TILE_SIZE = 1024


def build_detector(num_classes: int = 8, pretrained: bool = True):
    if pretrained:
        model = fasterrcnn_resnet50_fpn_v2(weights=FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT,
                                           min_size=TILE_SIZE, max_size=TILE_SIZE, box_detections_per_img=100)
    else:
        model = fasterrcnn_resnet50_fpn_v2(weights=None, weights_backbone=None,
                                           min_size=TILE_SIZE, max_size=TILE_SIZE, box_detections_per_img=100)
    model.rpn.anchor_generator = AnchorGenerator(ANCHOR_SIZES, ASPECT_RATIOS)
    model.rpn.head = RPNHead(model.backbone.out_channels, len(ASPECT_RATIOS[0]), conv_depth=2)
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
    return model


def save_checkpoint(model, path: Path, classes: list[str], epoch: int, map50: float) -> None:
    torch.save({"model": model.state_dict(), "classes": list(classes), "epoch": epoch, "map50": float(map50),
                "anchor_sizes": ANCHOR_SIZES, "aspect_ratios": ASPECT_RATIOS}, path)


def load_detector(path: Path, device: torch.device):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    model = build_detector(num_classes=len(ckpt["classes"]) + 1, pretrained=False)
    model.load_state_dict(ckpt["model"])
    return model.to(device), ckpt
