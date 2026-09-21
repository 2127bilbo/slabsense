import io

import cv2
import numpy as np
import pytest
import torch
from PIL import Image

from conftest import orange_card_png
from trainlib import card_compose, card_cutouts as ccut, card_metrics


def _rect_quad(cx: float, cy: float, w: float, h: float, angle_deg: float) -> np.ndarray:
    """TL, TR, BR, BL corners of a `w x h` rectangle centred at `(cx, cy)`, rotated `angle_deg`."""
    dx, dy = w / 2.0, h / 2.0
    corners = np.array([[-dx, -dy], [dx, -dy], [dx, dy], [-dx, dy]], dtype=np.float64)
    a = np.deg2rad(angle_deg)
    rot = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    corners = corners @ rot.T
    corners[:, 0] += cx
    corners[:, 1] += cy
    return corners.astype(np.float64)


def _fill_quad(quad: np.ndarray, h: int, w: int) -> np.ndarray:
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [np.round(quad).astype(np.int32)], 255)
    return mask > 0


@pytest.mark.parametrize("angle_deg", [0.0, 20.0, 89.0, 90.0, 91.0, 180.0, 270.0])
def test_mask_to_quad_recovers_corners_across_rotations(angle_deg):
    """`_rect_quad` labels TL/TR/BR/BL by construction and then rotates those labelled points
    *without re-sorting them* -- this mirrors `card_compose._place_card`'s own index-preserving
    rotation (it keeps the cutout's original corner index through its discrete 90/180/270 degree
    branch rather than relabelling by the point's resulting visual position). For the discrete
    angles that label no longer matches true visual position, which is exactly the mismatch
    `corner_error_pct` must handle via `canonical_quad` -- so this passes the raw, unsorted `quad`
    straight to `corner_error_pct`, the same way `card_compose`'s ground truth would arrive."""
    h, w = 400, 400
    quad = _rect_quad(200, 200, 160, 100, angle_deg)
    mask = _fill_quad(quad, h, w)

    quad_pred, contour = card_metrics.mask_to_quad(mask)

    assert quad_pred is not None
    assert contour is not None
    err_pct = card_metrics.corner_error_pct(quad_pred, quad, 160.0)
    assert err_pct < 1.5, (angle_deg, err_pct)


def test_mask_to_quad_perspective_skewed_quad():
    h, w = 400, 400
    quad = _rect_quad(200, 200, 160, 240, 0.0)
    skewed = quad.copy()
    skewed[0, 0] += 15.0  # TL nudged right
    skewed[1, 0] -= 15.0  # TR nudged left
    mask = _fill_quad(skewed, h, w)

    quad_pred, _ = card_metrics.mask_to_quad(mask)

    assert quad_pred is not None
    long_side = max(np.linalg.norm(skewed[2] - skewed[1]), np.linalg.norm(skewed[1] - skewed[0]))
    err_pct = card_metrics.corner_error_pct(quad_pred, skewed, long_side)
    assert err_pct < 1.5, err_pct


def test_mask_to_quad_notched_mask_uses_hull_fallback():
    """A notch bitten out of the middle of an edge (simulating occlusion/prediction noise) makes
    the raw contour non-quad under `approxPolyDP`, forcing the convex-hull line-fit path -- the
    one the module docstring says exists specifically for robustness to a non-4-point contour.
    The bite is concave (interior to the rectangle's convex hull), so the hull's own extreme
    points -- and therefore the fitted corners -- are unaffected by it."""
    h, w = 400, 300
    quad = _rect_quad(150, 200, 180, 260, 0.0)  # spans x in [60, 240], y in [70, 330]
    mask = _fill_quad(quad, h, w)
    mask_u8 = mask.astype(np.uint8) * 255
    cv2.rectangle(mask_u8, (220, 180), (245, 220), 0, thickness=-1)  # bite out of the right edge
    notched = mask_u8 > 127

    contour_only = max(
        cv2.findContours(notched.astype(np.uint8) * 255, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0],
        key=cv2.contourArea,
    )
    perimeter = cv2.arcLength(contour_only, True)
    approx = cv2.approxPolyDP(contour_only, 0.02 * perimeter, True)
    assert len(approx) != 4, "test setup must force the non-4-point / hull-fallback path"

    quad_pred, contour = card_metrics.mask_to_quad(notched)

    assert quad_pred is not None
    assert contour is not None
    long_side = max(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[2] - quad[1]))
    err_pct = card_metrics.corner_error_pct(quad_pred, quad, long_side)
    assert err_pct < 1.5, err_pct


