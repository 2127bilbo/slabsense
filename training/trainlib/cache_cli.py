"""Pull the crops a training run needs into the local cache."""
from __future__ import annotations

import argparse
import time

from .cache import build_cache
from .config import load_config
from .r2 import reader_from_config
from .tables import TASKS, load_task_table


def main(argv=None) -> dict:
    p = argparse.ArgumentParser(prog="cache")
    p.add_argument("--config", default="config.toml"); p.add_argument("--task", choices=list(TASKS), required=True)
    p.add_argument("--splits", default="train,val", help="e.g. train:500,val:100 (limit is cards; omit for all)")
    p.add_argument("--workers", type=int, default=16); p.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    keys: list[str] = []
    for part in args.splits.split(","):
        split, _, limit = part.partition(":")
        df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, split.strip(),
                             int(limit) if limit else None, args.seed, allow_test=(split.strip() == "test"))
        keys += df.crop_path.tolist()
    keys = sorted(set(keys))
    print(f"{args.task}: {len(keys)} crops → {cfg.cache_dir}")
    t0 = time.time(); last = [0.0]

    def progress(c):
        if time.time() - last[0] > 5:
            last[0] = time.time(); print(f"\r{c}  {sum(c.values()) / (time.time() - t0):.1f}/s", end="", flush=True)

    counts = build_cache(reader_from_config(cfg), keys, cfg.cache_dir, args.workers, progress)
    print(f"\ncache done: {counts} in {time.time() - t0:.0f}s")
    return counts


if __name__ == "__main__":
    main()
