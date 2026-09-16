"""Surface detector data prep: `pull` sfx images from R2 into the cache, `tile` them into 1024 tiles + index."""
from __future__ import annotations

import argparse
import json
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from .cache import build_cache, cache_path
from .config import load_config
from .r2 import reader_from_config
from .surface_tables import boxes_for_view, load_surface_split
from .tiles import TILE, select_tiles

INDEX_COLUMNS = ["tile_path", "cert", "side", "view", "grade_label", "x0", "y0", "tile_w", "tile_h", "n_boxes", "boxes"]


def _boxes_px(boxes: pd.DataFrame, w: int, h: int) -> list[list[float]]:
    return [[int(r.label), r.x * w, r.y * h, r.x * w + r.w * w, r.y * h + r.h * h] for r in boxes.itertuples()]


def tile_side(args) -> list[dict]:
    """Cut one side-view's tiles. args = (image_path, cert, side, view, grade_label, boxes_frac_json, out_dir, seed, neg_per_side).
    boxes_frac_json: JSON list of [label, x, y, w, h] fractions. Returns index rows (tile_path relative to cache_dir)."""
    image_path, cert, side, view, grade_label, boxes_json, out_dir, seed, neg_per_side = args
    out_dir = Path(out_dir)
    rows = []
    with Image.open(image_path) as im:
        im = im.convert("RGB")
        w, h = im.size
        boxes_px = [[lb, x * w, y * h, x * w + bw * w, y * h + bh * h] for lb, x, y, bw, bh in json.loads(boxes_json)]
        rng = np.random.default_rng((seed * 1_000_003 + int.from_bytes(f"{cert}/{side}/{view}".encode(), "little") % 1_000_003) % (2**32))
        for x0, y0, kept in select_tiles(w, h, boxes_px, rng, neg_per_side):
            tw, th = min(TILE, w - x0), min(TILE, h - y0)
            name = f"{cert}_{side}_{view}_{x0}_{y0}.jpg"
            dest = out_dir / name
            if not dest.exists():
                tmp = dest.with_suffix(".part")
                im.crop((x0, y0, x0 + tw, y0 + th)).save(tmp, format="JPEG", quality=95, subsampling=0)
                tmp.replace(dest)
            rows.append({"tile_path": f"tiles/{out_dir.name}/{name}", "cert": cert, "side": side, "view": view,
                         "grade_label": grade_label, "x0": x0, "y0": y0, "tile_w": tw, "tile_h": th,
                         "n_boxes": len(kept), "boxes": json.dumps(kept)})
    return rows


def build_tile_index(cache_dir: Path, split: str, sides: pd.DataFrame, boxes: pd.DataFrame,
                     workers: int = 16, seed: int = 42, neg_per_side: int = 1,
                     progress=None) -> pd.DataFrame:
    cache_dir = Path(cache_dir)
    out_dir = cache_dir / "tiles" / split
    out_dir.mkdir(parents=True, exist_ok=True)
    by_view = {v: {k: g for k, g in boxes_for_view(boxes, v).groupby(["cert", "side"])} for v in ("sfx", "rgb")}
    jobs, skipped = [], 0
    for r in sides.itertuples():
        img = cache_path(cache_dir, r.image_key)
        if not img.exists():
            skipped += 1
            continue
        g = by_view[r.view].get((r.cert, r.side))
        frac = [] if g is None else [[int(b.label), float(b.x), float(b.y), float(b.w), float(b.h)] for b in g.itertuples()]
        jobs.append((str(img), r.cert, r.side, r.view, r.grade_label, json.dumps(frac), str(out_dir), seed, neg_per_side))
    rows: list[dict] = []
    if workers <= 1:
        for j in jobs:
            rows += tile_side(j)
            if progress: progress(len(rows))
    else:
        with Pool(workers) as pool:
            for out in pool.imap_unordered(tile_side, jobs, chunksize=4):
                rows += out
                if progress: progress(len(rows))
    df = pd.DataFrame(rows, columns=INDEX_COLUMNS).sort_values(["cert", "side", "view", "y0", "x0"]).reset_index(drop=True)
    df.attrs["skipped_sides"] = skipped
    df.to_parquet(cache_dir / "tiles" / f"{split}.parquet", index=False)
    return df


def pull(reader, dataset_dir: Path, splits_path: Path, cache_dir: Path, split: str,
         limit_cards: int | None = None, workers: int = 16, seed: int = 42, progress=None) -> dict:
    sides, _ = load_surface_split(dataset_dir, splits_path, split, limit_cards, seed, allow_test=(split == "test"))
    return build_cache(reader, sorted(set(sides.image_key)), cache_dir, workers=workers, progress=progress)


def _parse_splits(spec: str) -> list[tuple[str, int | None]]:
    out = []
    for part in spec.split(","):
        split, _, limit = part.partition(":")
        out.append((split.strip(), int(limit) if limit else None))
    return out


def _run_pull(cfg, split, limit, workers, seed):
    t0 = time.time()
    counts = pull(reader_from_config(cfg), cfg.dataset_dir, cfg.splits_path, cfg.cache_dir, split, limit, workers, seed,
                  progress=lambda c: print(f"  {split}: {c}", flush=True) if (c["downloaded"] + c["skipped"]) % 500 == 0 else None)
    print(f"{split}: {counts} in {time.time() - t0:.0f}s")


def _run_tile(cfg, split, limit, workers, seed, neg_per_side):
    t0 = time.time()
    sides, boxes = load_surface_split(cfg.dataset_dir, cfg.splits_path, split, limit, seed, allow_test=(split == "test"))
    df = build_tile_index(cfg.cache_dir, split, sides, boxes, workers, seed, neg_per_side,
                          progress=lambda n: print(f"  {split}: {n} tiles", flush=True) if n % 2000 < 40 else None)
    print(f"{split}: {len(df)} tiles ({int((df.n_boxes > 0).sum())} positive, {df.n_boxes.sum()} boxes) "
          f"from {len(sides) - df.attrs['skipped_sides']} side-views, {df.attrs['skipped_sides']} not cached, "
          f"{time.time() - t0:.0f}s")


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="surface_cache")
    p.add_argument("command", choices=["pull", "tile"])
    p.add_argument("--config", default="config.toml")
    p.add_argument("--splits", default="train,val", help="e.g. train:500,val:100 (limit is cards; omit for all)")
    p.add_argument("--workers", type=int, default=16); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--neg-per-side", type=int, default=1)
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    for split, limit in _parse_splits(args.splits):
        if args.command == "pull":
            _run_pull(cfg, split, limit, args.workers, args.seed)
        else:
            _run_tile(cfg, split, limit, args.workers, args.seed, args.neg_per_side)


if __name__ == "__main__":
    main()
