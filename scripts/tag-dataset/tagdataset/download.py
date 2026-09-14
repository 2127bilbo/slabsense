"""Stream each expected file from TAG's CDN into the bucket (spec §5.3)."""
from __future__ import annotations

import asyncio
import hashlib
import os
import time
from typing import Callable

import aiohttp

from .fetch import BACKOFF, MAX_THROTTLE_ATTEMPTS, Throttle
from .files import CONTENT_TYPES, expected_files
from .store import Store

DOWNLOAD_TIMEOUT = aiohttp.ClientTimeout(total=120)

# Statuses meaning the CDN does not have the object (S3 AccessDenied reads as 403 for a
# missing key on TAG's bucket). Retrying these forever is pointless; record and move on.
# A 403 can also mean a CloudFront rate-limit block page — see classify_403.
GONE_STATUSES = (403, 404)
THROTTLE_STATUSES = (429,)


class HttpStatusError(Exception):
    def __init__(self, status: int, body: bytes = b""):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body[:512]


def classify_403(body: bytes) -> str:
    """Tell a real "object does not exist" 403 apart from a CDN rate-limit block.

    TAG's bucket answers a missing key with an XML AccessDenied/NoSuchKey body. A
    CloudFront rate-limit block answers 403 with an HTML page or an empty body.
    """
    if b"<Code>AccessDenied</Code>" in body or b"<Code>NoSuchKey</Code>" in body:
        return "gone"
    return "throttled"


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


async def _fetch_bytes(session, url: str, proxy_url: str | None = None) -> bytes:
    async with session.get(url, timeout=DOWNLOAD_TIMEOUT, proxy=proxy_url) as r:
        body = await r.read()
        if r.status != 200:
            raise HttpStatusError(r.status, body)
        return body


async def download_one(session, bucket, store: Store, cert: str, name: str, url: str,
                       throttle: Throttle, sleep=asyncio.sleep, proxy_url: str | None = None) -> str:
    content_type = CONTENT_TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    last = "unknown"
    for delay in (0,) + BACKOFF:
        if delay:
            await sleep(delay)
        try:
            await throttle.wait()
            data = await _fetch_bytes(session, url, proxy_url=proxy_url)
            await asyncio.to_thread(bucket.put, cert, name, data, content_type)
        except HttpStatusError as e:
            if e.status in GONE_STATUSES:
                if e.status == 403 and classify_403(e.body) == "throttled":
                    # Undocumented-by-type contract: run_download reads this right back off
                    # `throttle` via getattr() to build the park reason. Safe only because
                    # nothing here awaits between this assignment and download_one returning,
                    # and run_download reads it immediately after `await download_one(...)`
                    # with no await in between — no other worker's assignment can land in
                    # that window. Do not insert an await between this line and that read.
                    throttle.last_status = e.status
                    throttle.trip()
                    return "throttled"
                store.add_failure("download", cert, name, f"HTTP {e.status}")
                return "gone"
            if e.status in THROTTLE_STATUSES:
                # Same last_status contract as above — see the comment in the 403 branch.
                throttle.last_status = e.status
                throttle.trip()
                return "throttled"
            last = f"HTTP {e.status}"
            continue
        except Exception as e:  # network, bucket, timeout — all retried the same way
            last = f"{type(e).__name__}: {e}"[:200]
            continue
        store.put_file(cert, name, url, len(data), hashlib.sha256(data).hexdigest())
        store.clear_failure("download", cert, name)
        throttle.succeed()
        return "ok"
    store.add_failure("download", cert, name, last)
    return "failed"


async def run_download(session, bucket, store: Store, items: list[tuple[str, str, str]], concurrency: int,
                       rate: float, sleep=asyncio.sleep, progress: Callable[[dict], None] | None = None,
                       cooldown_start: float = 300.0, cooldown_max: float = 900.0,
                       clock=time.monotonic) -> dict[str, int]:
    throttle = Throttle(rate, cooldown_start=cooldown_start, cooldown_max=cooldown_max,
                        sleep=sleep, clock=clock)
    queue: asyncio.Queue = asyncio.Queue()
    for item in items:
        queue.put_nowait(item)
    counts = {"ok": 0, "gone": 0, "failed": 0, "throttled": 0}
    throttle_attempts: dict[tuple[str, str], int] = {}

    async def worker() -> None:
        while True:
            try:
                cert, name, url = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            result = await download_one(session, bucket, store, cert, name, url, throttle, sleep)
            if result == "throttled":
                counts["throttled"] += 1
                key = (cert, name)
                attempts = throttle_attempts.get(key, 0) + 1
                throttle_attempts[key] = attempts
                if attempts >= MAX_THROTTLE_ATTEMPTS:
                    # last_status must be read here, before any await follows the
                    # download_one call above (there is none between that `await` returning
                    # and this line) — no await may be inserted between them, or a
                    # concurrently-scheduled worker's throttle event could overwrite this
                    # item's status first. See the comment where last_status is set.
                    status = getattr(throttle, "last_status", 429)
                    store.add_failure("download", cert, name, f"HTTP {status} x{MAX_THROTTLE_ATTEMPTS}")
                    counts["failed"] += 1
                else:
                    queue.put_nowait((cert, name, url))
            else:
                counts[result] += 1
            if progress:
                progress(counts)

    await asyncio.gather(*(worker() for _ in range(max(1, concurrency))))
    return counts


