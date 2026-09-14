"""Command line: sample / fetch / download / verify (spec §5)."""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

import aiohttp
import pandas as pd

from . import build as bld
from . import download as dl
from . import sample as smp
from . import stats as st
from . import verify as vf
from .bucket import Bucket
from .config import load_config
from .fetch import run_fetch, run_fetch_proxied
from .store import Store
from .tagapi import TagClient
from .proxies import load_proxies, ProxyPool


def _bucket(cfg) -> Bucket:
    return Bucket(cfg.endpoint, cfg.region, cfg.bucket, cfg.key_id, cfg.app_key, cfg.prefix)


def _progress(label: str):
    t0 = time.monotonic()
    last = [0.0]

    def show(counts: dict) -> None:
        now = time.monotonic()
        if now - last[0] < 2 and sum(counts.values()) % 100:
            return
        last[0] = now
        done = sum(v for k, v in counts.items() if k != "skipped")
        rate = done / max(now - t0, 1e-6)
        print(f"\r{label}: {counts}  {rate:.1f}/s", end="", flush=True)

    return show


def _grade_keys(certs_parquet: str) -> dict[str, str | None]:
    df = pd.read_parquet(certs_parquet)
    return {str(r.cert): (None if pd.isna(r.grade_key) else str(r.grade_key)) for r in df.itertuples()}


def cmd_sample(args, cfg) -> int:
    rows = smp.load_cache(args.cache)
    store = Store(cfg.db_path)
    if args.certs_file:
        certs = [c.strip() for c in Path(args.certs_file).read_text().splitlines() if c.strip()]
        df = smp.sample_from_cert_list(rows, certs)
    else:
        df = smp.build_sample(rows, exclude=store.certs_with_raw(), seed=args.seed)
    store.close()
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(args.out, index=False)
    print(f"wrote {len(df)} certs to {args.out}")
    print(df.groupby("grade_key", dropna=False).size().to_string())
    return 0


def cmd_fetch(args, cfg) -> int:
    store = Store(cfg.db_path)
    grade_map = _grade_keys(args.certs)
    if args.retry_failures:
        certs = [(cert, grade_map.get(cert)) for cert, _, _, _ in store.list_failures("fetch")]
        for cert, _ in certs:
            store.clear_failure("fetch", cert, "")
    else:
        certs = [(c, gk) for c, gk in grade_map.items()]

    # Use proxies if provided
    if args.proxies:
        proxies = load_proxies(args.proxies)
        if not proxies:
            print(f"No valid proxies found in {args.proxies}")
            return 1

        # Sliding window rate limiting: 10 requests per 5-min window per proxy
        # With 10 proxies: 10 proxies × 10 req/5min = 100 req/5min = 20 req/min = ~10 cards/min
        # Rate param is now just a minimum spacing hint, window limiting does the real work
        proxy_rate = args.rate or 2.0  # Fast baseline, window limiting controls actual rate
        max_per_window = 15  # Sweet spot: fast + 0 throttles
        print(f"Using {len(proxies)} proxies with sliding window limiting")
        print(f"Each IP: max {max_per_window} requests per 5min (~{max_per_window * 12} cards/hr per proxy)")

        async def go_proxied():
            async with ProxyPool(proxies) as pool:
                clients = [pool.get_client(i) for i in range(len(pool))]
                return await run_fetch_proxied(
                    clients, store, certs,
                    rate=proxy_rate,
                    workers_per_proxy=args.workers or 1,
                    progress=_progress("fetch"),
                    cooldown_start=cfg.cooldown_start,
                    cooldown_max=cfg.cooldown_max,
                )

        counts = asyncio.run(go_proxied())
    else:
        async def go():
            async with aiohttp.ClientSession() as session:
                return await run_fetch(TagClient(session), store, certs, args.rate or cfg.rate,
                                       args.workers or cfg.workers, progress=_progress("fetch"),
                                       cooldown_start=cfg.cooldown_start, cooldown_max=cfg.cooldown_max)

        counts = asyncio.run(go())

    print(f"\nfetch done: {counts}")
    print("store:", store.counts())
    store.close()
    return 0


def cmd_download(args, cfg) -> int:
    store = Store(cfg.db_path)
    bucket = _bucket(cfg)
    if args.retry_missing:
        m = pd.read_parquet(args.retry_missing)
        items = [(str(r.cert), str(r.name), str(r.url)) for r in m.itertuples()]
    else:
        only = None
        if args.certs_file:
            only = {c.strip() for c in Path(args.certs_file).read_text().splitlines() if c.strip()}
        items = dl.pending_files(store, only, include_gone=args.include_gone)
    print(f"{len(items)} files to download")

    if args.proxies:
        proxies = load_proxies(args.proxies)
        if not proxies:
            print(f"No valid proxies found in {args.proxies}")
            return 1

        # CDN is typically less strict than API, but use similar conservative rate
        safe_rate = len(proxies) * 8 * 0.8 / 60  # ~1.07 req/s for 10 proxies
        proxy_rate = args.rate or safe_rate
        print(f"Using {len(proxies)} proxies at {proxy_rate:.2f} req/s")

        async def go_proxied():
            connector = aiohttp.TCPConnector(limit_per_host=20)
            sessions = []
            proxy_urls = []
            for p in proxies:
                session = aiohttp.ClientSession(connector=connector)
                sessions.append(session)
                proxy_urls.append(p.url)
            try:
                return await dl.run_download_proxied(
                    sessions, proxy_urls, bucket, store, items,
                    rate=proxy_rate,
                    progress=_progress("download"),
                    cooldown_start=cfg.cooldown_start,
                    cooldown_max=cfg.cooldown_max,
                )
            finally:
                for s in sessions:
                    await s.close()

        counts = asyncio.run(go_proxied())
    else:
        async def go():
            async with aiohttp.ClientSession() as session:
                return await dl.run_download(session, bucket, store, items, args.concurrency or cfg.concurrency,
                                             args.rate or cfg.download_rate,
                                             progress=_progress("download"),
                                             cooldown_start=cfg.cooldown_start, cooldown_max=cfg.cooldown_max)

        counts = asyncio.run(go())

    print(f"\ndownload done: {counts}")
    print("store:", store.counts())
    store.close()
    return 0


