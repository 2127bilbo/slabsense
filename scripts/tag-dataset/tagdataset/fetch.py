"""Fetch detail + score for each cert into the store (spec §5.2)."""
from __future__ import annotations

import asyncio
import time
from typing import Callable

import aiohttp

from .store import Store
from .tagapi import TagHttpError

BACKOFF = (1, 4, 16)
GONE_STATUSES = (403, 404)


class RateLimiter:
    """Simple global spacing: at most `per_second` calls per second across all workers."""

    def __init__(self, per_second: float):
        self.interval = 1.0 / per_second
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._next - now)
            self._next = max(now, self._next) + self.interval
        if delay:
            await asyncio.sleep(delay)


async def fetch_one(client, store: Store, cert: str, grade_key: str | None,
                    limiter: RateLimiter, sleep=asyncio.sleep) -> str:
    last = "unknown"
    for delay in (0,) + BACKOFF:
        if delay:
            await sleep(delay)
        try:
            await limiter.wait()
            detail = await client.detail(cert)
            await limiter.wait()
            score = await client.score(cert)
        except TagHttpError as e:
            if e.status in GONE_STATUSES:
                store.put_raw(cert, grade_key, None, None, e.status, e.body)
                return "gone"
            last = f"HTTP {e.status}"
            continue
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
            last = f"{type(e).__name__}: {e}"[:200]
            continue
        store.put_raw(cert, grade_key, detail, score, 200, None)
        store.clear_failure("fetch", cert, "")
        return "ok"
    store.add_failure("fetch", cert, "", last)
    return "failed"


async def run_fetch(client, store: Store, certs: list[tuple[str, str | None]], rate: float,
                    workers: int, sleep=asyncio.sleep,
                    progress: Callable[[dict], None] | None = None) -> dict[str, int]:
    limiter = RateLimiter(rate)
    queue: asyncio.Queue = asyncio.Queue()
    for cert, grade_key in certs:
        if not store.has_raw(cert):
            queue.put_nowait((cert, grade_key))
    counts = {"ok": 0, "gone": 0, "failed": 0, "skipped": len(certs) - queue.qsize()}

    async def worker() -> None:
        while True:
            try:
                cert, grade_key = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            counts[await fetch_one(client, store, cert, grade_key, limiter, sleep)] += 1
            if progress:
                progress(counts)

    await asyncio.gather(*(worker() for _ in range(max(1, workers))))
    return counts
