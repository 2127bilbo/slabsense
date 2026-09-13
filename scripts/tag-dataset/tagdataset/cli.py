"""Command line: sample / fetch / download / verify (spec §5)."""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

import aiohttp
import pandas as pd

from . import download as dl
from . import sample as smp
from . import verify as vf
from .bucket import Bucket
from .config import load_config
from .fetch import run_fetch
from .store import Store
from .tagapi import TagClient


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

    async def go():
        async with aiohttp.ClientSession() as session:
            return await run_fetch(TagClient(session), store, certs, args.rate or cfg.rate,
                                   args.workers or cfg.workers, progress=_progress("fetch"))

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

    async def go():
        async with aiohttp.ClientSession() as session:
            return await dl.run_download(session, bucket, store, items, args.concurrency or cfg.concurrency,
                                         progress=_progress("download"))

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
    f.add_argument("--workers", type=int)
    f.add_argument("--retry-failures", action="store_true")
    f.set_defaults(func=cmd_fetch)

    d = sub.add_parser("download", help="upload every expected image to the bucket")
    d.add_argument("--concurrency", type=int)
    d.add_argument("--certs-file", help="limit to these certs")
    d.add_argument("--retry-missing", help="missing.parquet from verify")
    d.add_argument("--include-gone", action="store_true",
                   help="also retry files previously marked unavailable upstream (HTTP 403/404)")
    d.set_defaults(func=cmd_download)

    v = sub.add_parser("verify", help="report files that should exist but do not")
    v.add_argument("--out", default="data/missing.parquet")
    v.add_argument("--check-bucket", action="store_true", help="also list the bucket and compare")
    v.set_defaults(func=cmd_verify)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    return args.func(args, cfg)


if __name__ == "__main__":
    sys.exit(main())
