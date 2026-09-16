"""Read the built parquet tables and print a health report (spec §6.2)."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from . import labels

SECTIONS = (
    "== cards by grade and split ==", "== crops by split ==", "== markers by engine_type ==",
    "== markers by type_name ==", "== unmapped ==", "== nulls ==", "== score_total coverage ==",
    "== canvas aspect check ==", "== file completeness by grade ==", "== ding crops without upload ==",
    "== duplicates ==", "== markers with rotation ==", "== boxes out of range ==",
    "== slot targets ==",
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

    # A subtype that map_engine_type can't match falls straight through to UNKNOWN, but the
    # UNKNOWN totals above don't say *why* — this lists exactly the (type, subtype) pairs
    # missing an exact `type|subtype` key in type_map.json, i.e. what needs adding there.
    keys = labels.type_map_keys()
    if len(s):
        has_subtype = s.subtype_name.notna() & (s.subtype_name.astype(str) != "")
        sub = s[has_subtype]
        combo = sub.type_name.astype(str) + "|" + sub.subtype_name.astype(str)
        fallback = sub[~combo.isin(keys)]
    else:
        fallback = s
    lines.append(f"fallback pairs (type|subtype not in map): {len(fallback)} " +
                 (fallback.groupby(["type_name", "subtype_name"]).size().to_dict().__repr__() if len(fallback) else ""))

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
    lines.append("compares each side's canvas (ann_*_w/h) to the card's single image_w/h; "
                 "a training-time check must read the real sfx_* pixel dimensions instead.")
    offenders: list[tuple[str, str, float]] = []
    if len(m):
        for side in ("front", "back"):
            sub = m[m[f"ann_{side}_w"].notna() & m.image_w.notna()]
            if len(sub):
                ratio = (sub[f"ann_{side}_w"] / sub[f"ann_{side}_h"]) / (sub.image_w / sub.image_h)
                bad_mask = (ratio - 1).abs() > 0.01
                lines.append(f"{side}: {len(sub)} sides with canvas; aspect mismatch > 1%: {int(bad_mask.sum())}")
                offenders.extend(zip(sub.cert[bad_mask], [side] * int(bad_mask.sum()), ratio[bad_mask]))
    # A training-time exclusion list can be built straight from this report: the worst
    # offenders (by how far the ratio departs from 1), capped so the report stays readable.
    if offenders:
        offenders.sort(key=lambda row: abs(row[2] - 1), reverse=True)
        lines.append("offending certs (cert, side, ratio), worst first:")
        for cert, side, ratio in offenders[:20]:
            lines.append(f"  {cert} {side} {ratio:.4f}")

    lines.append(SECTIONS[8])
    if len(m):
        g = m.groupby("grade_label").agg(cards=("cert", "count"), uploaded=("n_files_uploaded", "sum"),
                                        unavailable=("n_files_unavailable", "sum"))
        lines.append(g.to_string())

    lines.append(SECTIONS[9])
    lines.append("ding crops not in files table: (run `python -m tagdataset stats` for the store-joined count)")

    lines.append(SECTIONS[10])
    lines.append(f"duplicate certs in manifest: {int(m.cert.duplicated().sum()) if len(m) else 0}; "
                 f"in splits: {int(sp.cert.duplicated().sum()) if len(sp) else 0}")

    lines.append(SECTIONS[11])
    if len(s):
        rot = s[s.rotation_deg != 0]
        lines.append(f"rotated markers: {len(rot)} " +
                     (rot.groupby("family").size().to_dict().__repr__() if len(rot) else ""))
        # raw_w/raw_h are the un-rotated fractions; compare against the (possibly expanded)
        # w/h to see how many rotated boxes actually grew by a meaningful amount.
        if len(rot):
            grew = (rot.w - rot.raw_w).abs() > 0.01
            grew |= (rot.h - rot.raw_h).abs() > 0.01
            lines.append(f"rotated markers with box expanded >1% of card: {int(grew.sum())}")
        else:
            lines.append("rotated markers with box expanded >1% of card: 0")
    else:
        lines.append("rotated markers: 0")
        lines.append("rotated markers with box expanded >1% of card: 0")

    lines.append(SECTIONS[12])
    if len(s):
        bad = s[(s.x < 0) | (s.y < 0) | ((s.x + s.w) > 1) | ((s.y + s.h) > 1)]
        lines.append(f"boxes out of range: {len(bad)}")
    else:
        lines.append("boxes out of range: 0")

    lines.append(SECTIONS[13])
    unassigned = int(m.n_dings_unassigned.sum()) if len(m) and "n_dings_unassigned" in m.columns else 0
    lines.append(f"dings unassigned to a slot: {unassigned}")
    for name, rollup_col in (("corners", "rollup_corners"), ("edges", "rollup_edges")):
        df = t[name]
        if not len(df):
            lines.append(f"{name}: no rows")
            continue
        n_wear = int((df.ding_count > 0).sum())
        has_ded = df.marker_deduction.notna()
        by_source = df.loc[has_ded, "marker_source"].fillna("None").value_counts().to_dict()
        lines.append(f"{name}: ding_count>0: {n_wear}/{len(df)}; marker_deduction present: "
                     f"{int(has_ded.sum())}/{len(df)} by source {by_source}")
        # Restrict the correlation to cards that have at least one rollup-sourced slot in
        # this table: a card with no rollup marker at all usually has no per-slot
        # deduction data either (constituent-only or none), so its summed deduction is an
        # uninformative 0 that would just dilute the correlation against a real deficit
        # (this matches the plan's measured fact: 0.90 over the 9,947 cards with a rollup
        # corner marker, not 0 over all 27,751 cards).
        rollup_certs = df.loc[df.marker_source == "rollup", "cert"].unique()
        sub = df[df.cert.isin(rollup_certs)]
        per_card = sub.groupby("cert").marker_deduction.sum()
        joined = per_card.to_frame("sum_deduction").merge(m[["cert", rollup_col]], on="cert", how="inner")
        joined = joined.dropna(subset=[rollup_col])
        inverted = 1000 - joined[rollup_col]
        # Guard against a zero-variance side (e.g. a tiny fixture where every card has the
        # same rollup score): pandas' corr() would otherwise divide by a zero stddev and
        # numpy raises "invalid value encountered in divide" as a RuntimeWarning.
        if len(joined) > 1 and joined["sum_deduction"].std() > 0 and inverted.std() > 0:
            corr = joined["sum_deduction"].corr(inverted)
            corr_str = f"{corr:.4f}"
        else:
            corr_str = "nan"
        lines.append(f"{name}: correlation(sum marker_deduction, 1000 - {rollup_col}) = {corr_str} "
                     f"(n={len(joined)} cards with a rollup {name[:-1]} marker)")
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
