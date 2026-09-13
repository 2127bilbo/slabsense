"""Per-card train/val/test assignment, stratified and frozen (spec §6.1, §11)."""
from __future__ import annotations

import datetime as _dt
import hashlib

import pandas as pd

SPLITS = ("train", "val", "test")
COLUMNS = ["cert", "split", "stratum", "assigned_at"]


def _stratum(row) -> str:
    g = row["grade_label"] if isinstance(row["grade_label"], str) else "?"
    e = row["era"] if isinstance(row["era"], str) else "?"
    return f"{g}|{e}"


def _rank_key(cert: str, seed: int) -> str:
    return hashlib.sha256(f"{seed}:{cert}".encode()).hexdigest()


def assign_splits(manifest: pd.DataFrame, existing: pd.DataFrame | None, seed: int = 42,
                  fracs: tuple[float, float, float] = (0.8, 0.1, 0.1)) -> pd.DataFrame:
    """Assign new certs; keep every existing assignment untouched.

    Within each stratum, unassigned certs are ordered by a seeded hash and dealt so that the
    stratum's overall train/val/test proportions (existing + new) approach `fracs`. Every
    stratum with ≥ 3 new certs and no existing rows gets at least one of each split.
    """
    now = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    prev = existing[COLUMNS].copy() if existing is not None and len(existing) else pd.DataFrame(columns=COLUMNS)
    done = set(prev.cert)
    m = manifest[["cert", "grade_label", "era"]].drop_duplicates("cert")
    m = m[~m.cert.isin(done)].copy()
    m["stratum"] = m.apply(_stratum, axis=1)

    new_rows = []
    prev_strata = prev.groupby("stratum").split.value_counts() if len(prev) else None
    for stratum, grp in m.groupby("stratum"):
        certs = sorted(grp.cert, key=lambda c: _rank_key(c, seed))
        counts = {s: 0 for s in SPLITS}
        if prev_strata is not None and stratum in prev_strata.index.get_level_values(0):
            for s in SPLITS:
                counts[s] = int(prev_strata.get((stratum, s), 0))
        total_existing = sum(counts.values())
        if total_existing == 0 and len(certs) >= 3:
            order = ["test", "val", "train"]
            for s, c in zip(order, certs[:3]):
                counts[s] += 1; new_rows.append((c, s, stratum, now))
            certs = certs[3:]
        for c in certs:
            total = sum(counts.values()) + 1
            # pick the split furthest below its target share
            deficits = {s: fracs[i] * total - counts[s] for i, s in enumerate(SPLITS)}
            s = max(SPLITS, key=lambda k: deficits[k])
            counts[s] += 1
            new_rows.append((c, s, stratum, now))

    new = pd.DataFrame(new_rows, columns=COLUMNS)
    out = pd.concat([prev, new], ignore_index=True)
    return out.sort_values("cert").reset_index(drop=True)[COLUMNS]
