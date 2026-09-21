"""Render each `rgb` card image down to a transparent-background PNG cutout: the card rectangle
(per the centering boxes table) with TAG's orange trim and any rounded-corner notches feathered
to transparent. Mirrors `phone_aug.recolour_backdrop`'s flood-fill approach, seeded from each
corner of the crop instead of from the crop stem's known corner/edge slot.
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from PIL import Image
from scipy import ndimage as ndi

from .cache import cache_path
from .config import load_config
from .r2 import reader_from_config
from .surface_tables import load_surface_split

TAG_ORANGE = (247, 126, 44)
SKIP_TOLERANCE = 200
FILL_TOLERANCE = 60
MAX_COMPONENT_FRACTION = 0.02
FEATHER_SIGMA = 1.5
DEFAULT_LONG_SIDE = 1024


def rounded_alpha(rgb: np.ndarray) -> np.ndarray:
    """255 where the crop is card, 0 where it is trim/corner-notch, feathered at the boundary.

    Seeds one flood fill per corner of the crop. A corner seeded near TAG orange grows into the
    sum-abs-diff <= 60 region containing it (4-connected); components larger than 2% of the crop
    area are discarded (that seed's corner is not actually notched — it's card interior that
    happens to be uniform). The union of accepted components is the transparent region.
    """
    a = rgb.astype(np.int16)
    H, W = a.shape[:2]
    orange = np.array(TAG_ORANGE, dtype=np.int16)
    fill = np.zeros((H, W), dtype=bool)
    max_area = MAX_COMPONENT_FRACTION * H * W
    for y, x in ((0, 0), (0, W - 1), (H - 1, 0), (H - 1, W - 1)):
        seed = a[y, x]
        if int(np.abs(seed - orange).sum()) > SKIP_TOLERANCE:
            continue
        mask = np.abs(a - seed).sum(axis=2) <= FILL_TOLERANCE
        lab, _ = ndi.label(mask)
        comp = lab == lab[y, x]
        if comp.sum() > max_area:
            continue
        fill |= comp
    alpha = np.where(fill, 0, 255).astype(np.float32)
    alpha = cv2.GaussianBlur(alpha, (0, 0), FEATHER_SIGMA)
    return np.clip(alpha, 0, 255).astype(np.uint8)


def make_cutout(full_img: Image.Image, box: tuple[int, int, int, int], long_side: int = DEFAULT_LONG_SIDE) -> Image.Image:
    """Crop `full_img` to `box`, compute a feathered rounded-corner alpha from the crop, and
    resize both (LANCZOS) so the long side is `long_side`. Returns an RGBA image."""
    crop = full_img.convert("RGB").crop(tuple(int(v) for v in box))
    arr = np.asarray(crop)
    alpha = rounded_alpha(arr)
    w, h = crop.size
    scale = long_side / max(w, h)
    new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))
    rgb_resized = crop.resize((new_w, new_h), Image.Resampling.LANCZOS)
    alpha_resized = Image.fromarray(alpha, mode="L").resize((new_w, new_h), Image.Resampling.LANCZOS)
    return Image.merge("RGBA", (*rgb_resized.split(), alpha_resized))


def cutout_path(cache_dir: Path, cert: str, side: str) -> Path:
    """`.webp` (final review 2026-09-21, finding 4): measured on 991 local cutouts, WebP q90 with
    (lossless) alpha is ~14 GB at the box's full 55k-side scale vs. PNG's ~99 GB, with RGB error
    (mean abs diff 3.4) below the compositor's own noise/JPEG degradations and alpha exact."""
    return Path(cache_dir) / "cutouts" / f"{cert}_{side}.webp"


# --- CLI: fetch each ok box's rgb image (local cache or R2) and write its cutout. ---

_CFG = None
_READER = None


def _init_worker(cfg) -> None:
    global _CFG, _READER
    _CFG = cfg
    _READER = None


