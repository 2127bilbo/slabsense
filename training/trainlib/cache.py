"""Resumable local cache of bucket objects, laid out as cache_dir/<key>."""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable


def cache_path(cache_dir: Path, key: str) -> Path:
    return Path(cache_dir) / key


def _fetch(reader, key: str, dest: Path) -> str:
    if dest.exists() and dest.stat().st_size == reader.size(key):
        return "skipped"
    data = reader.get(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    return "downloaded"


def build_cache(reader, keys: list[str], cache_dir: Path, workers: int = 16,
                progress: Callable[[dict], None] | None = None) -> dict[str, int]:
    counts = {"downloaded": 0, "skipped": 0, "failed": 0}
    with ThreadPoolExecutor(max(1, workers)) as ex:
        futures = {ex.submit(_fetch, reader, k, cache_path(cache_dir, k)): k for k in keys}
        for f in as_completed(futures):
            try:
                counts[f.result()] += 1
            except Exception:
                counts["failed"] += 1
            if progress:
                progress(counts)
    return counts
