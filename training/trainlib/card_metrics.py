"""Metrics for the card segmentation model (plan 2026-09-21-card-model).

`mask_to_quad` fits a 4-corner quadrilateral to a predicted (or ground-truth) binary mask:
`cv2.minAreaRect` gives a coarse, rotation-robust orientation and the four edges of that box (this
never degenerates the way a diagonal-extreme-point split does at/near a 45-degree rotation, where
two of a rectangle's corners can tie exactly); every dense (`CHAIN_APPROX_NONE`) contour point is
assigned to whichever of those four edges it is nearest, each edge's points are trimmed by 8% at
each end (ordered along the edge, dropping the points nearest a corner, where a TAG card's rounded
corner or an occlusion notch would bias a line fit), and a least-squares line is fit to the
remaining middle 84%; the corners are the intersections of adjacent lines. A single
approxPolyDP/hull "corner point" is deliberately never used as a final corner: a real TAG card's
rounded corners put that point ~r(sqrt(2)-1) inside the true (virtual, sharp) corner the app's
outline is defined against, which the edge-line fit below avoids by only ever measuring the
straight parts of each edge.

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


def _angle_sorted(quad: np.ndarray) -> np.ndarray:
    """The 4 points of `quad`, sorted by angle around their own centroid. This walks the points
    around the polygon in a consistent direction (given the shared image coordinate convention,
    y down) but picks no particular starting corner -- it is the shared building block behind
    both `canonical_quad` (which additionally fixes a start corner, for a human-facing label) and
    `corner_error_pct`'s cyclic-shift matching (which deliberately does not, see there for why)."""
    quad = np.asarray(quad, dtype=np.float64)
    centroid = quad.mean(axis=0)
    angles = np.arctan2(quad[:, 1] - centroid[1], quad[:, 0] - centroid[0])
    return quad[np.argsort(angles)]


def canonical_quad(quad: np.ndarray) -> np.ndarray:
    """Order 4 corner points as TL, TR, BR, BL *by geometry*, regardless of whatever labels/order
    they arrived in: `_angle_sorted`, then rotate the result so the point with the smallest
    `x + y` (image coords, y down => the top-left-most point) comes first.

    This gives a human-facing, TL-first quad (what `mask_to_quad` returns, and what `RealCardVal`
    stores) -- but note `corner_error_pct` does NOT use this function to match corners: the
    `x + y` tie-break below is exact (not just close) at a 45-degree rotation for any rectangle,
    so which point ends up "first" there is decided by sub-pixel rounding noise alone, silently
    swapping in an adjacent physical corner and corrupting a distance-matched metric. Use
    `_angle_sorted` plus a search over all 4 cyclic shifts (as `corner_error_pct` does) for
    anything that compares two quads positionally; reserve this function for display/storage.
    """
    ordered = _angle_sorted(quad)
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


# mask_to_quad: fraction of each edge arc's points dropped at each end before the line fit, so a
# rounded corner's curvature (or a small occlusion notch right at the split point) never enters it.
EDGE_TRIM_FRAC = 0.08


