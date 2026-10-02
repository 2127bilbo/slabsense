# SlabSense — https://www.slabsenseai.com
# Copyright (c) 2026 SlabSense. All rights reserved.
# Proprietary and confidential; see LICENSE at the repository root.
"""TAG's rollup learned: subgrades + defect counts -> TAG grade.

Step 13.5. Monotone gradient-boosted trees on the ordinal grade index (0 = 1 POOR ... 18 = 10
PRISTINE), exported as the plain decision-tree JSON that `api/_lib/surfaceDeduction.js` walks:
node = [value, feature, threshold, missing_left, left, right, is_leaf], prediction =
baseline + sum of leaf values, clipped; the app rounds the index to the nearest grade.

Inputs (2026-10-01 measurement on TAG's own numbers): the four attribute rollups alone give
58 % exact / 94 % within a half grade; adding the per-side surface scores and the defect counts
(front/back markers, dings) gives 91 % / 99 %. The size score adds nothing and is left out.
Only certs whose DIG report publishes `scoreTotal` (orderType st3 and everything graded in
2026) are used: for the older standard-tier certs the published rollups track the grade only
loosely (rank correlation 0.80 vs 0.985), so they would teach noise.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from .config import load_config

GRADES = ["1 POOR", "1.5 FAIR", "2 GOOD", "2.5 GOOD+", "3 VG", "3.5 VG+", "4 VG EX", "4.5 VG EX+",
          "5 EXCELLENT", "5.5 EXCELLENT+", "6 EX MT", "6.5 EX MT+", "7 NEAR MINT", "7.5 NEAR MINT+",
          "8 NM MT", "8.5 NM MT+", "9 MINT", "10 GEM MINT", "10 PRISTINE"]
FEATURES = ["rollup_centering", "rollup_corners", "rollup_edges", "rollup_surface",
            "surface_front", "surface_back", "n_markers_front", "n_markers_back", "n_dings"]
MONOTONE = [1, 1, 1, 1, 1, 0, -1, -1, -1]  # higher score -> never a lower grade; more defects -> never higher.
# surface_back is left unconstrained: TAG's published back-surface score is not monotone in the grade
# (constraining it costs 21 points of exact accuracy on val; every other constraint is free).
NODE_FIELDS = ["value", "feature", "threshold", "missing_left", "left", "right", "is_leaf"]
CLIP = [0, len(GRADES) - 1]
# TAG score -> grade index, from the published scale (taggrading.com/pages/scale); the baseline
# maps the worst rollup through it, which is the "min subgrade" rule the engine started from.
_SCALE_FLOORS = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 990]


def grade_index(labels: pd.Series) -> pd.Series:
    return labels.map({g: i for i, g in enumerate(GRADES)})


def rows(manifest: pd.DataFrame) -> pd.DataFrame:
    """One row per cert with every input, a known grade and a published total; `target` is the
    ordinal grade index."""
    df = manifest[["cert", *FEATURES, "grade_label", "score_total"]].copy()
    df["target"] = grade_index(df.grade_label.astype("object"))
    df = df.dropna(subset=[*FEATURES, "target", "score_total"])
    df["target"] = df.target.astype(int)
    return df[["cert", *FEATURES, "grade_label", "target"]].reset_index(drop=True)


def features(df: pd.DataFrame) -> np.ndarray:
    return df[FEATURES].to_numpy(dtype=np.float64)


def predict_index(model, X: np.ndarray) -> np.ndarray:
    return np.clip(model.predict(X), CLIP[0], CLIP[1])


def predict_grade(model, X: np.ndarray) -> list[str]:
    return [GRADES[int(round(v))] for v in predict_index(model, X)]


def _baseline_index(X: np.ndarray) -> np.ndarray:
    worst = X[:, :4].min(axis=1)
    return np.searchsorted(np.asarray(_SCALE_FLOORS), worst, side="right") - 1


def _report(split: str, df: pd.DataFrame, pred: np.ndarray) -> pd.DataFrame:
    t = df.target.to_numpy(); p = np.round(pred).astype(int)
    b = np.clip(_baseline_index(features(df)), CLIP[0], CLIP[1])
    return pd.DataFrame([{"split": split, "n": len(df), "exact": float((p == t).mean()),
                          "within_half": float((np.abs(p - t) <= 1).mean()), "baseline_exact": float((b == t).mean())}])


def fit(train: pd.DataFrame, val: pd.DataFrame, seed: int = 42):
    model = HistGradientBoostingRegressor(max_iter=600, learning_rate=0.05, max_leaf_nodes=31,
                                          monotonic_cst=MONOTONE, early_stopping=True,
                                          validation_fraction=0.1, random_state=seed)
    model.fit(features(train), train.target.to_numpy(dtype=np.float64))
    return model, _report("val", val, predict_index(model, features(val)))


def _tree_nodes(predictor) -> list[list]:
    out = []
    for n in predictor.nodes:
        out.append([float(n["value"]), int(n["feature_idx"]), float(n["num_threshold"]),
                    int(n["missing_go_to_left"]), int(n["left"]), int(n["right"]), int(n["is_leaf"])])
    return out


def to_json(model, sample: pd.DataFrame, version: str, n_vectors: int = 20) -> dict:
    trees = [_tree_nodes(p[0]) for p in model._predictors]
    X = features(sample)
    pred = predict_index(model, X)
    k = min(n_vectors, len(sample))
    vectors = [{**{f: float(X[i, j]) for j, f in enumerate(FEATURES)},
                "expected_index": float(pred[i]), "expected_grade": GRADES[int(round(pred[i]))]} for i in range(k)]
    return {"version": version, "baseline": float(np.asarray(model._baseline_prediction).ravel()[0]),
            "features": FEATURES, "monotone": MONOTONE, "grades": GRADES, "clip": CLIP, "node_fields": NODE_FIELDS,
            "trees": trees, "test_vectors": vectors,
            "note": "inputs: TAG's four attribute rollups and the per-side surface scores (0-1000), then the "
                    "front/back marker counts and the ding count; output is the ordinal grade index into "
                    "`grades` (round to nearest); walk as in api/_lib/surfaceDeduction.js"}


def predict_json(doc: dict, x) -> float:
    s = doc["baseline"]
    for tree in doc["trees"]:
        i = 0
        while True:
            n = tree[i]
            if n[6]:
                s += n[0]; break
            v = x[n[1]]
            i = (n[4] if n[3] else n[5]) if (v != v) else (n[4] if v <= n[2] else n[5])
    return float(min(doc["clip"][1], max(doc["clip"][0], s)))


def _split_rows(cfg, splits: str) -> pd.DataFrame:
    """Rows for a comma list of split names (Step 13: `train,foil2026-train`)."""
    man = pd.read_parquet(cfg.dataset_dir / "manifest.parquet")
    sp = pd.read_parquet(cfg.splits_path)[["cert", "split"]]
    names = [n.strip() for n in splits.split(",") if n.strip()]
    known = sorted(sp.split.unique())
    for n in names:
        if n not in known:
            raise ValueError(f"unknown split {n!r}; splits file has {known}")
    return rows(man[man.cert.isin(sp[sp.split.isin(names)].cert)])


def main(argv=None) -> Path:
    p = argparse.ArgumentParser(prog="rollup_model")
    p.add_argument("--config", default="config.toml"); p.add_argument("--out", required=True)
    p.add_argument("--final-eval", action="store_true"); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--version", default=None, help="defaults to the output file's stem")
    p.add_argument("--train-splits", default="train,foil2026-train"); p.add_argument("--val-splits", default="val,foil2026-val")
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    train, val = _split_rows(cfg, args.train_splits), _split_rows(cfg, args.val_splits)
    model, report = fit(train, val, args.seed)
    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True)
    doc = to_json(model, val, args.version or out.stem)
    out.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    report.to_csv(out.parent / "rollup_val.csv", index=False)
    print(f"fit on {len(train)} certs from {args.train_splits} ({model.n_iter_} trees); val ({args.val_splits}):")
    print(report.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    if args.final_eval:
        test = _split_rows(cfg, "test")
        rep = _report("test", test, predict_index(model, features(test)))
        rep.to_csv(out.parent / "rollup_test.csv", index=False)
        print("test:"); print(rep.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    return out


if __name__ == "__main__":
    main()
