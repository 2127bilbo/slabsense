"""Resumable local cache of bucket objects, laid out as cache_dir/<key>.

When `resize` is set, `build_cache` instead writes a resized JPEG under
cache_dir/resized/<w>x<h>/<key-with-.jpg-extension>, rotating so the long side is
horizontal first by default (same rule as `data.load_crop`; pass `rotate=False` for
tasks whose crops must keep their original orientation, e.g. whole-card surface
images). The full-resolution copy is not written in that mode. Pass `local_full=True`
to resize from the full-resolution file already on disk at cache_dir/<key> instead of
downloading it again; the reader is only used as a fallback when that file is missing.
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


def resized_path(cache_dir: Path, key: str, size: tuple[int, int], variant: str | None = None) -> Path:
    w, h = size
    folder = f"{w}x{h}" + (f"-{variant}" if variant else "")
    return Path(cache_dir) / "resized" / folder / Path(key).with_suffix(".jpg")


def _resize_and_save(data: bytes, dest: Path, size: tuple[int, int], quality: int, rotate: bool = True,
                     crop_box: tuple[int, int, int, int] | None = None) -> None:
    w, h = size
    with Image.open(BytesIO(data)) as im:
        img = im.convert("RGB")
    if crop_box is not None:
        img = img.crop(tuple(int(v) for v in crop_box))
    if rotate and img.height > img.width:
        img = img.transpose(Image.Transpose.ROTATE_90)
    img = img.resize((w, h), Image.Resampling.LANCZOS)
    tmp = dest.with_suffix(dest.suffix + ".part")
    # subsampling=0 (4:4:4): keep full chroma resolution — Pillow's default 4:2:0 would
    # average 2x2 color blocks, throwing away color detail at hairline edge/corner marks.
    img.save(tmp, format="JPEG", quality=quality, subsampling=0)
    os.replace(tmp, dest)


def _fetch(reader, key: str, dest: Path, resize: tuple[int, int] | None, quality: int,
          rotate: bool = True, local_full: Path | None = None,
          crop_box: tuple[int, int, int, int] | None = None) -> str:
    if resize is not None:
        # No upstream size to compare against a resized derivative; existence means done.
        if dest.exists() and dest.stat().st_size > 0:
            return "skipped"
    elif dest.exists() and dest.stat().st_size == reader.size(key):
        return "skipped"
    if local_full is not None and local_full.exists() and local_full.stat().st_size > 0:
        data = local_full.read_bytes()
    else:
        data = reader.get(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if resize is not None:
        _resize_and_save(data, dest, resize, quality, rotate, crop_box)
    else:
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, dest)
    return "downloaded"


def build_cache(reader, keys: list[str], cache_dir: Path, workers: int = 16,
                progress: Callable[[dict], None] | None = None,
                resize: tuple[int, int] | None = None, quality: int = 95,
                rotate: bool = True, local_full: bool = False, variant: str | None = None,
                crops: dict[str, tuple[int, int, int, int]] | None = None) -> dict[str, int]:
    counts = {"downloaded": 0, "skipped": 0, "failed": 0}
    keys = list(dict.fromkeys(keys))
    crops = crops or {}
    dest_for = (lambda k: resized_path(cache_dir, k, resize, variant)) if resize else (lambda k: cache_path(cache_dir, k))
    with ThreadPoolExecutor(max(1, workers)) as ex:
        futures = {ex.submit(_fetch, reader, k, dest_for(k), resize, quality, rotate,
                             cache_path(cache_dir, k) if (local_full and resize) else None,
                             crops.get(k)): k for k in keys}
        for f in as_completed(futures):
            try:
                counts[f.result()] += 1
            except Exception:
                counts["failed"] += 1
            if progress:
                progress(counts)
    return counts
