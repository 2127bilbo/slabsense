"""
Export TAG ground truth for the 507 locally-stored reference photos.

Run from the repo root with the tag-dataset venv:
  scripts/tag-dataset/.venv/Scripts/python scripts/harness/export_ground_truth.py

Reads the parquet tables built by `python -m tagdataset build` and writes
scripts/harness/ground-truth.json (committed). Re-run when the dataset changes.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "scripts" / "tag-dataset" / "data" / "dataset"
PHOTOS = ROOT / "scripts" / "Tag scraper" / "dig info" / "weights by tag" / "TAG Map"
OUT = ROOT / "scripts" / "harness" / "ground-truth.json"

SIDE = {"F": "FRONT", "B": "BACK"}


def num(v):
    """pandas value -> float or None (NaN/None -> None)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def ratio(a, b):
    a, b = num(a), num(b)
    if a is None or b is None or (a + b) <= 0:
        return None
    return round(a / (a + b) * 100, 2)


def local_images():
    """cert -> {'front': basename, 'back': basename} for certs with both photos."""
    front = {re.match(r"([A-Z0-9]+)_", p.name).group(1): p.name for p in (PHOTOS / "Front").glob("*.jpg")}
    back = {re.match(r"([A-Z0-9]+)_", p.name).group(1): p.name for p in (PHOTOS / "Back").glob("*.jpg")}
    return {c: {"front": front[c], "back": back[c]} for c in front if c in back}


def main():
    images = local_images()
    manifest = pd.read_parquet(DATASET / "manifest.parquet")
    dings = pd.read_parquet(DATASET / "dings.parquet")
    corners = pd.read_parquet(DATASET / "corners.parquet")
    edges = pd.read_parquet(DATASET / "edges.parquet")

    manifest = manifest[manifest.cert.isin(images)]
    missing = sorted(set(images) - set(manifest.cert))
    if missing:
        print(f"WARNING: {len(missing)} local certs not in manifest: {missing[:10]}")

    dings = dings[dings.cert.isin(images) & ~dings.engine_type.isin(["SKIP", "CENTERING"])]
    corners = corners[corners.cert.isin(images)]
    edges = edges[edges.cert.isin(images)]

    out = {}
    for row in manifest.itertuples(index=False):
        cert = row.cert
        d = dings[dings.cert == cert].sort_values(["side", "ordering"])
        c = corners[corners.cert == cert]
        e = edges[edges.cert == cert]
        out[cert] = {
            "grade": num(row.grade_num),
            "label": row.grade_label,
            "pristine": bool(row.is_pristine),
            "tag": {
                "centering": num(row.rollup_centering),
                "corners": num(row.rollup_corners),
                "edges": num(row.rollup_edges),
                "surface": num(row.rollup_surface),
                "surfaceFront": num(row.surface_front),
                "surfaceBack": num(row.surface_back),
            },
            "centering": {
                "front": {"lrRatio": ratio(row.dte_front_left, row.dte_front_right),
                          "tbRatio": ratio(row.dte_front_top, row.dte_front_bottom)},
                "back": {"lrRatio": ratio(row.dte_back_left, row.dte_back_right),
                         "tbRatio": ratio(row.dte_back_top, row.dte_back_bottom)},
            },
            "dings": [
                {"side": SIDE.get(r.side, r.side), "type": r.type_name, "engineType": r.engine_type,
                 "location": None if pd.isna(r.location) else r.location,
                 "x": num(r.x), "y": num(r.y)}
                for r in d.itertuples(index=False)
            ],
            "corners": {
                s: {r.corner: {"angle": num(r.score_angle), "fill": num(r.score_fill), "fray": num(r.score_fray)}
                    for r in c[c.side == s].itertuples(index=False)}
                for s in ("F", "B")
            },
            "edges": {
                s: {r.edge: {"fill": num(r.score_fill), "fray": num(r.score_fray)}
                    for r in e[e.side == s].itertuples(index=False)}
                for s in ("F", "B")
            },
            "images": images[cert],
        }

    payload = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "scripts/tag-dataset/data/dataset/*.parquet",
        "count": len(out),
        "certs": dict(sorted(out.items())),
    }
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    n_dings = sum(len(v["dings"]) for v in out.values())
    n_cent = sum(1 for v in out.values() if v["centering"]["front"]["lrRatio"] is not None)
    print(f"wrote {OUT} — {len(out)} certs, {n_dings} dings, {n_cent} with front centering")


if __name__ == "__main__":
    main()
