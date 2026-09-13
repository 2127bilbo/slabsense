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
THROTTLE_STATUS = 429
MAX_THROTTLE_ATTEMPTS = 20


class Throttle:
    """Global spacing at `per_second`, plus a shared cooldown tripped by HTTP 429s.

    `wait()` is called by every worker before each request: it enforces the usual
    spacing and, while a cooldown from a prior 429 is active, blocks every worker
    until the cooldown ends before resuming spacing. `trip()`/`succeed()` are
    called by a worker on a 429/200 to manage the cooldown.
    """

    def __init__(self, per_second: float, cooldown_start: float = 300.0, cooldown_max: float = 900.0,
                 sleep=asyncio.sleep, clock=time.monotonic):
        self.interval = 1.0 / per_second
        self._next = 0.0
        self._lock = asyncio.Lock()
        self.cooldown_start = cooldown_start
        self.cooldown_max = cooldown_max
        self.current_cooldown = cooldown_start
        self.cooldown_until: float | None = None
        self.trips = 0
        self._sleep = sleep
        self._clock = clock

    async def wait(self) -> None:
        async with self._lock:
            now = self._clock()
            cooldown_delay = 0.0
            if self.cooldown_until is not None and self.cooldown_until > now:
                cooldown_delay = self.cooldown_until - now
        if cooldown_delay:
            await self._sleep(cooldown_delay)
        async with self._lock:
            now = self._clock()
            delay = max(0.0, self._next - now)
            self._next = max(now, self._next) + self.interval
        if delay:
            await self._sleep(delay)

    def trip(self) -> None:
        now = self._clock()
        if self.cooldown_until is not None and self.cooldown_until > now:
            return
        self.cooldown_until = now + self.current_cooldown
        self.current_cooldown = min(self.current_cooldown * 2, self.cooldown_max)
        self.trips += 1

    def succeed(self) -> None:
        self.current_cooldown = self.cooldown_start


async def fetch_one(client, store: Store, cert: str, grade_key: str | None,
                    throttle: Throttle, sleep=asyncio.sleep) -> str:
    last = "unknown"
    for delay in (0,) + BACKOFF:
        if delay:
            await sleep(delay)
        try:
            await throttle.wait()
            detail = await client.detail(cert)
            await throttle.wait()
            score = await client.score(cert)
        except TagHttpError as e:
            if e.status == THROTTLE_STATUS:
                throttle.trip()
                return "throttled"
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
        throttle.succeed()
        return "ok"
    store.add_failure("fetch", cert, "", last)
    return "failed"


async def run_fetch(client, store: Store, certs: list[tuple[str, str | None]], rate: float,
                    workers: int, sleep=asyncio.sleep,
                    progress: Callable[[dict], None] | None = None,
                    cooldown_start: float = 300.0, cooldown_max: float = 900.0,
                    clock=time.monotonic) -> dict[str, int]:
    throttle = Throttle(rate, cooldown_start=cooldown_start, cooldown_max=cooldown_max,
                        sleep=sleep, clock=clock)
    queue: asyncio.Queue = asyncio.Queue()
    throttle_attempts: dict[str, int] = {}
    for cert, grade_key in certs:
        if not store.has_raw(cert):
            queue.put_nowait((cert, grade_key))
    counts = {"ok": 0, "gone": 0, "failed": 0, "skipped": len(certs) - queue.qsize(), "throttled": 0}

    async def worker() -> None:
        while True:
            try:
                cert, grade_key = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            result = await fetch_one(client, store, cert, grade_key, throttle, sleep)
            if result == "throttled":
                counts["throttled"] += 1
                attempts = throttle_attempts.get(cert, 0) + 1
                throttle_attempts[cert] = attempts
                if attempts >= MAX_THROTTLE_ATTEMPTS:
                    store.add_failure("fetch", cert, "", f"HTTP 429 x{MAX_THROTTLE_ATTEMPTS}")
                    counts["failed"] += 1
                else:
                    queue.put_nowait((cert, grade_key))
            else:
                counts[result] += 1
            if progress:
                progress(counts)

    await asyncio.gather(*(worker() for _ in range(max(1, workers))))
    return counts