async def run_download_proxied(
    sessions: list[aiohttp.ClientSession],
    proxy_urls: list[str],
    bucket,
    store: Store,
    items: list[tuple[str, str, str]],
    rate: float,
    sleep=asyncio.sleep,
    progress: Callable[[dict], None] | None = None,
    cooldown_start: float = 300.0,
    cooldown_max: float = 600.0,
    clock=time.monotonic,
) -> dict[str, int]:
    """Download using smart proxy rotation that skips throttled proxies.

    Similar to run_fetch_proxied - when a proxy hits 429/403-throttle, it's
    marked as cooling down and skipped. Only healthy proxies are used.
    """
    num_proxies = len(sessions)

    proxy_cooldown_until: list[float] = [0.0] * num_proxies
    proxy_cooldown_duration: list[float] = [cooldown_start] * num_proxies
    proxy_last_request: list[float] = [0.0] * num_proxies

    min_spacing_per_proxy = 1.0 / rate * num_proxies if rate > 0 else 5.0

    work_queue = list(items)
    counts = {"ok": 0, "gone": 0, "failed": 0, "throttled": 0}
    throttle_attempts: dict[tuple[str, str], int] = {}

    dummy_throttle = Throttle(rate, cooldown_start=cooldown_start, cooldown_max=cooldown_max,
                               sleep=sleep, clock=clock)

    work_idx = 0
    while work_idx < len(work_queue):
        cert, name, url = work_queue[work_idx]
        now = clock()

        best_proxy = None
        best_ready_time = float('inf')
        healthy_count = 0

        for idx in range(num_proxies):
            if proxy_cooldown_until[idx] > now:
                if proxy_cooldown_until[idx] < best_ready_time:
                    best_ready_time = proxy_cooldown_until[idx]
                continue

            healthy_count += 1
            ready_at = proxy_last_request[idx] + min_spacing_per_proxy
            if best_proxy is None or ready_at < best_ready_time:
                best_proxy = idx
                best_ready_time = ready_at

        if healthy_count == 0:
            wait_time = best_ready_time - now
            if wait_time > 0:
                print(f"\n[All {num_proxies} proxies cooling down, waiting {wait_time:.0f}s]", flush=True)
                await sleep(wait_time)
            continue

        wait_for_spacing = best_ready_time - now
        if wait_for_spacing > 0:
            await sleep(wait_for_spacing)

        proxy_idx = best_proxy
        session = sessions[proxy_idx]
        proxy_url = proxy_urls[proxy_idx]
        proxy_last_request[proxy_idx] = clock()

        result = await download_one(session, bucket, store, cert, name, url,
                                    dummy_throttle, sleep, proxy_url=proxy_url)

        if result == "throttled":
            counts["throttled"] += 1
            proxy_cooldown_until[proxy_idx] = clock() + proxy_cooldown_duration[proxy_idx]
            proxy_cooldown_duration[proxy_idx] = min(proxy_cooldown_duration[proxy_idx] * 2, cooldown_max)

            key = (cert, name)
            attempts = throttle_attempts.get(key, 0) + 1
            throttle_attempts[key] = attempts
            if attempts >= MAX_THROTTLE_ATTEMPTS:
                status = getattr(dummy_throttle, "last_status", 429)
                store.add_failure("download", cert, name, f"HTTP {status} x{MAX_THROTTLE_ATTEMPTS}")
                counts["failed"] += 1
                work_idx += 1
            else:
                work_queue.append((cert, name, url))
                work_idx += 1
        else:
            counts[result] += 1
            proxy_cooldown_duration[proxy_idx] = cooldown_start
            work_idx += 1

        if progress:
            progress(counts)

    return counts
