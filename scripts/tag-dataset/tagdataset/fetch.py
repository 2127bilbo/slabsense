"""Fetch detail + score for each cert into the store (spec §5.2)."""
from __future__ import annotations

import asyncio
import time
from typing import Callable

import aiohttp

from .store import Store
from .tagapi import TagHttpError, TagClient

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


async def run_fetch_proxied(
    clients: list[TagClient],
    store: Store,
    certs: list[tuple[str, str | None]],
    rate: float,
    workers_per_proxy: int = 1,
    sleep=asyncio.sleep,
    progress: Callable[[dict], None] | None = None,
    cooldown_start: float = 300.0,
    cooldown_max: float = 900.0,
    clock=time.monotonic,
) -> dict[str, int]:
    """Fetch using smart proxy rotation that skips throttled proxies.

    When a proxy hits 429, it's marked as cooling down and skipped.
    Only healthy proxies are used. If ALL proxies are throttled, we wait
    for the shortest cooldown to expire.
    """
    num_proxies = len(clients)

    # Per-proxy cooldowns - must match TAG's ~5 min rate window
    # Starting lower causes immediate re-throttle when proxy resumes
    proxy_cooldown_start = 300.0  # 5 min to match TAG's window
    proxy_cooldown_max = 600.0    # Max 10 min for repeated offenders
    proxy_cooldown_until: list[float] = [0.0] * num_proxies
    proxy_cooldown_duration: list[float] = [proxy_cooldown_start] * num_proxies
    proxy_last_request: list[float] = [0.0] * num_proxies

    # Minimum spacing per proxy
    min_spacing_per_proxy = 1.0 / rate * num_proxies if rate > 0 else 5.0

    # Build work queue
    work_queue = [(cert, grade_key) for cert, grade_key in certs if not store.has_raw(cert)]
    counts = {"ok": 0, "gone": 0, "failed": 0, "skipped": len(certs) - len(work_queue), "throttled": 0}
    throttle_attempts: dict[str, int] = {}

    work_idx = 0
    while work_idx < len(work_queue):
        cert, grade_key = work_queue[work_idx]
        now = clock()

        # Find a healthy proxy (not in cooldown)
        best_proxy = None
        best_ready_time = float('inf')
        healthy_count = 0

        for idx in range(num_proxies):
            if proxy_cooldown_until[idx] > now:
                # This proxy is in cooldown
                if proxy_cooldown_until[idx] < best_ready_time:
                    best_ready_time = proxy_cooldown_until[idx]
                continue

            healthy_count += 1
            # Check per-proxy spacing
            ready_at = proxy_last_request[idx] + min_spacing_per_proxy
            if best_proxy is None or ready_at < best_ready_time:
                best_proxy = idx
                best_ready_time = ready_at

        # If all proxies are in cooldown, wait for the shortest one
        if healthy_count == 0:
            wait_time = best_ready_time - now
            if wait_time > 0:
                print(f"\n[All {num_proxies} proxies cooling down, waiting {wait_time:.0f}s]", flush=True)
                await sleep(wait_time)
            continue  # Re-check proxy availability

        # Wait for the best proxy to be ready (per-proxy spacing)
        wait_for_spacing = best_ready_time - now
        if wait_for_spacing > 0:
            await sleep(wait_for_spacing)

        proxy_idx = best_proxy
        client = clients[proxy_idx]
        proxy_last_request[proxy_idx] = clock()

        # Make the request
        result = await _fetch_one_no_throttle(client, store, cert, grade_key, sleep)

        if result == "throttled":
            counts["throttled"] += 1
            # Mark this proxy as in cooldown
            proxy_cooldown_until[proxy_idx] = clock() + proxy_cooldown_duration[proxy_idx]
            # Double cooldown for next time (up to max)
            proxy_cooldown_duration[proxy_idx] = min(proxy_cooldown_duration[proxy_idx] * 2, proxy_cooldown_max)

            attempts = throttle_attempts.get(cert, 0) + 1
            throttle_attempts[cert] = attempts
            if attempts >= MAX_THROTTLE_ATTEMPTS:
                store.add_failure("fetch", cert, "", f"HTTP 429 x{MAX_THROTTLE_ATTEMPTS}")
                counts["failed"] += 1
                work_idx += 1
            else:
                work_queue.append((cert, grade_key))  # Re-queue for retry
                work_idx += 1
        else:
            counts[result] += 1
            # Reset cooldown duration on success
            proxy_cooldown_duration[proxy_idx] = proxy_cooldown_start
            work_idx += 1

        if progress:
            progress(counts)

    return counts


async def _fetch_one_no_throttle(client, store: Store, cert: str, grade_key: str | None,
                                  sleep=asyncio.sleep) -> str:
    """Fetch one cert without throttle management (caller handles timing)."""
    import aiohttp
    last = "unknown"
    for delay in (0,) + BACKOFF:
        if delay:
            await sleep(delay)
        try:
            detail = await client.detail(cert)
            score = await client.score(cert)
        except TagHttpError as e:
            if e.status == THROTTLE_STATUS:
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
        return "ok"
    store.add_failure("fetch", cert, "", last)
    return "failed"
