"""Metrics for the card segmentation model (plan 2026-09-21-card-model).

`mask_to_quad` fits a 4-corner quadrilateral to a predicted (or ground-truth) binary mask: an
`approxPolyDP` 4-point hit is used directly; otherwise the mask's convex hull is split at its four
extreme points and a least-squares line is fit to each of the four resulting arcs, with the
corners taken as the intersections of adjacent lines. This line-fit path is what makes the corner
estimate robust to a bowed card edge, where the raw hull point nearest a corner can be off the
true (straight-edges) corner by more than a naive polygon-approx would allow.

`iou`, `corner_error_pct`, and `is_failure` are the per-sample scalar metrics; `evaluate_batch`
combines them into the per-sample records `train_card.py` and `evaluate_card.py` log.
"""
from __future__ import annotations

import cv2
import numpy as np
import torch

# is_failure: minimum fraction of the frame area the fitted quad must cover.
MIN_AREA_FRAC = 0.15
# is_failure: acceptable range for the rectified short/long side ratio (a standard trading card
# is close to 2.5:3.5 => ~0.71; this range gives slack for fit noise without accepting a near-
# square or wildly non-rectangular fit).
ASPECT_RANGE = (0.66, 0.78)


def largest_component(mask_bool: np.ndarray) -> np.ndarray:
    """The largest 4-connected component of `mask_bool`; an all-`False` mask if none exists."""
    mask_u8 = mask_bool.astype(np.uint8)
    num_labels, labels, stats, _centroids = cv2.connectedComponentsWithStats(mask_u8, connectivity=4)
    areas = stats[1:, cv2.CC_STAT_AREA]
    if areas.size == 0 or areas.max() == 0:
        return np.zeros(mask_bool.shape, dtype=bool)
    best_label = 1 + int(np.argmax(areas))
    return labels == best_label


def canonical_quad(quad: np.ndarray) -> np.ndarray:
    """Order 4 corner points as TL, TR, BR, BL *by geometry*, regardless of whatever labels/order
    they arrived in: sort by angle around the centroid (this walks the points around the polygon
    in a consistent direction), then rotate the result so the point with the smallest `x + y`
    (image coords, y down => the top-left-most point) comes first.

    This is the metric's own labelling convention. It is deliberately independent of any upstream
    convention (e.g. `card_compose._place_card` keeps the cutout's original TL/TR/BR/BL *index*
    through its discrete 90/180/270 degree rotation branch, rather than re-labelling by resulting
    visual position -- so its "TL" can land anywhere after such a rotation). Callers that need to
    compare two quads positionally (`corner_error_pct`) must canonicalize both through this
    function first rather than trust that they already share a convention.
    """
    quad = np.asarray(quad, dtype=np.float64)
    centroid = quad.mean(axis=0)
    angles = np.arctan2(quad[:, 1] - centroid[1], quad[:, 0] - centroid[0])
    ordered = quad[np.argsort(angles)]
    start = int(np.argmin(ordered[:, 0] + ordered[:, 1]))
    return np.roll(ordered, -start, axis=0)


def _intersect_lines(line_a: np.ndarray, line_b: np.ndarray) -> np.ndarray | None:
    """Intersect two `cv2.fitLine`-style lines `(vx, vy, x0, y0)`; `None` if parallel/degenerate."""
    vx1, vy1, x1, y1 = (float(v) for v in line_a)
    vx2, vy2, x2, y2 = (float(v) for v in line_b)
    det = vx1 * (-vy2) - (-vx2) * vy1
    if abs(det) < 1e-9:
        return None
    bx, by = x2 - x1, y2 - y1
    t = (bx * (-vy2) - (-vx2) * by) / det
    point = np.array([x1 + t * vx1, y1 + t * vy1], dtype=np.float64)
    if not np.all(np.isfinite(point)):
        return None
    return point


