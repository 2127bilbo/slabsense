"""Phone-photo augmentation for the corner/edge crop models (handoff Step 9).

Every TAG crop shows TAG's orange backdrop beyond the card; the shipped models learned it as
part of "a corner". These transforms recolour that backdrop, loosen the crop, soften the image
and lose resolution the way a phone upload does. The flood fill mirrors the app's
`repaintBackdrop` (src/lib/tag-crops.js) so training and inference agree.
"""
from __future__ import annotations

import colorsys
import io
import re

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

TAG_ORANGE = (247, 126, 44)
PALETTE = [(0, 0, 0), (255, 255, 255), (64, 64, 64), (128, 128, 128), (192, 192, 192),
           (120, 80, 40), (160, 110, 60), (90, 60, 30)]
_SLOT = re.compile(r"^(corner|edge)_[FB]([A-Z]{1,2})$")


def _slot(stem: str) -> tuple[str, str]:
    m = _SLOT.match(stem)
    if not m:
        raise ValueError(f"not a corner/edge crop stem: {stem!r}")
    return m.group(1), m.group(2)


def seeds_for(stem: str, W: int, H: int) -> list[tuple[int, int]]:
    kind, key = _slot(stem)
    tl, tr, bl, br = (0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)
    if kind == "corner":
        return [{"TL": tl, "TR": tr, "BL": bl, "BR": br}[key]]
    return {"T": [tl, tr], "B": [bl, br], "L": [bl, br], "R": [tl, tr]}[key]


def outer_sides_for(stem: str) -> list[str]:
    kind, key = _slot(stem)
    if kind == "corner":
        return [{"T": "top", "B": "bottom"}[key[0]], {"L": "left", "R": "right"}[key[1]]]
    return [{"T": "top", "B": "bottom", "L": "bottom", "R": "top"}[key]]


def random_fill_colour(rng: np.random.Generator) -> tuple[int, int, int]:
    i = int(rng.integers(0, len(PALETTE) + 1))
    if i < len(PALETTE):
        return PALETTE[i]
    h, s, v = float(rng.random()), float(rng.uniform(0.2, 1.0)), float(rng.uniform(0.3, 1.0))
    return tuple(int(round(c * 255)) for c in colorsys.hsv_to_rgb(h, s, v))


def recolour_backdrop(img: Image.Image, seeds, rng, colour=None, tolerance=60, grow=2, max_fill=0.3,
                      skip_tolerance=200, orange=TAG_ORANGE):
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    H, W = a.shape[:2]
    fill = np.zeros((H, W), dtype=bool)
    for x, y in seeds:
        seed = a[y, x]
        if int(np.abs(seed - np.array(orange)).sum()) > skip_tolerance:
            continue
        mask = np.abs(a - seed).sum(axis=2) <= tolerance
        lab, _ = ndi.label(mask)
        comp = lab == lab[y, x]
        if comp[H // 2, W // 2] or comp.sum() > max_fill * W * H:
            continue
        fill |= comp
    if not fill.any():
        return img, False
    if grow > 0:
        fill = ndi.binary_dilation(fill, iterations=grow)
    if colour is None:
        colour = random_fill_colour(rng)
    out = a.astype(np.uint8).copy()
    out[fill] = colour
    return Image.fromarray(out), True


def loose_crop(img: Image.Image, outer_sides, rng, fill, max_frac=0.15):
    W, H = img.size
    pl = int(round(W * rng.uniform(0, max_frac))) if "left" in outer_sides else 0
    pr = int(round(W * rng.uniform(0, max_frac))) if "right" in outer_sides else 0
    pt = int(round(H * rng.uniform(0, max_frac))) if "top" in outer_sides else 0
    pb = int(round(H * rng.uniform(0, max_frac))) if "bottom" in outer_sides else 0
    if not (pl or pr or pt or pb):
        return img
    canvas = Image.new("RGB", (W + pl + pr, H + pt + pb), tuple(int(c) for c in fill))
    canvas.paste(img, (pl, pt))
    return canvas


def _jpeg(img: Image.Image, quality: int) -> Image.Image:
    buf = io.BytesIO(); img.convert("RGB").save(buf, format="JPEG", quality=quality); buf.seek(0)
    with Image.open(buf) as im:
        return im.convert("RGB")


def soften(img: Image.Image, rng, input_size, radius_in=None, quality=None):
    r_in = float(rng.uniform(0.5, 1.5)) if radius_in is None else radius_in
    r = r_in * (img.width / input_size[0])
    out = img.filter(ImageFilter.GaussianBlur(r))
    q = int(rng.integers(60, 91)) if quality is None else quality
    return _jpeg(out, q) if q is not None else out


def resolution_loss(img: Image.Image, rng, scale=None):
    s = float(rng.uniform(0.35, 0.6)) if scale is None else scale
    W, H = img.size
    small = img.resize((max(1, int(W * s)), max(1, int(H * s))), Image.Resampling.BILINEAR)
    return small.resize((W, H), Image.Resampling.BILINEAR)


def apply_phone(img: Image.Image, stem: str, rng, input_size) -> Image.Image:
    W, H = img.size
    seeds = seeds_for(stem, W, H)
    fill_colour = tuple(int(c) for c in np.asarray(img)[seeds[0][1], seeds[0][0]])
    if rng.random() < 0.6:
        img, filled = recolour_backdrop(img, seeds, rng)
        if filled:
            fill_colour = tuple(int(c) for c in np.asarray(img)[seeds[0][1], seeds[0][0]])
    if rng.random() < 0.3:
        img = loose_crop(img, outer_sides_for(stem), rng, fill_colour)
    if rng.random() < 0.5:
        img = soften(img, rng, input_size)
    if rng.random() < 0.3:
        img = resolution_loss(img, rng)
    return img


def phone_sim(img: Image.Image, stem: str, input_size) -> Image.Image:
    W, H = img.size
    img, _ = recolour_backdrop(img, seeds_for(stem, W, H), None, colour=(0, 0, 0))
    img = img.filter(ImageFilter.GaussianBlur(1.0 * (img.width / input_size[0])))
    return resolution_loss(img, None, scale=0.5)


def phone_sim_soft(img: Image.Image, input_size) -> Image.Image:
    """Deterministic phone-photo softness with no backdrop recolour (there is no crop stem to
    seed a flood fill from for the centering task's whole-card image). Used for eval only
    (Task 3 wires it in); `phone_sim` above is the corner/edge equivalent."""
    img = img.filter(ImageFilter.GaussianBlur(1.0 * (img.width / input_size[0])))
    return resolution_loss(img, None, scale=0.5)