def cmd_verify(args, cfg) -> int:
    store = Store(cfg.db_path)
    bucket = _bucket(cfg) if args.check_bucket else None
    missing = vf.verify(store, bucket)
    table = vf.completeness_by_grade(store, missing)
    print(table.to_string(index=False))
    retryable = missing[missing.reason != vf.UNAVAILABLE_REASON]
    unavailable = missing[missing.reason == vf.UNAVAILABLE_REASON]
    n_certs = unavailable.cert.nunique() if len(unavailable) else 0
    print(f"unavailable upstream: {len(unavailable)} files across {n_certs} certs")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    retryable.to_parquet(args.out, index=False)
    print(f"{len(retryable)} missing files written to {args.out}")
    store.close()
    return 1 if len(retryable) else 0


def cmd_build(args, cfg) -> int:
    store = Store(cfg.db_path)
    counts = bld.build(store, args.out, seed=args.seed, splits_path=args.splits)
    store.close()
    print(f"build done: {counts}")
    print(f"outputs in {args.out}: {', '.join(bld.OUTPUTS)} (splits: {args.splits})")
    return 0


def cmd_stats(args, cfg) -> int:
    text = st.report(args.out)
    store = Store(cfg.db_path)
    n = st.ding_crops_without_upload(args.out, store)
    store.close()
    text = text.replace(
        "ding crops not in files table: (run `python -m tagdataset stats` for the store-joined count)",
        f"ding crops not in files table: {n}",
    )
    print(text)
    if args.save:
        Path(args.save).parent.mkdir(parents=True, exist_ok=True)
        Path(args.save).write_text(text, encoding="utf-8")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="tagdataset")
    p.add_argument("--config", default="config.toml")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("sample", help="pick certs from the browse cache")
    s.add_argument("--cache", required=True, help="path to tag_cache.json")
    s.add_argument("--out", default="data/certs.parquet")
    s.add_argument("--seed", type=int, default=42)
    s.add_argument("--certs-file", help="text file of certs, one per line (overrides the composition rule)")
    s.set_defaults(func=cmd_sample)

    f = sub.add_parser("fetch", help="fetch detail+score for sampled certs")
    f.add_argument("--certs", default="data/certs.parquet",
                    help="certs.parquet; also used to look up grade keys when retrying failures")
    f.add_argument("--rate", type=float)
    f.add_argument("--workers", type=int, help="workers per proxy when using --proxies, or total workers otherwise")
    f.add_argument("--retry-failures", action="store_true")
    f.add_argument("--proxies", help="path to proxy list file (host:port:user:pass per line)")
    f.set_defaults(func=cmd_fetch)

    d = sub.add_parser("download", help="upload every expected image to the bucket")
    d.add_argument("--concurrency", type=int)
    d.add_argument("--rate", type=float, help="requests/second across all workers")
    d.add_argument("--certs-file", help="limit to these certs")
    d.add_argument("--retry-missing", help="missing.parquet from verify")
    d.add_argument("--include-gone", action="store_true",
                   help="also retry files previously marked unavailable upstream (HTTP 403/404)")
    d.add_argument("--proxies", help="path to proxy list file (host:port:user:pass per line)")
    d.set_defaults(func=cmd_download)

    v = sub.add_parser("verify", help="report files that should exist but do not")
    v.add_argument("--out", default="data/missing.parquet")
    v.add_argument("--check-bucket", action="store_true", help="also list the bucket and compare")
    v.set_defaults(func=cmd_verify)

    b = sub.add_parser("build", help="write training parquet tables from the store")
    b.add_argument("--out", default="data/dataset")
    b.add_argument("--seed", type=int, default=42)
    b.add_argument("--splits", default=str(bld.DEFAULT_SPLITS_PATH),
                   help="authoritative split file; existing assignments are never changed")
    b.set_defaults(func=cmd_build)

    st_p = sub.add_parser("stats", help="print dataset health report")
    st_p.add_argument("--out", default="data/dataset")
    st_p.add_argument("--save", help="also write the report text to this path")
    st_p.set_defaults(func=cmd_stats)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    return args.func(args, cfg)


if __name__ == "__main__":
    sys.exit(main())
