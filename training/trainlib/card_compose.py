"""Synthetic card-on-background compositor.

Places a card cutout (RGBA, produced by `card_cutouts.make_cutout`) onto a background image with
random scale/rotation, an optional page-bow warp, a small homography (perspective) jitter, a cast
shadow, optional foreground/background distractors, a chain of photometric/sensor degradations,
and a final letterbox resize to the training resolution. Returns the composited image, the card's
binary mask, and metadata (the card's quad corners in output space, whether it was bowed, the
letterbox transform, its long side in output px, and which distractor -- if any -- was drawn).

Every random draw goes through the caller-supplied `rng` (a `np.random.Generator`), in this fixed
order, so a given seed reproduces a sample bit-for-bit:

  1.  place:        scale factor s ~ U(0.30, 0.95);
                     rotation kind: U() < 0.85 -> continuous angle ~ U(-25, 25),
                                    else -> choice among {90, 180, 270};
                     target centre x ~ U(half_w, canvas - half_w)  (skipped -- centred -- if the
                                                                     rotated card doesn't fit);
                     target centre y ~ U(half_h, canvas - half_h)  (same fallback rule).
  2.  bow:           (only if `force_bow` is None) whether-to-bow ~ U() < 0.5;
                     if bowing: axis ~ integers(0, 2); amplitude fraction ~ U(0.005, 0.025);
                                sign ~ choice([-1, 1]).
                     (`force_bow` skips the whether-draw entirely; the axis/amplitude/sign draws
                     still happen if the (forced) outcome is "bow".)
  3.  homography:    8 shift values in one call, U(-0.08, 0.08) * long_side, shape (4, 2).
  4.  shadow:        whether-to-shadow ~ U() < 0.6;
                     if shadowing: angle theta ~ U(0, 2*pi); shift magnitude ~ U(0.01, 0.03);
                                   darkness ~ U(0.10, 0.40).
  5.  distractor:    (only if `force_distractor` is None) whether ~ U() < 0.3;
                     if drawing one: kind ~ integers(0, 4) over {under, edge, sleeve, hand}
                       (if the draw lands on under/edge but there are no distractor cutouts, one
                       more draw, integers(0, 2), redraws between {sleeve, hand}).
                     (`force_distractor` skips the whether/which draws; if forced to under/edge
                     with no distractor cutouts available, the whole step is skipped -- no draws.)
                     Then, kind-specific draws:
                       under/edge: cutout index ~ integers(0, n); target long-side fraction
                         ~ U(0.3, 0.8); rotation ~ U(0, 360);
                         under only: offset distance fraction ~ U(0.6, 1.2); offset angle
                           ~ U(0, 2*pi);
                         edge only: offset distance fraction ~ U(0.9, 1.3); offset angle
                           ~ U(0, 2*pi);
                       sleeve: size factor ~ U(1.1, 1.4); hue ~ random(); saturation ~ U(0, 0.25);
                         value ~ U(0.3, 0.9); angle jitter ~ U(-5, 5);
                       hand: rx fraction ~ U(0.15, 0.35); ry fraction ~ U(0.15, 0.35); colour
                         index ~ integers(0, 3); per-channel jitter ~ U(-15, 15) shape (3,);
                         corner index ~ integers(0, 4).
  6.  degradations (only when `degrade=True`):
        glare:        whether ~ U() < 0.3; if drawing: centre x ~ U(quad x_min, quad x_max);
                       centre y ~ U(quad y_min, quad y_max); rx fraction ~ U(0.10, 0.35);
                       ry fraction ~ U(0.10, 0.35); opacity ~ U(0.20, 0.60).
        blur:         whether ~ U() < 0.6; if drawing: sigma fraction ~ U(0, 1.5).
        noise:        sigma ~ U(1, 6)                          (always drawn).
        jpeg:         quality ~ integers(55, 91)                (always drawn).
        brightness:   factor ~ U(0.75, 1.25)                    (always drawn).
        contrast:     factor ~ U(0.75, 1.25)                    (always drawn).
        resolution:   whether ~ U() < 0.3; if drawing: scale ~ U(0.4, 0.8).
  7.  letterbox: deterministic (no draws) since canvas and out are both square.
"""
from __future__ import annotations

