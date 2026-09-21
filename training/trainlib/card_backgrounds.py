"""Backgrounds for the synthetic card-on-background compositor.

Six procedural generators (`flat`, `gradient`, `wood`, `weave`, `speckle`, `paper`), each a pure
function of `(rng, size)` returning a `size x size x 3` uint8 RGB array; `procedural` picks one of
them uniformly. `RealPool` samples random crops from a folder of owner-supplied photos. `sample_
background` mixes procedural, real, and "clutter" (procedural plus a few pasted-down card cutouts)
sources and finishes with a brightness/colour-temperature jitter shared by all three paths.
"""
from __future__ import annotations

import colorsys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

REAL_EXTENSIONS = (".jpg", ".jpeg", ".png")

_WOOD_BASES = ((120, 80, 40), (160, 110, 60), (90, 60, 30), (180, 140, 90))


def _random_colour(rng: np.random.Generator, s_range: tuple[float, float], v_range: tuple[float, float]) -> np.ndarray:
    h = rng.random()
    s = rng.uniform(*s_range)
    v = rng.uniform(*v_range)
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return np.array([r, g, b], dtype=np.float64) * 255.0


def _rotated_uv(rng: np.random.Generator, size: int) -> tuple[np.ndarray, np.ndarray, float]:
    """Coordinates (u, v) in roughly [0, 1], rotated by a random angle; also returns the angle."""
    angle = rng.uniform(0.0, 2 * np.pi)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    u = (xx * np.cos(angle) + yy * np.sin(angle)) / size
    v = (-xx * np.sin(angle) + yy * np.cos(angle)) / size
    return u, v, angle


def flat(rng: np.random.Generator, size: int) -> np.ndarray:
    colour = _random_colour(rng, (0.0, 0.6), (0.2, 1.0))
    img = np.broadcast_to(colour, (size, size, 3)).astype(np.float64).copy()
    img += rng.normal(0.0, 2.0, size=(size, size, 3))
    return np.clip(img, 0, 255).astype(np.uint8)


def gradient(rng: np.random.Generator, size: int) -> np.ndarray:
    c1 = _random_colour(rng, (0.0, 0.6), (0.2, 1.0))
    c2 = _random_colour(rng, (0.0, 0.6), (0.2, 1.0))
    angle = rng.uniform(0.0, 2 * np.pi)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    proj = xx * np.cos(angle) + yy * np.sin(angle)
    proj -= proj.min()
    span = proj.max()
    t = (proj / span) if span > 0 else np.zeros_like(proj)
    img = c1[None, None, :] * (1 - t[..., None]) + c2[None, None, :] * t[..., None]
    return np.clip(img, 0, 255).astype(np.uint8)


def wood(rng: np.random.Generator, size: int) -> np.ndarray:
    base = np.array(_WOOD_BASES[int(rng.integers(0, len(_WOOD_BASES)))], dtype=np.float64)
    base = base + rng.uniform(-15.0, 15.0, size=3)
    f = rng.uniform(8.0, 25.0)
    g = rng.uniform(1.0, 3.0)
    u, v, _ = _rotated_uv(rng, size)
    stripes = np.sin(2 * np.pi * (u * f + 0.15 * np.sin(2 * np.pi * v * g)))
    factor = 1.0 - 0.125 * (stripes + 1.0)  # darken up to 25% where stripes == 1
    img = base[None, None, :] * factor[..., None]
    img += rng.normal(0.0, 4.0, size=(size, size, 3))
    return np.clip(img, 0, 255).astype(np.uint8)


def weave(rng: np.random.Generator, size: int) -> np.ndarray:
    base = _random_colour(rng, (0.0, 0.6), (0.2, 1.0))
    freq = rng.uniform(60.0, 140.0)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    u = xx / size
    v = yy / size
    wave = 12.0 * np.sin(2 * np.pi * freq * u) + 12.0 * np.sin(2 * np.pi * freq * v)
    img = base[None, None, :] + wave[..., None]
    img += rng.normal(0.0, 3.0, size=(size, size, 3))
    return np.clip(img, 0, 255).astype(np.uint8)


def speckle(rng: np.random.Generator, size: int) -> np.ndarray:
    base = _random_colour(rng, (0.0, 0.6), (0.2, 1.0))
    img = np.broadcast_to(base, (size, size, 3)).astype(np.float64).copy()
    frac = rng.uniform(0.02, 0.05)
    mask = rng.random((size, size)) < frac
    n = int(mask.sum())
    if n:
        bright = rng.random(n) < 0.5
        bright_vals = rng.uniform(200.0, 255.0, n)
        dark_vals = rng.uniform(0.0, 55.0, n)
        vals = np.where(bright, bright_vals, dark_vals)
        img[mask] = vals[:, None]
    blurred = cv2.blur(img.astype(np.float32), (3, 3))
    return np.clip(blurred, 0, 255).astype(np.uint8)


