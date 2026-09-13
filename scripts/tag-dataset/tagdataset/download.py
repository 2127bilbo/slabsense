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


async def _fetch_bytes(session, url: str) -> bytes:
    async with session.get(url, timeout=DOWNLOAD_TIMEOUT) as r:
        body = await r.read()
        if r.status != 200:
            raise HttpStatusError(r.status, body)
        return body


async def download_one(session, bucket, store: Store, cert: str, name: str, url: str,
                       throttle: Throttle, sleep=asyncio.sleep) -> str:
    content_type = CONTENT_TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    last = "unknown"
    for delay in (0,) + BACKOFF:
        if delay:
            await sleep(delay)
        try:
            await throttle.wait()
            data = await _fetch_bytes(session, url)
            await asyncio.to_thread(bucket.put, cert, name, data, content_type)
        except HttpStatusError as e:
            if e.status in GONE_STATUSES:
                if e.status == 403 and classify_403(e.body) == "throttled":
                    throttle.last_status = e.status
                    throttle.trip()
                    return "throttled"
                store.add_failure("download", cert, name, f"HTTP {e.status}")
                return "gone"
            if e.status in THROTTLE_STATUSES:
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