import colorsys
import math

import cv2
import numpy as np
from PIL import Image

DISTRACTOR_KINDS = ("under", "edge", "sleeve", "hand")
_HAND_COLOURS = ((224, 172, 105), (198, 134, 66), (141, 85, 36))
_CANVAS_CORNER_FRACS = ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0))


# --------------------------------------------------------------------------------------------
# Letterbox: pure resize + pad to a square, and the point transforms that go with it.
# --------------------------------------------------------------------------------------------

def letterbox(img: np.ndarray, size: int, pad_colour=(0, 0, 0)) -> tuple[np.ndarray, dict]:
    """Resize `img` so its long side is `size`, pad the short side to a square with `pad_colour`.

    Returns `(out, tf)` where `tf = {"scale", "pad_x", "pad_y", "src_w", "src_h"}` and, for any
    point `p` in `img`'s coordinates, `p * tf["scale"] + (tf["pad_x"], tf["pad_y"])` is that
    point's location in `out`.
    """
    h, w = img.shape[:2]
    scale = size / max(w, h)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
    resized = cv2.resize(img, (new_w, new_h), interpolation=interp)
    pad_x = (size - new_w) / 2.0
    pad_y = (size - new_h) / 2.0
    x0, y0 = int(round(pad_x)), int(round(pad_y))
    if img.ndim == 3:
        out = np.full((size, size, img.shape[2]), pad_colour, dtype=img.dtype)
    else:
        fill = pad_colour[0] if isinstance(pad_colour, (tuple, list)) else pad_colour
        out = np.full((size, size), fill, dtype=img.dtype)
    out[y0:y0 + new_h, x0:x0 + new_w, ...] = resized
    tf = {"scale": float(scale), "pad_x": float(pad_x), "pad_y": float(pad_y), "src_w": int(w), "src_h": int(h)}
    return out, tf


def apply_letterbox_points(pts: np.ndarray, tf: dict) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float64)
    return pts * tf["scale"] + np.array([tf["pad_x"], tf["pad_y"]], dtype=np.float64)


def unletterbox_points(pts: np.ndarray, tf: dict) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float64)
    return (pts - np.array([tf["pad_x"], tf["pad_y"]], dtype=np.float64)) / tf["scale"]


# --------------------------------------------------------------------------------------------
# Bow (page-warp) field and random homography.
# --------------------------------------------------------------------------------------------

