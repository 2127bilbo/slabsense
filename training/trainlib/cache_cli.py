"""Pull the crops a training run needs into the local cache."""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from .cache import build_cache
from .config import load_config
from .r2 import reader_from_config
from .tables import TASKS, load_task_table


def main(argv=None) -> dict:
    p = argparse.ArgumentParser(prog="cache")
    p.add_argument("--config", default="config.toml"); p.add_argument("--task", choices=list(TASKS), required=True)
    p.add_argument("--splits", default="train,val", help="e.g. train:500,val:100 (limit is cards; omit for all)")
    p.add_argument("--workers", type=int, default=16); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--no-resize", action="store_true", help="cache full-resolution crops even for tasks with cache_resize")
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    resize = None if args.no_resize else TASKS[args.task]["cache_resize"]
    keys: list[str] = []
    for part in args.splits.split(","):
        split, _, limit = part.partition(":")
        df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, split.strip(),
                             int(limit) if limit else None, args.seed, allow_test=(split.strip() == "test"))
        keys += df.crop_path.tolist()
    keys = sorted(set(keys))
    if resize:
        w, h = resize
        out_dir = Path(cfg.cache_dir) / "resized" / f"{w}x{h}"
        print(f"{args.task}: {len(keys)} crops, resized to {w}x{h} → {out_dir}")
    else:
        out_dir = cfg.cache_dir
        print(f"{args.task}: {len(keys)} crops, full resolution → {out_dir}")
    t0 = time.time(); last = [0.0]

    def progress(c):
        if time.time() - last[0] > 5:
            last[0] = time.time(); print(f"\r{c}  {sum(c.values()) / (time.time() - t0):.1f}/s", end="", flush=True)

    counts = build_cache(reader_from_config(cfg), keys, cfg.cache_dir, args.workers, progress, resize=resize)
    print(f"\ncache done: {counts} in {time.time() - t0:.0f}s")
    return counts


if __name__ == "__main__":
    main()
