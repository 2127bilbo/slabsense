import cv2
import numpy as np

from trainlib import card_compose, card_metrics


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


def test_mask_to_quad_recovers_rotated_rectangle_corners():
    h, w = 300, 300
    quad = _rect_quad(150, 150, 160, 100, 20.0)
    mask = _fill_quad(quad, h, w)

    quad_pred, contour = card_metrics.mask_to_quad(mask)

    assert quad_pred is not None
    assert contour is not None
    dists = np.linalg.norm(quad_pred.astype(np.float64) - quad, axis=1)
    assert np.all(dists < 1.5), dists


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
