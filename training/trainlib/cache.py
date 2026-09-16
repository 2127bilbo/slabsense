"""Resumable local cache of bucket objects, laid out as cache_dir/<key>.

When `resize` is set, `build_cache` instead writes a resized JPEG under
cache_dir/resized/<w>x<h>/<key-with-.jpg-extension>, rotating so the long side is
horizontal first (same rule as `data.load_crop`). The full-resolution copy is not
written in that mode.
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from typing import Callable

from PIL import Image


def cache_path(cache_dir: Path, key: str) -> Path:
    return Path(cache_dir) / key


def resized_path(cache_dir: Path, key: str, size: tuple[int, int]) -> Path:
    w, h = size
    return Path(cache_dir) / "resized" / f"{w}x{h}" / Path(key).with_suffix(".jpg")


def _resize_and_save(data: bytes, dest: Path, size: tuple[int, int], quality: int) -> None:
    w, h = size
    with Image.open(BytesIO(data)) as im:
        img = im.convert("RGB")
    if img.height > img.width:
        img = img.transpose(Image.Transpose.ROTATE_90)
    img = img.resize((w, h), Image.Resampling.LANCZOS)
    tmp = dest.with_suffix(dest.suffix + ".part")
    # subsampling=0 (4:4:4): keep full chroma resolution — Pillow's default 4:2:0 would
    # average 2x2 color blocks, throwing away color detail at hairline edge/corner marks.
    img.save(tmp, format="JPEG", quality=quality, subsampling=0)
    os.replace(tmp, dest)


def _fetch(reader, key: str, dest: Path, resize: tuple[int, int] | None, quality: int) -> str:
    if resize is not None:
        # No upstream size to compare against a resized derivative; existence means done.
        if dest.exists() and dest.stat().st_size > 0:
            return "skipped"
    elif dest.exists() and dest.stat().st_size == reader.size(key):
        return "skipped"
    data = reader.get(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if resize is not None:
        _resize_and_save(data, dest, resize, quality)
    else:
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, dest)
    return "downloaded"


def build_cache(reader, keys: list[str], cache_dir: Path, workers: int = 16,
                progress: Callable[[dict], None] | None = None,
                resize: tuple[int, int] | None = None, quality: int = 95) -> dict[str, int]:
    counts = {"downloaded": 0, "skipped": 0, "failed": 0}
    keys = list(dict.fromkeys(keys))
    dest_for = (lambda k: resized_path(cache_dir, k, resize)) if resize else (lambda k: cache_path(cache_dir, k))
    with ThreadPoolExecutor(max(1, workers)) as ex:
        futures = {ex.submit(_fetch, reader, k, dest_for(k), resize, quality): k for k in keys}
        for f in as_completed(futures):
            try:
                counts[f.result()] += 1
            except Exception:
                counts["failed"] += 1
            if progress:
                progress(counts)
    return counts
