from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    db_path: str
    endpoint: str
    region: str
    bucket: str
    prefix: str
    key_id: str | None
    app_key: str | None
    rate: float
    workers: int
    concurrency: int


def load_config(path: str = "config.toml") -> Config:
    with open(path, "rb") as f:
        data = tomllib.load(f)
    b = data["bucket"]
    return Config(
        db_path=data["paths"]["db"],
        endpoint=b["endpoint"],
        region=b["region"],
        bucket=b["name"],
        prefix=b.get("prefix", "tag-dataset"),
        key_id=os.environ.get("B2_KEY_ID"),
        app_key=os.environ.get("B2_APP_KEY"),
        rate=float(data.get("fetch", {}).get("rate", 4.0)),
        workers=int(data.get("fetch", {}).get("workers", 8)),
        concurrency=int(data.get("download", {}).get("concurrency", 16)),
    )
