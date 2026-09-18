"""Find the card rectangle inside TAG's color images (flat orange trim) and write the boxes table."""
from __future__ import annotations

import argparse
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from .cache import cache_path
from .config import load_config
from .surface_tables import load_surface_split

BOX_COLUMNS = ["cert", "side", "image_key", "W", "H", "x0", "y0", "x1", "y1", "ok"]
MARGIN_MIN, MARGIN_MAX, FRACTION = 20, 200, 0.6


def _leading(frac: np.ndarray) -> int:
    n = 0
    while n < len(frac) and frac[n] > FRACTION:
        n += 1
    return n


def detect_card_box(img: Image.Image) -> tuple[tuple[int, int, int, int], bool]:
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    orange = (r > 150) & (g > 60) & (g < 190) & (b < 110) & ((r - b) > 80)
    col, row = orange.mean(axis=0), orange.mean(axis=1)
    left, right = _leading(col), _leading(col[::-1])
    top, bottom = _leading(row), _leading(row[::-1])
    H, W = orange.shape
    box = (left, top, W - right, H - bottom)
    ok = all(MARGIN_MIN <= m <= MARGIN_MAX for m in (left, right, top, bottom))
    return (box if ok else (0, 0, W, H)), ok


def _measure_one(args) -> dict | None:
    path, cert, side, key = args
    try:
        with Image.open(path) as im:
            (x0, y0, x1, y1), ok = detect_card_box(im)
            W, H = im.size
    except (OSError, ValueError) as e:
        print(f"centering_prep: failed {path}: {e}")
        return None
    return {"cert": cert, "side": side, "image_key": key, "W": W, "H": H, "x0": x0, "y0": y0, "x1": x1, "y1": y1, "ok": bool(ok)}


def measure_boxes(cache_dir: Path, sides: pd.DataFrame, workers: int = 16, progress=None) -> pd.DataFrame:
    jobs, missing = [], 0
    for r in sides.itertuples():
        p = cache_path(cache_dir, r.image_key)
        if p.exists():
            jobs.append((str(p), r.cert, r.side, r.image_key))
        else:
            missing += 1
    rows = []
    if workers <= 1:
        for j in jobs:
            out = _measure_one(j)
            if out: rows.append(out)
            if progress: progress(len(rows))
    else:
        with Pool(workers) as pool:
            for out in pool.imap_unordered(_measure_one, jobs, chunksize=8):
                if out: rows.append(out)
                if progress: progress(len(rows))
    df = pd.DataFrame(rows, columns=BOX_COLUMNS).sort_values(["cert", "side"]).reset_index(drop=True)
    df.attrs["missing"] = missing
    return df


def main(argv=None) -> Path:
    p = argparse.ArgumentParser(prog="centering_prep")
    p.add_argument("--config", default="config.toml"); p.add_argument("--view", choices=["rgb", "sfx"], default="rgb")
    p.add_argument("--splits", default="train,val,test"); p.add_argument("--limit-cards", type=int)
    p.add_argument("--workers", type=int, default=16); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out", default=None, help="default derived/centering_boxes_<view>.parquet next to config.toml")
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    out = Path(args.out) if args.out else Path(args.config).resolve().parent / "derived" / f"centering_boxes_{args.view}.parquet"
    parts = []
    for split in args.splits.split(","):
        s, _ = load_surface_split(cfg.dataset_dir, cfg.splits_path, split.strip(), args.limit_cards, args.seed,
                                  allow_test=(split.strip() == "test"))
        parts.append(s[s.view == args.view])
    sides = pd.concat(parts).reset_index(drop=True)
    t0 = time.time()
    df = measure_boxes(cfg.cache_dir, sides, args.workers,
                       progress=lambda n: print(f"  {n} measured", flush=True) if n % 5000 == 0 else None)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    print(f"{len(df)} boxes ({int(df.ok.sum())} ok, {int((~df.ok).sum())} not ok, {df.attrs['missing']} images missing) "
          f"→ {out} in {time.time() - t0:.0f}s")
    return out


if __name__ == "__main__":
    main()