def mask_to_quad(mask_bool: np.ndarray) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Fit a 4-point quad (TL, TR, BR, BL) to `mask_bool`'s largest component.

    `cv2.minAreaRect` gives a coarse box (center, size, angle); every dense (`CHAIN_APPROX_NONE`)
    contour point is assigned to whichever of that box's four edges it is nearest (in the box's own
    rotated frame), each edge's points are ordered along the edge and trimmed by `EDGE_TRIM_FRAC`
    at each end, and a least-squares line is fit to the rest (see module docstring for why the
    corners themselves are never trusted directly, and why this is more robust than splitting the
    contour at its own diagonal-extreme points, which can tie exactly at/near a 45-degree
    rotation).

    Returns `(quad, contour)`; `quad` is `None` when there is no contour at all, when the coarse
    box degenerates (zero width/height), when an edge has too few assigned points left after
    trimming, or when the fit itself degenerates (parallel adjacent edges or a non-finite
    intersection). `contour` is the largest external contour found (or `None` if there was none),
    independent of whether the quad fit itself succeeded.
    """
    mask = largest_component(mask_bool)
    mask_u8 = mask.astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None, None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) <= 0:
        return None, contour

    pts = contour.reshape(-1, 2).astype(np.float64)
    if len(pts) < 4:
        return None, contour

    (cx, cy), (rw, rh), angle_deg = cv2.minAreaRect(contour.astype(np.float32))
    if rw <= 0 or rh <= 0:
        return None, contour
    theta = np.deg2rad(angle_deg)
    c, s = np.cos(theta), np.sin(theta)
    dx, dy = pts[:, 0] - cx, pts[:, 1] - cy
    # local frame: lx/ly along the box's own (possibly rotated) width/height axes.
    lx = dx * c + dy * s
    ly = -dx * s + dy * c
    half_w, half_h = rw / 2.0, rh / 2.0

    # distance from each point to each of the box's 4 sides (top, right, bottom, left); the
    # nearest side "owns" that point. order/trim key: position along the owning edge's own axis.
    dists = np.stack([ly + half_h, half_w - lx, half_h - ly, lx + half_w], axis=1)
    edge_id = np.argmin(dists, axis=1)
    order_key = np.where((edge_id == 0) | (edge_id == 2), lx, ly)

    lines = []
    for e in range(4):
        idx_e = np.nonzero(edge_id == e)[0]
        n_e = len(idx_e)
        if n_e < 3:
            return None, contour
        ordered = idx_e[np.argsort(order_key[idx_e])]
        trim = int(round(EDGE_TRIM_FRAC * n_e))
        core_idx = ordered[trim:n_e - trim] if trim > 0 else ordered
        if len(core_idx) < 2:
            return None, contour
        line = cv2.fitLine(pts[core_idx].astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01).reshape(-1)
        lines.append(line)  # order: top, right, bottom, left

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
    """Mean Euclidean corner distance, matched by geometry, / `long_side` x 100.

    Neither quad is trusted to already share a labelling convention with the other: a caller may
    hand in a ground-truth quad whose TL/TR/BR/BL *labels* were carried through a discrete
    90/180/270 degree rotation without being re-derived from the rotated point's actual position
    (`card_compose._place_card` does exactly this), which would otherwise silently pair the wrong
    corners.

    This does NOT canonicalize through `canonical_quad` to fix that, because `canonical_quad`'s
    own `x + y` tie-break is exact (not just close) at a 45-degree rotation for any rectangle --
    both corner pairs tie exactly, so sub-pixel rounding noise alone decides which point is
    "first", and a pixel-accurate prediction can land on the opposite tie-break outcome from the
    ground truth, silently matching adjacent physical corners and reporting 80%+ error for an
    otherwise perfect fit. Instead: both quads are ordered by angle around their own centroid only
    (`_angle_sorted`, no start-corner tie-break -- both quads share the same winding, image
    coordinates with y down, so this alone fixes *relative* order), and the reported error is the
    MINIMUM, over the 4 cyclic shifts of the true quad against the (fixed) predicted order, of the
    mean per-corner distance. This is exactly equivalent to `canonical_quad` matching whenever the
    tie-break is unambiguous, and immune to it when it is not.
    """
    if long_side <= 0:
        return float("nan")
    pred_sorted = _angle_sorted(quad_pred)
    true_sorted = _angle_sorted(quad_true)
    best = min(
        float(np.linalg.norm(pred_sorted - np.roll(true_sorted, -k, axis=0), axis=1).mean())
        for k in range(4)
    )
    return best / long_side * 100.0


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
    """Per-sample `iou` / `corner_err_pct` / `failure` / `reason` / `gated`.

    `iou` is the plain pixel IoU between the thresholded prediction and `masks_true`; the quad fit
    uses only the prediction -- `meta["quad"]` is the ground truth it is compared against, and
    `meta["card_long_side"]` its normalizer.

    `corner_err_pct` is computed for every sample that has a *fitted* predicted quad (regardless of
    whether that quad passes `is_failure`) -- NaN only when `mask_to_quad` found no usable quad at
    all (`reason == "no_card"`).

    `gated` is whether the TRUE quad itself passes `is_failure` -- i.e. whether the app would even
    accept this sample's ground truth. `failure` is `gated and pred_fails`: a failure is only
    counted where the app's own gate would have accepted the photo, so `fail_rate` (over `gated`
    samples; see `train_card.py`/`evaluate_card.py`) reads as "the app would reject a photo the
    labeller accepted" rather than being dominated by the synthetic distribution's own share of
    geometrically implausible (e.g. near-square, or heavily perspective-jittered) samples (final
    review 2026-09-21, finding 3)."""
    pred_masks = (torch.sigmoid(logits) > 0.5).squeeze(1).detach().cpu().numpy().astype(bool)
    true_masks = (masks_true > 0.5).squeeze(1).detach().cpu().numpy().astype(bool)

    results = []
    for i in range(pred_masks.shape[0]):
        pred_mask = pred_masks[i]
        true_mask = true_masks[i]
        h, w = pred_mask.shape
        meta = metas[i]
        iou_val = iou(pred_mask, true_mask)
        quad_pred, _ = mask_to_quad(pred_mask)
        pred_fails, reason = is_failure(quad_pred, (w, h))
        gated = not is_failure(meta["quad"], (w, h))[0]
        failure = bool(gated and pred_fails)
        if quad_pred is None:
            corner_err = float("nan")
        else:
            corner_err = corner_error_pct(quad_pred, meta["quad"], float(meta["card_long_side"]))
        results.append({"iou": iou_val, "corner_err_pct": corner_err, "failure": failure,
                        "reason": reason, "gated": bool(gated)})
    return results
