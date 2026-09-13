"""Stream each expected file from TAG's CDN into the bucket (spec §5.3)."""
from __future__ import annotations

import asyncio
import hashlib
import os
from typing import Callable

import aiohttp

from .fetch import BACKOFF
from .files import CONTENT_TYPES, expected_files
from .store import Store

DOWNLOAD_TIMEOUT = aiohttp.ClientTimeout(total=120)

# Statuses meaning the CDN does not have the object (S3 AccessDenied reads as 403 for a
# missing key on TAG's bucket). Retrying these forever is pointless; record and move on.
GONE_STATUSES = (403, 404)


class HttpStatusError(Exception):
    def __init__(self, status: int):
        super().__init__(f"HTTP {status}")
        self.status = status


def pending_files(store: Store, only_certs: set[str] | None = None,
                  include_gone: bool = False) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    for cert, detail, score in store.iter_raw_ok():
        if only_certs is not None and cert not in only_certs:
            continue
        have = store.files_for(cert)
        gone = set() if include_gone else store.gone_files(cert)
        for name, url in expected_files(detail, score):
            if name not in have and name not in gone:
                out.append((cert, name, url))
    return out


async def _fetch_bytes(session, url: str) -> bytes:
    async with session.get(url, timeout=DOWNLOAD_TIMEOUT) as r:
        if r.status != 200:
            raise HttpStatusError(r.status)
        return await r.read()


async def download_one(session, bucket, store: Store, cert: str, name: str, url: str,
                       sem: asyncio.Semaphore, sleep=asyncio.sleep) -> str:
    content_type = CONTENT_TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    last = "unknown"
    for delay in (0,) + BACKOFF:
        if delay:
            await sleep(delay)
        try:
            async with sem:
                data = await _fetch_bytes(session, url)
            await asyncio.to_thread(bucket.put, cert, name, data, content_type)
        except HttpStatusError as e:
            if e.status in GONE_STATUSES:
                store.add_failure("download", cert, name, f"HTTP {e.status}")
                return "gone"
            last = f"HTTP {e.status}"
            continue
        except Exception as e:  # network, bucket, timeout — all retried the same way
            last = f"{type(e).__name__}: {e}"[:200]
            continue
        store.put_file(cert, name, url, len(data), hashlib.sha256(data).hexdigest())
        store.clear_failure("download", cert, name)
        return "ok"
    store.add_failure("download", cert, name, last)
    return "failed"


async def run_download(session, bucket, store: Store, items: list[tuple[str, str, str]], concurrency: int,
                       sleep=asyncio.sleep, progress: Callable[[dict], None] | None = None) -> dict[str, int]:
    sem = asyncio.Semaphore(max(1, concurrency))
    queue: asyncio.Queue = asyncio.Queue()
    for item in items:
        queue.put_nowait(item)
    counts = {"ok": 0, "gone": 0, "failed": 0}

    async def worker() -> None:
        while True:
            try:
                cert, name, url = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            counts[await download_one(session, bucket, store, cert, name, url, sem, sleep)] += 1
            if progress:
                progress(counts)

    await asyncio.gather(*(worker() for _ in range(max(1, concurrency))))
    return counts
