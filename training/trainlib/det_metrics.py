"""AP50 / precision / recall for detections, no external metric dependency."""
from __future__ import annotations

import torch
from torchvision.ops import box_iou

from .surface_tables import RGB_EXCLUDED_LABELS


def filter_view_preds(pred: dict, view: str) -> dict:
    """Drop predictions whose label is excluded from `view`'s ground truth (rgb has no DENT labels:
    the detector has no view input and cannot know it should not emit them on a flat-light image)."""
    if view != "rgb":
        return pred
    keep = ~torch.isin(pred["labels"], torch.tensor(sorted(RGB_EXCLUDED_LABELS), dtype=pred["labels"].dtype))
    return {"boxes": pred["boxes"][keep], "labels": pred["labels"][keep], "scores": pred["scores"][keep]}


def iou_matrix(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    if len(a) == 0 or len(b) == 0:
        return torch.zeros(len(a), len(b))
    return box_iou(a, b)


def match(pred_boxes: torch.Tensor, pred_scores: torch.Tensor, gt_boxes: torch.Tensor, iou_thr: float = 0.5) -> list[bool]:
    """True-positive flag per prediction (in input order): greedy by descending score, each GT used once."""
    tp = [False] * len(pred_boxes)
    if len(pred_boxes) == 0 or len(gt_boxes) == 0:
        return tp
    ious = iou_matrix(pred_boxes, gt_boxes)
    used = torch.zeros(len(gt_boxes), dtype=torch.bool)
    for i in torch.argsort(pred_scores, descending=True).tolist():
        row = ious[i].clone()
        row[used] = -1.0
        j = int(torch.argmax(row))
        if row[j] >= iou_thr:
            used[j] = True
            tp[i] = True
    return tp


def average_precision(records: list[tuple[float, bool]], n_gt: int) -> float:
    if n_gt == 0:
        return float("nan")
    if not records:
        return 0.0
    recs = sorted(records, key=lambda r: -r[0])
    tp = torch.tensor([1.0 if r[1] else 0.0 for r in recs])
    ctp = torch.cumsum(tp, 0)
    cfp = torch.cumsum(1.0 - tp, 0)
    recall = ctp / n_gt
    precision = ctp / (ctp + cfp)
    # VOC all-point interpolation
    mrec = torch.cat([torch.tensor([0.0]), recall, torch.tensor([1.0])])
    mpre = torch.cat([torch.tensor([0.0]), precision, torch.tensor([0.0])])
    for i in range(len(mpre) - 2, -1, -1):
        mpre[i] = max(mpre[i], mpre[i + 1])
    idx = torch.nonzero(mrec[1:] != mrec[:-1]).flatten()
    return float(((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]).sum())


def evaluate_detections(preds: list[dict], gts: list[dict], n_classes: int, iou_thr: float = 0.5,
                        score_thr: float = 0.5) -> dict:
    labels = range(1, n_classes + 1)
    records = {c: [] for c in labels}
    n_gt = {c: 0 for c in labels}
    tp_thr = {c: 0 for c in labels}; np_thr = {c: 0 for c in labels}
    for p, g in zip(preds, gts):
        for c in labels:
            pm = p["labels"] == c
            gm = g["labels"] == c
            pb, ps, gb = p["boxes"][pm], p["scores"][pm], g["boxes"][gm]
            n_gt[c] += int(gm.sum())
            flags = match(pb, ps, gb, iou_thr)
            records[c] += list(zip(ps.tolist(), flags))
            keep = ps >= score_thr
            flags_thr = match(pb[keep], ps[keep], gb, iou_thr)
            tp_thr[c] += sum(flags_thr); np_thr[c] += int(keep.sum())
    ap = {c: average_precision(records[c], n_gt[c]) for c in labels}
    valid = [ap[c] for c in labels if n_gt[c] > 0]
    prec = {c: (tp_thr[c] / np_thr[c] if np_thr[c] else float("nan")) for c in labels}
    rec = {c: (tp_thr[c] / n_gt[c] if n_gt[c] else float("nan")) for c in labels}
    tot_tp, tot_np, tot_gt = sum(tp_thr.values()), sum(np_thr.values()), sum(n_gt.values())
    return {"map50": (sum(valid) / len(valid)) if valid else float("nan"), "ap50": ap,
            "precision": (tot_tp / tot_np if tot_np else float("nan")),
            "recall": (tot_tp / tot_gt if tot_gt else float("nan")),
            "precision_by_class": prec, "recall_by_class": rec, "n_gt": n_gt}