def _get_reader():
    global _READER
    if _READER is None:
        _READER = reader_from_config(_CFG)
    return _READER


def _cutout_one(args) -> str:
    """args = (image_key_or_path, is_local, cert, side, box, out_path, long_side)."""
    src, is_local, cert, side, box, out_path, long_side = args
    out_path = Path(out_path)
    try:
        data = Path(src).read_bytes() if is_local else _get_reader().get(src)
        with Image.open(io.BytesIO(data)) as im:
            out = make_cutout(im, box, long_side)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = out_path.with_suffix(out_path.suffix + ".part")
        out.save(tmp, format="WEBP", quality=90, lossless=False, exact=True)
        os.replace(tmp, out_path)
        return "written"
    except Exception as e:
        print(f"card_cutouts: failed {cert}_{side}: {e}", file=sys.stderr, flush=True)
        return "failed"


def _boxes_path(config_path: Path) -> Path:
    return Path(os.environ.get("TRAINLIB_BOXES") or (Path(config_path).resolve().parent / "derived" / "centering_boxes_rgb.parquet"))


def main(argv=None) -> dict:
    p = argparse.ArgumentParser(prog="card_cutouts")
    p.add_argument("--config", default="config.toml")
    p.add_argument("--splits", default="train,val,test")
    p.add_argument("--limit-cards", type=int, default=None)
    p.add_argument("--workers", type=int, default=16)
    p.add_argument("--from-cache", action="store_true", help="never fetch from R2; missing local files are counted as missing")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)
    cfg = load_config(args.config)

    boxes = pd.read_parquet(_boxes_path(args.config))
    boxes = boxes[boxes.ok]
    box_by_key = {(r.cert, r.side, r.image_key): (r.x0, r.y0, r.x1, r.y1) for r in boxes.itertuples()}

    parts = []
    for part in args.splits.split(","):
        # accept cache_cli's "split:N" form too, so the smoke recipes read the same everywhere
        split, _, limit = part.strip().partition(":")
        if split not in ("train", "val", "test"):
            p.error(f"unknown split {split!r} in --splits (use train, val, test, optionally split:N)")
        n = int(limit) if limit else args.limit_cards
        s, _ = load_surface_split(cfg.dataset_dir, cfg.splits_path, split, n, args.seed,
                                  allow_test=(split == "test"))
        parts.append(s[s.view == "rgb"])
    sides = pd.concat(parts).drop_duplicates(["cert", "side", "image_key"]).reset_index(drop=True)

    jobs = []
    skipped = missing = 0
    for r in sides.itertuples():
        box = box_by_key.get((r.cert, r.side, r.image_key))
        if box is None:
            continue
        out_path = cutout_path(cfg.cache_dir, r.cert, r.side)
        if out_path.exists():
            skipped += 1
            continue
        local = cache_path(cfg.cache_dir, r.image_key)
        if local.exists():
            src, is_local = str(local), True
        elif args.from_cache:
            missing += 1
            continue
        else:
            src, is_local = r.image_key, False
        jobs.append((src, is_local, r.cert, r.side, box, str(out_path), DEFAULT_LONG_SIDE))

    t0 = time.time()
    written = failed = 0
    if args.workers <= 1:
        _init_worker(cfg)
        for j in jobs:
            if _cutout_one(j) == "written":
                written += 1
            else:
                failed += 1
    else:
        with Pool(args.workers, initializer=_init_worker, initargs=(cfg,)) as pool:
            for result in pool.imap_unordered(_cutout_one, jobs, chunksize=8):
                if result == "written":
                    written += 1
                else:
                    failed += 1
    elapsed = time.time() - t0
    counts = {"written": written, "skipped": skipped, "failed": failed, "missing": missing}
    print(f"written={written} skipped={skipped} failed={failed} missing={missing} in {elapsed:.0f}s")
    return counts


if __name__ == "__main__":
    main()
