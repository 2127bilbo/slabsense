"""Sampling certs from the TAG browse cache per the composition rule (spec §5.1)."""
from __future__ import annotations

import json
import random

import pandas as pd

from .grades import (CAP_PER_GRADE, CAPPED_GRADE_KEYS, ERA_FLOOR, FULL_GRADE_KEYS,
                     SKIP_GRADE_KEYS, allocate, era_for_year, grade_num)

COLUMNS = ["cert", "grade_key", "grade_num", "is_pristine", "era", "year",
           "brand", "set", "card_name", "card_number", "variation"]


def load_cache(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        cards = json.load(f)["cards"]
    rows = []
    for card in cards.values():
        for grade_key, certs in (card.get("grades") or {}).items():
            for cert in certs:
                rows.append({
                    "cert": cert,
                    "grade_key": grade_key,
                    "year": int(card["year"]),
                    "brand": card.get("brand"),
                    "set": card.get("set"),
                    "card_name": card.get("card_name"),
                    "card_number": card.get("card_number", ""),
                    "variation": card.get("variation", ""),
                })
    return rows


def _finish(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=[c for c in COLUMNS if c not in ("grade_num", "is_pristine")])
    df["grade_num"] = df["grade_key"].map(lambda k: grade_num(k) if k else None)
    df["is_pristine"] = df["grade_key"] == "10P"
    return df[COLUMNS].reset_index(drop=True)


def build_sample(rows: list[dict], exclude: set[str], seed: int = 42,
                 cap: int = CAP_PER_GRADE, floor: int = ERA_FLOOR) -> pd.DataFrame:
    rng = random.Random(seed)
    seen: set[str] = set()
    uniq: list[dict] = []
    for r in rows:
        if r["grade_key"] in SKIP_GRADE_KEYS or r["cert"] in exclude or r["cert"] in seen:
            continue
        seen.add(r["cert"])
        uniq.append({**r, "era": era_for_year(r["year"])})

    by_grade: dict[str, list[dict]] = {}
    for r in uniq:
        by_grade.setdefault(r["grade_key"], []).append(r)

    out: list[dict] = []
    for grade_key in sorted(by_grade):
        group = by_grade[grade_key]
        if grade_key in FULL_GRADE_KEYS:
            out.extend(group)
            continue
        if grade_key not in CAPPED_GRADE_KEYS:
            continue
        by_era: dict[str, list[dict]] = {}
        for r in group:
            by_era.setdefault(r["era"], []).append(r)
        quota = allocate({era: len(v) for era, v in by_era.items()}, cap, floor)
        for era in sorted(quota):
            pool = sorted(by_era[era], key=lambda r: r["cert"])
            rng.shuffle(pool)
            out.extend(pool[: quota[era]])

    return _finish(sorted(out, key=lambda r: r["cert"]))


def sample_from_cert_list(rows: list[dict], certs: list[str]) -> pd.DataFrame:
    index = {r["cert"]: r for r in rows}
    out = []
    for cert in certs:
        r = index.get(cert)
        if r is None:
            out.append({"cert": cert, "grade_key": None, "era": None, "year": None, "brand": None,
                        "set": None, "card_name": None, "card_number": None, "variation": None})
        else:
            out.append({**r, "era": era_for_year(r["year"])})
    return _finish(out)