def bow_field(w: int, h: int, axis: int, amplitude_px: float, rng: np.random.Generator,
              quad: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Remap fields for a one-axis sinusoidal "page bow" over the card's bounding box.

    `axis == 0` displaces content along y, with `u` running 0->1 along x across the quad's
    bounding box (clamped to [0, 1] outside it, so the field is continuous); `axis == 1`
    displaces along x, with `u` running along y. `rng` is accepted for interface symmetry with
    the other step functions but is not consumed here -- all randomness for the bow is drawn by
    the caller (`compose`) so the documented draw order stays exact.
    """
    del rng
    xx, yy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    x_min, y_min = quad.min(axis=0)
    x_max, y_max = quad.max(axis=0)
    if axis == 0:
        span = max(float(x_max - x_min), 1e-6)
        u = np.clip((xx - float(x_min)) / span, 0.0, 1.0)
        d = amplitude_px * np.sin(np.pi * u)
        map_x = xx
        map_y = yy - d
    else:
        span = max(float(y_max - y_min), 1e-6)
        u = np.clip((yy - float(y_min)) / span, 0.0, 1.0)
        d = amplitude_px * np.sin(np.pi * u)
        map_x = xx - d
        map_y = yy
    return map_x.astype(np.float32), map_y.astype(np.float32)


def random_homography(quad: np.ndarray, max_shift_px: float, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Jitter each of `quad`'s 4 corners independently by U(-max_shift_px, max_shift_px)."""
    quad = np.asarray(quad, dtype=np.float32)
    shift = rng.uniform(-max_shift_px, max_shift_px, size=(4, 2)).astype(np.float32)
    new_quad = (quad + shift).astype(np.float32)
    H = cv2.getPerspectiveTransform(quad, new_quad)
    return H, new_quad


# --------------------------------------------------------------------------------------------
# Small geometry/compositing helpers.
# --------------------------------------------------------------------------------------------

def _transform_points(pts: np.ndarray, A: np.ndarray) -> np.ndarray:
    return cv2.transform(pts.reshape(1, -1, 2).astype(np.float32), A).reshape(-1, 2)


def _place_card(cutout_rgba: np.ndarray, canvas: int, rng: np.random.Generator):
    """Scale + rotate the cutout about its own centre, then translate it to a random canvas
    position such that its rotated bounding box stays inside the canvas (centring the axis that
    doesn't fit, if any). Returns (card_rgba at canvas x canvas, quad [TL,TR,BR,BL], long_side,
    scaled card width, scaled card height) -- the last two are the pre-rotation card footprint in
    canvas pixels, used by the "sleeve" distractor."""
    h0, w0 = cutout_rgba.shape[:2]
    long_axis = max(w0, h0)
    s_factor = rng.uniform(0.30, 0.95)
    s = s_factor * canvas / long_axis
    long_side = s_factor * canvas

    if rng.random() < 0.85:
        angle_deg = float(rng.uniform(-25.0, 25.0))
    else:
        angle_deg = float(rng.choice(np.array([90.0, 180.0, 270.0])))

    center = (w0 / 2.0, h0 / 2.0)
    M = cv2.getRotationMatrix2D(center, angle_deg, s)
    corners0 = np.array([[0, 0], [w0, 0], [w0, h0], [0, h0]], dtype=np.float32)  # TL, TR, BR, BL
    corners_t = _transform_points(corners0, M)
    half_w = float(np.max(np.abs(corners_t[:, 0] - center[0])))
    half_h = float(np.max(np.abs(corners_t[:, 1] - center[1])))

    if 2 * half_w <= canvas:
        tx = rng.uniform(half_w, canvas - half_w)
    else:
        tx = canvas / 2.0
    if 2 * half_h <= canvas:
        ty = rng.uniform(half_h, canvas - half_h)
    else:
        ty = canvas / 2.0

    A = M.copy()
    A[0, 2] += tx - center[0]
    A[1, 2] += ty - center[1]

    card_rgba = cv2.warpAffine(cutout_rgba, A, (canvas, canvas), flags=cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    quad = _transform_points(corners0, A).astype(np.float32)
    return card_rgba, quad, long_side, w0 * s, h0 * s


def _composite_rgba(base_rgb: np.ndarray, rgba_canvas: np.ndarray) -> np.ndarray:
    a = rgba_canvas[..., 3:4] / 255.0
    return base_rgb * (1.0 - a) + rgba_canvas[..., :3] * a


def _place_distractor(distractor_rgba: np.ndarray, target_long: float, rotation_deg: float,
                       new_center: tuple[float, float], canvas: int) -> np.ndarray:
    dh, dw = distractor_rgba.shape[:2]
    s_d = target_long / max(dw, dh)
    center = (dw / 2.0, dh / 2.0)
    M = cv2.getRotationMatrix2D(center, rotation_deg, s_d)
    M[0, 2] += new_center[0] - center[0]
    M[1, 2] += new_center[1] - center[1]
    return cv2.warpAffine(distractor_rgba, M, (canvas, canvas), flags=cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def _hsv_colour(h: float, s: float, v: float) -> np.ndarray:
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return np.array([r, g, b], dtype=np.float64) * 255.0


# --------------------------------------------------------------------------------------------
# Degradation steps (each takes/returns a float32 canvas x canvas x 3 image, 0..255 range).
# --------------------------------------------------------------------------------------------

def _apply_glare(img: np.ndarray, quad: np.ndarray, long_side: float, rng: np.random.Generator) -> np.ndarray:
    if rng.random() >= 0.3:
        return img
    x_min, y_min = quad.min(axis=0)
    x_max, y_max = quad.max(axis=0)
    cx = rng.uniform(float(x_min), float(x_max))
    cy = rng.uniform(float(y_min), float(y_max))
    rx = rng.uniform(0.10, 0.35) * long_side
    ry = rng.uniform(0.10, 0.35) * long_side
    opacity = rng.uniform(0.20, 0.60)
    h, w = img.shape[:2]
    mask = np.zeros((h, w), dtype=np.float32)
    cv2.ellipse(mask, (int(round(cx)), int(round(cy))), (max(1, int(round(rx))), max(1, int(round(ry)))),
                0, 0, 360, 1.0, -1)
    sigma = max(0.03 * long_side, 1e-3)
    mask = cv2.GaussianBlur(mask, (0, 0), sigma)
    m = (mask * opacity)[..., None]
    return img * (1.0 - m) + 255.0 * m


def _apply_blur(img: np.ndarray, canvas: int, out: int, rng: np.random.Generator) -> np.ndarray:
    if rng.random() >= 0.6:
        return img
    sigma = rng.uniform(0.0, 1.5) * (canvas / out)
    if sigma <= 1e-6:
        return img
    return cv2.GaussianBlur(img, (0, 0), sigma)


def _apply_noise(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    sigma = rng.uniform(1.0, 6.0)
    noise = rng.normal(0.0, sigma, size=img.shape)
    return np.clip(img + noise, 0, 255)


def _apply_jpeg(img_u8: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    quality = int(rng.integers(55, 91))
    bgr = cv2.cvtColor(img_u8, cv2.COLOR_RGB2BGR)
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return img_u8
    decoded = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)


def _apply_brightness_contrast(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    brightness = rng.uniform(0.75, 1.25)
    contrast = rng.uniform(0.75, 1.25)
    out = (img.astype(np.float64) - 128.0) * contrast + 128.0
    out = out * brightness
    return np.clip(out, 0, 255)


def _apply_resolution_loss(img_u8: np.ndarray, canvas: int, rng: np.random.Generator) -> np.ndarray:
    if rng.random() >= 0.3:
        return img_u8
    scale = rng.uniform(0.4, 0.8)
    small = max(1, int(round(canvas * scale)))
    down = cv2.resize(img_u8, (small, small), interpolation=cv2.INTER_LINEAR)
    return cv2.resize(down, (canvas, canvas), interpolation=cv2.INTER_LINEAR)


# --------------------------------------------------------------------------------------------
# Compose.
# --------------------------------------------------------------------------------------------

def compose(
    rng: np.random.Generator,
    cutout: Image.Image,
    background: np.ndarray,
    distractor_cutouts: list[Image.Image] | None = None,
    canvas: int = 1024,
    out: int = 512,
    *,
    degrade: bool = True,
    force_bow: bool | None = None,
    force_distractor: str | None = None,
) -> dict:
    """Compose one synthetic training sample. See the module docstring for the exact, ordered
    sequence of random draws (a given `rng` state reproduces a sample bit-for-bit)."""
    distractor_cutouts = distractor_cutouts or []
    if background.shape[:2] != (canvas, canvas):
        background = cv2.resize(background, (canvas, canvas), interpolation=cv2.INTER_LINEAR)

    cutout_rgba = np.asarray(cutout.convert("RGBA"), dtype=np.float32)

    # 1. place
    card_rgba, quad, long_side, card_w_canvas, card_h_canvas = _place_card(cutout_rgba, canvas, rng)

    # 2. bow
    do_bow = rng.random() < 0.5 if force_bow is None else bool(force_bow)
    bowed = False
    if do_bow:
        axis = int(rng.integers(0, 2))
        amp_frac = rng.uniform(0.005, 0.025)
        sign = float(rng.choice(np.array([-1.0, 1.0])))
        amplitude_px = amp_frac * long_side * sign
        map_x, map_y = bow_field(canvas, canvas, axis, amplitude_px, rng, quad)
        card_rgba = cv2.remap(card_rgba, map_x, map_y, interpolation=cv2.INTER_LINEAR, borderValue=0)
        bowed = True

    # 3. homography (quad tracked through this; bow is NOT reflected in the label)
    max_shift_px = 0.08 * long_side
    H, quad = random_homography(quad, max_shift_px, rng)
    card_rgba = cv2.warpPerspective(card_rgba, H, (canvas, canvas), flags=cv2.INTER_LINEAR,
                                     borderMode=cv2.BORDER_CONSTANT, borderValue=0)

    # mask is derived from the main cutout's alpha alone, right after its last geometric step.
    alpha_canvas_u8 = (card_rgba[..., 3] > 127).astype(np.uint8) * 255

    # 4. shadow (drawn now so distractor draws below follow the documented order)
    do_shadow = rng.random() < 0.6
    shadow_params = None
    if do_shadow:
        theta = rng.uniform(0.0, 2 * math.pi)
        shift_mag = rng.uniform(0.01, 0.03) * long_side
        darkness = rng.uniform(0.10, 0.40)
        shadow_params = (theta, shift_mag, darkness)

    # 5. distractor: decide kind (or honour force_distractor), draw its own parameters, and
    # render it into an RGBA canvas x canvas array ready to alpha-composite (sleeve/hand render
    # into that same RGBA form, at full opacity 0.9/1.0 respectively).
    distractor_name, distractor_rgba = _draw_distractor(
        rng, force_distractor, distractor_cutouts, quad, long_side, canvas,
        card_w_canvas, card_h_canvas,
    )

    # --- render ---
    bg = background.astype(np.float64).copy()

    if distractor_name in ("under", "sleeve") and distractor_rgba is not None:
        bg = _composite_rgba(bg, distractor_rgba)

    if shadow_params is not None:
        theta, shift_mag, darkness = shadow_params
        shift = (shift_mag * math.cos(theta), shift_mag * math.sin(theta))
        T = np.array([[1, 0, shift[0]], [0, 1, shift[1]]], dtype=np.float32)
        alpha_f = (card_rgba[..., 3:4] / 255.0)[..., 0].astype(np.float32)
        shadow_mask = cv2.warpAffine(alpha_f, T, (canvas, canvas), flags=cv2.INTER_LINEAR,
                                      borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        sigma = max(0.01 * long_side, 1e-3)
        shadow_mask = cv2.GaussianBlur(shadow_mask, (0, 0), sigma)
        bg = bg * (1.0 - darkness * shadow_mask[..., None])
        bg = np.clip(bg, 0, 255)

    alpha = card_rgba[..., 3:4] / 255.0
    img = bg * (1.0 - alpha) + card_rgba[..., :3] * alpha

    if distractor_name in ("edge", "hand") and distractor_rgba is not None:
        img = _composite_rgba(img, distractor_rgba)

    img = np.clip(img, 0, 255).astype(np.float32)

    # 6. degradations
    if degrade:
        img = _apply_glare(img, quad, long_side, rng)
        img = _apply_blur(img, canvas, out, rng)
        img = _apply_noise(img, rng)
        img_u8 = np.clip(img, 0, 255).astype(np.uint8)
        img_u8 = _apply_jpeg(img_u8, rng)
        img = _apply_brightness_contrast(img_u8, rng)
        img_u8 = np.clip(img, 0, 255).astype(np.uint8)
        img_u8 = _apply_resolution_loss(img_u8, canvas, rng)
    else:
        img_u8 = np.clip(img, 0, 255).astype(np.uint8)

    # 7. letterbox
    final_img, tf = letterbox(img_u8, out, pad_colour=(0, 0, 0))
    mask_resized = cv2.resize(alpha_canvas_u8, (out, out), interpolation=cv2.INTER_AREA)
    mask_final = (mask_resized > 127).astype(np.uint8) * 255

    quad_out = apply_letterbox_points(quad, tf).astype(np.float32)
    edge_lengths = [
        float(np.linalg.norm(quad_out[i] - quad_out[(i + 1) % 4])) for i in range(4)
    ]
    meta = {
        "quad": quad_out,
        "bowed": bowed,
        "letterbox": tf,
        "card_long_side": max(edge_lengths),
        "distractor": distractor_name,
    }
    return {"image": final_img, "mask": mask_final, "meta": meta}


def _draw_distractor(
    rng: np.random.Generator,
    force_distractor: str | None,
    distractor_cutouts: list[Image.Image],
    quad: np.ndarray,
    long_side: float,
    canvas: int,
    card_w_canvas: float,
    card_h_canvas: float,
) -> tuple[str | None, np.ndarray | None]:
    """Decide which distractor (if any) to draw, draw its parameters, and render it into an
    RGBA canvas x canvas array ready to alpha-composite. Returns `(name, rgba)`, or `(None, None)`
    if no distractor is drawn."""
    has_cutouts = len(distractor_cutouts) > 0

    if force_distractor is None:
        if rng.random() >= 0.3:
            return None, None
        kind = DISTRACTOR_KINDS[int(rng.integers(0, 4))]
        if kind in ("under", "edge") and not has_cutouts:
            kind = ("sleeve", "hand")[int(rng.integers(0, 2))]
    else:
        kind = force_distractor
        if kind in ("under", "edge") and not has_cutouts:
            return None, None

    if kind in ("under", "edge"):
        idx = int(rng.integers(0, len(distractor_cutouts)))
        distractor_rgba = np.asarray(distractor_cutouts[idx].convert("RGBA"), dtype=np.float32)
        target_long = rng.uniform(0.3, 0.8) * long_side
        rotation = rng.uniform(0.0, 360.0)
        if kind == "under":
            offset_dist = rng.uniform(0.6, 1.2) * long_side
            offset_angle = rng.uniform(0.0, 2 * math.pi)
            main_cx, main_cy = quad.mean(axis=0)
            new_center = (main_cx + offset_dist * math.cos(offset_angle),
                          main_cy + offset_dist * math.sin(offset_angle))
        else:
            edge_dist = rng.uniform(0.9, 1.3) * (canvas / 2.0)
            edge_angle = rng.uniform(0.0, 2 * math.pi)
            new_center = (canvas / 2.0 + edge_dist * math.cos(edge_angle),
                          canvas / 2.0 + edge_dist * math.sin(edge_angle))
        rendered = _place_distractor(distractor_rgba, target_long, rotation, new_center, canvas)
        return kind, rendered

    if kind == "sleeve":
        size_factor = rng.uniform(1.1, 1.4)
        hue = rng.random()
        sat = rng.uniform(0.0, 0.25)
        val = rng.uniform(0.3, 0.9)
        angle_jitter = rng.uniform(-5.0, 5.0)
        rect_w = card_w_canvas * size_factor
        rect_h = card_h_canvas * size_factor
        edge = quad[1] - quad[0]  # TR - TL, the card's current on-canvas orientation
        base_angle = math.degrees(math.atan2(float(edge[1]), float(edge[0])))
        cx, cy = quad.mean(axis=0)
        box = cv2.boxPoints(((float(cx), float(cy)), (rect_w, rect_h), base_angle + angle_jitter))
        mask = np.zeros((canvas, canvas), dtype=np.float32)
        cv2.fillPoly(mask, [np.round(box).astype(np.int32)], 1.0)
        colour = _hsv_colour(hue, sat, val)
        rendered = np.zeros((canvas, canvas, 4), dtype=np.float32)
        rendered[..., :3] = colour
        rendered[..., 3] = mask * (0.9 * 255.0)
        return "sleeve", rendered

    # hand
    rx = rng.uniform(0.15, 0.35) * canvas
    ry = rng.uniform(0.15, 0.35) * canvas
    colour_idx = int(rng.integers(0, 3))
    jitter = rng.uniform(-15.0, 15.0, size=3)
    corner_idx = int(rng.integers(0, 4))
    fx, fy = _CANVAS_CORNER_FRACS[corner_idx]
    center = (fx * canvas, fy * canvas)
    colour = np.clip(np.array(_HAND_COLOURS[colour_idx], dtype=np.float64) + jitter, 0, 255)
    mask = np.zeros((canvas, canvas), dtype=np.float32)
    cv2.ellipse(mask, (int(round(center[0])), int(round(center[1]))),
                (max(1, int(round(rx))), max(1, int(round(ry)))), 0, 0, 360, 1.0, -1)
    rendered = np.zeros((canvas, canvas, 4), dtype=np.float32)
    rendered[..., :3] = colour
    rendered[..., 3] = mask * 255.0
    return "hand", rendered
