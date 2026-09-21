import io

import cv2
import numpy as np
import pytest
from PIL import Image

from conftest import orange_card_png
from trainlib import card_backgrounds as cb
from trainlib import card_compose as cc
from trainlib import card_cutouts as ccut

CANVAS = 1024
OUT = 512


def _cutout(w=400, h=600, margin=50, long_side=1024):
    img = Image.open(io.BytesIO(orange_card_png(w, h, margin=margin)))
    box = (margin, margin, w - margin, h - margin)
    return ccut.make_cutout(img, box, long_side=long_side)


def _distractor_cutout():
    img = Image.open(io.BytesIO(orange_card_png(300, 450, margin=40)))
    box = (40, 40, 260, 410)
    return ccut.make_cutout(img, box, long_side=800)


def _background(seed=0, size=CANVAS):
    return cb.procedural(np.random.default_rng(seed), size)


def _quad_mask(quad, shape):
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillPoly(mask, [np.round(quad).astype(np.int32)], 255)
    return mask


def _iou(mask_a: np.ndarray, mask_b: np.ndarray) -> float:
    a = mask_a > 127
    b = mask_b > 127
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter) / float(union) if union else 1.0


def test_no_bow_no_distractor_mask_matches_quad_polygon():
    rng = np.random.default_rng(0)
    result = cc.compose(
        rng, _cutout(), _background(1), canvas=CANVAS, out=OUT,
        degrade=False, force_bow=False, force_distractor=None,
    )
    mask = result["mask"]
    quad = result["meta"]["quad"]
    poly_mask = _quad_mask(quad, (OUT, OUT))
    assert _iou(mask, poly_mask) >= 0.98
    assert result["meta"]["bowed"] is False


def test_bow_breaks_quad_iou_and_adds_contour_vertices():
    found = False
    for seed in range(30):
        rng = np.random.default_rng(seed)
        result = cc.compose(
            rng, _cutout(), _background(1), canvas=CANVAS, out=OUT,
            degrade=False, force_bow=True, force_distractor=None,
        )
        mask = result["mask"]
        quad = result["meta"]["quad"]
        poly_mask = _quad_mask(quad, (OUT, OUT))
        iou = _iou(mask, poly_mask)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        largest = max(contours, key=cv2.contourArea)
        peri = cv2.arcLength(largest, True)
        approx = cv2.approxPolyDP(largest, 0.02 * peri, True)
        assert result["meta"]["bowed"] is True
        if iou < 0.985 and len(approx) > 4:
            found = True
            break
    assert found, "expected at least one seed to produce a detectably bowed mask"


def test_letterbox_point_round_trip_is_exact():
    rng = np.random.default_rng(42)
    src = rng.integers(0, 255, size=(500, 300, 3), dtype=np.uint8)
    _, tf = cc.letterbox(src, 512)
    pts = rng.uniform(-50, 550, size=(20, 2))
    boxed = cc.apply_letterbox_points(pts, tf)
    back = cc.unletterbox_points(boxed, tf)
    np.testing.assert_allclose(back, pts, atol=1e-6)


def test_compose_reproducible_with_same_seed_and_documented_shapes():
    cutout = _cutout()
    bg = _background(2)
    r1 = cc.compose(np.random.default_rng(0), cutout, bg, canvas=CANVAS, out=OUT)
    r2 = cc.compose(np.random.default_rng(0), cutout, bg, canvas=CANVAS, out=OUT)

    assert set(r1.keys()) == {"image", "mask", "meta"}
    assert r1["image"].shape == (OUT, OUT, 3)
    assert r1["image"].dtype == np.uint8
    assert r1["mask"].shape == (OUT, OUT)
    assert r1["mask"].dtype == np.uint8
    meta = r1["meta"]
    assert set(meta.keys()) == {"quad", "bowed", "letterbox", "card_long_side", "distractor"}
    assert meta["quad"].shape == (4, 2)
    assert meta["quad"].dtype == np.float32
    assert isinstance(meta["bowed"], bool)
    assert isinstance(meta["card_long_side"], float)

    np.testing.assert_array_equal(r1["image"], r2["image"])
    np.testing.assert_array_equal(r1["mask"], r2["mask"])
    np.testing.assert_allclose(r1["meta"]["quad"], r2["meta"]["quad"])


def test_distractor_under_does_not_leak_into_mask():
    rng = np.random.default_rng(3)
    cutout = _cutout()
    bg = _background(4)
    with_d = cc.compose(
        rng, cutout, bg, distractor_cutouts=[_distractor_cutout()],
        canvas=CANVAS, out=OUT, degrade=False, force_bow=False, force_distractor="under",
    )
    mask = with_d["mask"]
    quad = with_d["meta"]["quad"]
    poly_mask = _quad_mask(quad, (OUT, OUT))
    assert _iou(mask, poly_mask) >= 0.98
    assert with_d["meta"]["distractor"] == "under"

    rng2 = np.random.default_rng(3)
    without_d = cc.compose(
        rng2, cutout, bg, distractor_cutouts=[_distractor_cutout()],
        canvas=CANVAS, out=OUT, degrade=False, force_bow=False, force_distractor=None,
    )
    assert not np.array_equal(with_d["image"], without_d["image"])


def test_bow_field_displacement_shape_and_zero_at_box_edges():
    quad = np.array([[10, 10], [90, 10], [90, 90], [10, 90]], dtype=np.float32)
    rng = np.random.default_rng(0)
    map_x, map_y = cc.bow_field(100, 100, axis=0, amplitude_px=5.0, rng=rng, quad=quad)
    assert map_x.shape == (100, 100)
    assert map_y.shape == (100, 100)
    assert map_x.dtype == np.float32 and map_y.dtype == np.float32
    # at x <= quad x_min, u = 0 so d = amp*sin(0) = 0 -> map_y equals identity there
    np.testing.assert_allclose(map_y[:, 0], np.arange(100, dtype=np.float32), atol=1e-4)


def test_random_homography_returns_matrix_and_shifted_quad():
    quad = np.array([[0, 0], [100, 0], [100, 100], [0, 100]], dtype=np.float32)
    rng = np.random.default_rng(0)
    H, new_quad = cc.random_homography(quad, max_shift_px=8.0, rng=rng)
    assert H.shape == (3, 3)
    assert new_quad.shape == (4, 2)
    assert np.max(np.abs(new_quad - quad)) <= 8.0 + 1e-6
