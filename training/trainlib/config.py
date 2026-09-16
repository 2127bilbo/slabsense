from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    dataset_dir: Path
    splits_path: Path
    cache_dir: Path
    runs_dir: Path
    weights_dir: Path
    r2_endpoint: str
    r2_region: str
    r2_bucket: str
    r2_key_id: str | None
    r2_app_key: str | None


def load_config(path: str | Path = "config.toml") -> Config:
    path = Path(path)
    base = path.parent
    with open(path, "rb") as f:
        data = tomllib.load(f)
    p = data["paths"]
    with open(base / data["r2"]["config_toml"], "rb") as f:
        bucket = tomllib.load(f)["bucket"]
    return Config(
        dataset_dir=(base / p["dataset_dir"]).resolve(),
        splits_path=(base / p["splits_path"]).resolve(),
        cache_dir=(base / p["cache_dir"]).resolve(),
        runs_dir=(base / p.get("runs_dir", "runs")).resolve(),
        weights_dir=(base / p.get("weights_dir", "weights")).resolve(),
        r2_endpoint=bucket["endpoint"],
        r2_region=bucket["region"],
        r2_bucket=bucket["name"],
        r2_key_id=os.environ.get("B2_KEY_ID"),
        r2_app_key=os.environ.get("B2_APP_KEY"),
    )