def mask_to_quad(mask_bool: np.ndarray) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Fit a 4-point quad (TL, TR, BR, BL) to `mask_bool`'s largest component.

    Returns `(quad, contour)`; `quad` is `None` when there is no contour at all, or when the
    convex-hull line-fit path degenerates (parallel adjacent edges, a non-finite intersection, or
    fewer than 4 distinct hull extremes). `contour` is the largest external contour found (or
    `None` if there was none), independent of whether the quad fit itself succeeded.
    """
    mask = largest_component(mask_bool)
    mask_u8 = mask.astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) <= 0:
        return None, contour

    perimeter = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)

    if len(approx) == 4:
        quad = approx.reshape(4, 2).astype(np.float64)
        return canonical_quad(quad).astype(np.float32), contour

    hull = cv2.convexHull(contour)
    hull_pts = hull.reshape(-1, 2).astype(np.float64)
    if len(hull_pts) < 4:
        return None, contour

    x, y = hull_pts[:, 0], hull_pts[:, 1]
    extreme_idx = sorted({int(np.argmax(x + y)), int(np.argmax(x - y)),
                          int(np.argmax(-x - y)), int(np.argmax(-x + y))})
    if len(extreme_idx) != 4:
        return None, contour

    lines = []
    for k in range(4):
        i0, i1 = extreme_idx[k], extreme_idx[(k + 1) % 4]
        arc = hull_pts[i0:i1 + 1] if i0 <= i1 else np.vstack([hull_pts[i0:], hull_pts[:i1 + 1]])
        if len(arc) < 2:
            return None, contour
        line = cv2.fitLine(arc.astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01).reshape(-1)
        lines.append(line)

    corners = []
    for k in range(4):
        point = _intersect_lines(lines[k], lines[(k + 1) % 4])
        if point is None:
            return None, contour
        corners.append(point)
    quad = np.array(corners, dtype=np.float64)
    return canonical_quad(quad).astype(np.float32), contour


def iou(mask_a_bool: np.ndarray, mask_b_bool: np.ndarray) -> float:
    a = np.asarray(mask_a_bool, dtype=bool)
    b = np.asarray(mask_b_bool, dtype=bool)
    union = int(np.logical_or(a, b).sum())
    if union == 0:
        return float("nan")
    inter = int(np.logical_and(a, b).sum())
    return inter / union


def quad_mask(quad: np.ndarray, h: int, w: int) -> np.ndarray:
    mask = np.zeros((h, w), dtype=np.uint8)
    pts = np.round(np.asarray(quad, dtype=np.float64)).astype(np.int32)
    cv2.fillPoly(mask, [pts], 255)
    return mask > 0


def corner_error_pct(quad_pred: np.ndarray, quad_true: np.ndarray, long_side: float) -> float:
    """Mean Euclidean corner distance (matched by geometric order: both canonicalized to TL, TR,
    BR, BL via `canonical_quad`) / `long_side` x 100.

    Both quads are canonicalized here rather than trusted to already share a convention: a caller
    may hand in a ground-truth quad whose TL/TR/BR/BL *labels* were carried through a discrete
    90/180/270 degree rotation without being re-derived from the rotated point's actual position
    (`card_compose._place_card` does exactly this), which would otherwise silently pair the wrong
    corners. `canonical_quad` is idempotent, so this is a no-op for a quad that is already ordered
    this way (e.g. `mask_to_quad`'s output).
    """
    if long_side <= 0:
        return float("nan")
    quad_pred = canonical_quad(quad_pred)
    quad_true = canonical_quad(quad_true)
    dists = np.linalg.norm(quad_pred - quad_true, axis=1)
    return float(dists.mean() / long_side * 100.0)


def is_failure(quad: np.ndarray | None, frame_wh: tuple[int, int]) -> tuple[bool, str]:
    if quad is None:
        return True, "no_card"
    quad = np.asarray(quad, dtype=np.float64)
    w, h = frame_wh
    x, y = quad[:, 0], quad[:, 1]
    area = 0.5 * abs(float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))
    if area < MIN_AREA_FRAC * (w * h):
        return True, "small"

    top = float(np.linalg.norm(quad[1] - quad[0]))
    right = float(np.linalg.norm(quad[2] - quad[1]))
    bottom = float(np.linalg.norm(quad[3] - quad[2]))
    left = float(np.linalg.norm(quad[0] - quad[3]))
    side_a = (top + bottom) / 2.0
    side_b = (left + right) / 2.0
    long_side, short_side = max(side_a, side_b), min(side_a, side_b)
    ratio = short_side / long_side if long_side > 0 else 0.0
    if not (ASPECT_RANGE[0] <= ratio <= ASPECT_RANGE[1]):
        return True, "aspect"
    return False, ""


def evaluate_batch(logits: torch.Tensor, masks_true: torch.Tensor, metas: list[dict]) -> list[dict]:
    """Per-sample `iou` / `corner_err_pct` / `failure` / `reason`.

    `iou` is the plain pixel IoU between the thresholded prediction and `masks_true`; the quad fit
    (and therefore `corner_err_pct` and the failure rule) uses only the prediction -- `meta["quad"]`
    is the ground truth it is compared against, and `meta["card_long_side"]` its normalizer.
    `corner_err_pct` is NaN for a failed sample (there is no usable predicted quad to compare).
    """
    pred_masks = (torch.sigmoid(logits) > 0.5).squeeze(1).detach().cpu().numpy().astype(bool)
    true_masks = (masks_true > 0.5).squeeze(1).detach().cpu().numpy().astype(bool)

    results = []
    for i in range(pred_masks.shape[0]):
        pred_mask = pred_masks[i]
        true_mask = true_masks[i]
        h, w = pred_mask.shape
        iou_val = iou(pred_mask, true_mask)
        quad_pred, _ = mask_to_quad(pred_mask)
        failure, reason = is_failure(quad_pred, (w, h))
        if failure:
            corner_err = float("nan")
        else:
            meta = metas[i]
            corner_err = corner_error_pct(quad_pred, meta["quad"], float(meta["card_long_side"]))
        results.append({"iou": iou_val, "corner_err_pct": corner_err, "failure": bool(failure), "reason": reason})
    return results