def paper(rng: np.random.Generator, size: int) -> np.ndarray:
    base = _random_colour(rng, (0.0, 0.1), (0.85, 1.0))
    img = np.broadcast_to(base, (size, size, 3)).astype(np.float64).copy()
    n_creases = int(rng.integers(2, 7))
    darken = np.zeros((size, size), dtype=np.float32)
    for _ in range(n_creases):
        x1, y1, x2, y2 = (int(v) for v in rng.integers(0, size, size=4))
        amount = rng.uniform(0.05, 0.15)
        line_mask = np.zeros((size, size), dtype=np.float32)
        cv2.line(line_mask, (x1, y1), (x2, y2), 1.0, thickness=1, lineType=cv2.LINE_AA)
        darken = np.maximum(darken, line_mask * amount)
    darken = cv2.GaussianBlur(darken, (0, 0), 3)
    img *= (1.0 - darken[..., None])
    img += rng.normal(0.0, 2.0, size=(size, size, 3))
    return np.clip(img, 0, 255).astype(np.uint8)


_PROCEDURAL_GENERATORS = (flat, gradient, wood, weave, speckle, paper)


def procedural(rng: np.random.Generator, size: int = 1024) -> np.ndarray:
    idx = int(rng.integers(0, len(_PROCEDURAL_GENERATORS)))
    return _PROCEDURAL_GENERATORS[idx](rng, size)


def report_data_path(label: str, path: Path, count: int, unit: str) -> None:
    """Print a startup line for a `--backgrounds`/`--real` folder default: the resolved absolute
    path and how many `unit` were found there, or a loud NOT FOUND line.

    `train_card.py`/`evaluate_card.py`/`export_card_model.py` used to default these to a
    `training/data/...` *relative* path -- correct only when run from the repo root, but every
    documented command runs them from `training/`, where that default silently resolves to
    `training/training/data/...` and is never found. `RealPool`/`RealCardVal` treat a missing
    folder as an empty pool (by design, so tests don't need one), which made this failure mode
    silent: the real-photo acceptance step would quietly fall back to synthetic-only and report
    "provisional" even after the folder was in place (final review 2026-09-21, finding 2). This
    always prints the resolved absolute path so that ambiguity can't recur, and never fails or
    raises -- a missing folder is a supported (if regrettable) configuration.
    """
    resolved = Path(path).resolve()
    if count > 0:
        print(f"{label}: {resolved} ({count} {unit})")
    else:
        print(f"{label}: {resolved} NOT FOUND / empty -- no {unit}, falling back to synthetic-only")


class RealPool:
    """A folder of owner-supplied photos to sample random crops from (empty folder allowed)."""

    def __init__(self, folder: Path) -> None:
        folder = Path(folder)
        if folder.is_dir():
            self.paths = sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in REAL_EXTENSIONS)
        else:
            self.paths = []

    def __len__(self) -> int:
        return len(self.paths)

    def sample(self, rng: np.random.Generator, size: int) -> np.ndarray:
        path = self.paths[int(rng.integers(0, len(self.paths)))]
        with Image.open(path) as raw:
            oriented = ImageOps.exif_transpose(raw)
            img = oriented.convert("RGB")
        w, h = img.size
        short = min(w, h)
        crop_side = max(1, round(short * rng.uniform(0.4, 1.0)))
        x0 = int(rng.integers(0, w - crop_side + 1))
        y0 = int(rng.integers(0, h - crop_side + 1))
        crop = img.crop((x0, y0, x0 + crop_side, y0 + crop_side))
        crop = crop.resize((size, size), Image.Resampling.BILINEAR)
        if rng.random() < 0.5:
            crop = crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if rng.random() < 0.5:
            crop = crop.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        return np.asarray(crop, dtype=np.uint8)


def _clutter(rng: np.random.Generator, size: int, cutouts: list[Image.Image] | None) -> np.ndarray:
    base = procedural(rng, size)
    if not cutouts:
        return base
    canvas = Image.fromarray(base, mode="RGB")
    n = int(rng.integers(1, 4))  # 1..3 cutouts
    for _ in range(n):
        cutout = cutouts[int(rng.integers(0, len(cutouts)))]
        long_side = max(cutout.size)
        target_long = rng.uniform(0.15, 0.45) * size
        scale = target_long / long_side
        new_w = max(1, round(cutout.size[0] * scale))
        new_h = max(1, round(cutout.size[1] * scale))
        resized = cutout.resize((new_w, new_h), Image.Resampling.LANCZOS)
        angle = rng.uniform(0.0, 360.0)
        rotated = resized.rotate(angle, expand=True)
        rw, rh = rotated.size
        x0 = int(rng.integers(-rw, size))
        y0 = int(rng.integers(-rh, size))
        canvas.paste(rotated, (x0, y0), rotated)
    return np.asarray(canvas, dtype=np.uint8)


def _photometric(rng: np.random.Generator, img: np.ndarray) -> np.ndarray:
    brightness = rng.uniform(0.7, 1.3)
    temp = rng.uniform(-0.1, 0.1)
    out = img.astype(np.float64) * brightness
    out[..., 0] *= (1.0 + temp)
    out[..., 2] *= (1.0 - temp)
    return np.clip(out, 0, 255).astype(np.uint8)


def sample_background(
    rng: np.random.Generator,
    size: int,
    pool: RealPool | None = None,
    clutter_cutouts: list[Image.Image] | None = None,
) -> np.ndarray:
    u = rng.random()
    if u < 1 / 3:
        img = procedural(rng, size)
    elif u < 2 / 3:
        img = pool.sample(rng, size) if pool is not None and len(pool) > 0 else procedural(rng, size)
    else:
        img = _clutter(rng, size, clutter_cutouts)
    return _photometric(rng, img)