def test_mask_to_quad_bowed_mask_still_recovers_near_true_corners():
    h, w = 400, 300
    quad = _rect_quad(150, 200, 180, 260, 0.0)
    mask = _fill_quad(quad, h, w)
    long_side = max(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[2] - quad[1]))
    amplitude_px = 0.03 * long_side

    rng = np.random.default_rng(0)
    map_x, map_y = card_compose.bow_field(w, h, axis=0, amplitude_px=amplitude_px, rng=rng,
                                          quad=quad.astype(np.float32))
    warped = cv2.remap(mask.astype(np.uint8) * 255, map_x, map_y, interpolation=cv2.INTER_LINEAR,
                       borderValue=0)
    warped_bool = warped > 127

    quad_pred, _ = card_metrics.mask_to_quad(warped_bool)

    assert quad_pred is not None
    err_pct = card_metrics.corner_error_pct(quad_pred, quad, long_side)
    assert err_pct < 1.5, err_pct


def test_is_failure_square_is_aspect_failure():
    quad = _rect_quad(100, 100, 100, 100, 0.0)
    failed, reason = card_metrics.is_failure(quad, (200, 200))
    assert (failed, reason) == (True, "aspect")


def test_is_failure_correct_aspect_large_enough_passes():
    frame = 512
    # short/long = 0.71, area = long * short = 0.4 * frame^2
    long_side = np.sqrt(0.4 * frame * frame / 0.71)
    short_side = 0.71 * long_side
    quad = _rect_quad(frame / 2, frame / 2, short_side, long_side, 0.0)
    failed, reason = card_metrics.is_failure(quad, (frame, frame))
    assert (failed, reason) == (False, "")


def test_is_failure_tiny_quad_is_small_failure():
    frame = 512
    long_side = np.sqrt(0.05 * frame * frame / 0.71)
    short_side = 0.71 * long_side
    quad = _rect_quad(frame / 2, frame / 2, short_side, long_side, 0.0)
    failed, reason = card_metrics.is_failure(quad, (frame, frame))
    assert (failed, reason) == (True, "small")


def test_is_failure_none_quad_is_no_card():
    assert card_metrics.is_failure(None, (512, 512)) == (True, "no_card")


def test_iou_identical_and_disjoint_masks():
    a = np.zeros((10, 10), dtype=bool)
    a[2:6, 2:6] = True
    b = a.copy()
    assert card_metrics.iou(a, b) == 1.0

    c = np.zeros((10, 10), dtype=bool)
    c[6:9, 6:9] = True
    assert card_metrics.iou(a, c) == 0.0


def _looks_like_discrete_rotation(quad: np.ndarray) -> bool:
    """`True` when `quad`'s (index 0 -> index 1) edge points far enough off the horizontal that it
    can only have come from `card_compose._place_card`'s discrete 90/180/270 degree branch, not
    its continuous +/-25 degree (plus up to ~8% long-side homography jitter) branch. `meta["quad"]`
    doesn't expose which branch was drawn directly, so this infers it from the public output."""
    edge = quad[1].astype(np.float64) - quad[0].astype(np.float64)
    angle = np.degrees(np.arctan2(edge[1], edge[0])) % 360.0
    centered = angle if angle <= 180.0 else angle - 360.0
    return abs(centered) > 45.0


def test_evaluate_batch_perfect_prediction_including_a_discrete_rotation_sample():
    """A logit map built directly from a composed sample's own ground-truth mask (`degrade=False`,
    so no blur/noise smears the mask edge) is a pixel-perfect "prediction" of that sample -- this
    isolates `evaluate_batch`'s corner-error bookkeeping (in particular, the `corner_error_pct`
    fix for `card_compose`'s index-preserving 90/180/270 rotation label, see `canonical_quad`)
    from the model itself. Loops seeds looking for a discrete-rotation sample (~15% of draws)."""
    # A 250 x 350 crop (aspect 0.714) so `is_failure`'s [0.66, 0.78] aspect gate passes -- this
    # test is about corner-error bookkeeping, not the aspect rule.
    img = Image.open(io.BytesIO(orange_card_png(330, 430, margin=40)))
    box = (40, 40, 290, 390)
    cutout = ccut.make_cutout(img, box, long_side=200)
    canvas, out = 256, 128  # enough resolution that mask-edge quantization stays well under 1%

    found_discrete = False
    for seed in range(200):
        rng = np.random.default_rng(seed)
        bg = np.full((canvas, canvas, 3), 128, dtype=np.uint8)
        sample = card_compose.compose(rng, cutout, bg, canvas=canvas, out=out, degrade=False)
        meta = sample["meta"]
        if not _looks_like_discrete_rotation(meta["quad"]):
            continue
        found_discrete = True

        mask_bool = sample["mask"] > 127
        logit_val = np.where(mask_bool, 10.0, -10.0).astype(np.float32)
        logits = torch.from_numpy(logit_val).unsqueeze(0).unsqueeze(0)
        masks_true = torch.from_numpy(mask_bool.astype(np.float32)).unsqueeze(0).unsqueeze(0)

        results = card_metrics.evaluate_batch(logits, masks_true, [meta])
        r = results[0]
        assert r["iou"] > 0.99, r
        assert not r["failure"], r
        assert r["corner_err_pct"] < 1.0, r
        break

    assert found_discrete, "no discrete-rotation sample found in 200 seeds"
