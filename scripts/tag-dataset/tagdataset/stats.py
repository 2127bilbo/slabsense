"""Read the built parquet tables and print a health report (spec §6.2)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

SECTIONS = (
    "== cards by grade and split ==", "== crops by split ==", "== markers by engine_type ==",
    "== markers by type_name ==", "== unmapped ==", "== nulls ==", "== score_total coverage ==",
    "== canvas aspect check ==", "== file completeness by grade ==", "== ding crops without upload ==",
    "== duplicates ==",
)
LABEL_NULL_COLUMNS = {
    "manifest": ["grade_label", "grade_num", "era", "rollup_centering", "rollup_corners", "rollup_edges",
                 "rollup_surface", "dte_front_left", "dte_back_left", "image_w", "score_total"],
    "corners": ["score_angle", "score_fill", "score_fray"],
    "edges": ["score_fill", "score_fray"],
    "surface": ["x", "y", "w", "h", "deduction"],
    "dings": ["w", "h"],
}


def _load(out: Path) -> dict[str, pd.DataFrame]:
    return {n: pd.read_parquet(out / f"{n}.parquet") for n in ("manifest", "corners", "edges", "surface", "dings", "splits")}


def report(out_dir: str) -> str:
    t = _load(Path(out_dir))
    m, sp = t["manifest"], t["splits"]
    lines: list[str] = [f"cards: {len(m)}"]
    ms = m.merge(sp[["cert", "split"]], on="cert", how="left")

    lines.append(SECTIONS[0])
    if len(ms):
        lines.append(pd.crosstab(ms.grade_label.fillna("?"), ms.split.fillna("?"), margins=True).to_string())

    lines.append(SECTIONS[1])
    for name in ("corners", "edges", "surface", "dings"):
        j = t[name].merge(sp[["cert", "split"]], on="cert", how="left")
        lines.append(f"{name}: " + (j.split.fillna("?").value_counts().to_dict().__repr__() if len(j) else "{}"))

    lines.append(SECTIONS[2])
    s = t["surface"]
    if len(s):
        lines.append(pd.crosstab(s.engine_type, s.is_rollup, margins=True).to_string())
    lines.append(SECTIONS[3])
    if len(s):
        lines.append(s.groupby(["type_name", s.subtype_name.fillna("")]).size().sort_values(ascending=False).to_string())

    lines.append(SECTIONS[4])
    unm = s[s.engine_type == "UNKNOWN"] if len(s) else s
    und = t["dings"][t["dings"].engine_type == "UNKNOWN"] if len(t["dings"]) else t["dings"]
    lines.append(f"markers UNKNOWN: {len(unm)} " + (unm.groupby(["type_name", unm.subtype_name.fillna("")]).size().to_dict().__repr__() if len(unm) else ""))
    lines.append(f"dings UNKNOWN: {len(und)} " + (und.type_name.value_counts().to_dict().__repr__() if len(und) else ""))

    lines.append(SECTIONS[5])
    for name, cols in LABEL_NULL_COLUMNS.items():
        df = t[name]
        for c in cols:
            if c in df.columns and len(df):
                n = int(df[c].isna().sum())
                if n:
                    lines.append(f"{name}.{c}: {n}/{len(df)} null")

    lines.append(SECTIONS[6])
    lines.append(f"score_total present: {int(m.score_total.notna().sum()) if len(m) else 0}/{len(m)}")

    lines.append(SECTIONS[7])
    if len(m):
        for side in ("front", "back"):
            sub = m[m[f"ann_{side}_w"].notna() & m.image_w.notna()]
            if len(sub):
                ratio = (sub[f"ann_{side}_w"] / sub[f"ann_{side}_h"]) / (sub.image_w / sub.image_h)
                bad = int(((ratio - 1).abs() > 0.01).sum())
                lines.append(f"{side}: {len(sub)} sides with canvas; aspect mismatch > 1%: {bad}")

    lines.append(SECTIONS[8])
    if len(m):
        g = m.groupby("grade_label").agg(cards=("cert", "count"), uploaded=("n_files_uploaded", "sum"),
                                        unavailable=("n_files_unavailable", "sum"))
        lines.append(g.to_string())

    lines.append(SECTIONS[9])
    lines.append("(requires the store; see cli stats --db for the joined count)")

    lines.append(SECTIONS[10])
    lines.append(f"duplicate certs in manifest: {int(m.cert.duplicated().sum()) if len(m) else 0}; "
                 f"in splits: {int(sp.cert.duplicated().sum()) if len(sp) else 0}")
    return "\n".join(lines)


def ding_crops_without_upload(out_dir: str, store) -> int:
    d = pd.read_parquet(Path(out_dir) / "dings.parquet")
    if not len(d):
        return 0
    missing = 0
    for cert, grp in d.groupby("cert"):
        have = store.files_for(cert)
        missing += int((~grp.crop_path.str.split("/").str[-1].isin(have)).sum())
    return missing
