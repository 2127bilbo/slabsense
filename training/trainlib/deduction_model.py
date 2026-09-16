"""Box -> TAG deduction regressor (class + geometry), gradient boosted."""
from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from .config import load_config
from .surface_tables import SURFACE_CLASSES, load_surface_split

FEATURE_NAMES = [f"is_{c}" for c in SURFACE_CLASSES] + ["log_area", "log_w", "log_h", "aspect", "cx", "cy", "border_dist", "is_back"]


def features(boxes: pd.DataFrame) -> np.ndarray:
    n = len(boxes)
    X = np.zeros((n, len(FEATURE_NAMES)), dtype=np.float64)
    lab = boxes.label.to_numpy().astype(int)
    X[np.arange(n), lab - 1] = 1.0
    w = np.clip(boxes.w.to_numpy(float), 1e-6, None); h = np.clip(boxes.h.to_numpy(float), 1e-6, None)
    cx = boxes.x.to_numpy(float) + w / 2; cy = boxes.y.to_numpy(float) + h / 2
    k = len(SURFACE_CLASSES)
    X[:, k] = np.log(w * h); X[:, k + 1] = np.log(w); X[:, k + 2] = np.log(h); X[:, k + 3] = np.log(w / h)
    X[:, k + 4] = cx; X[:, k + 5] = cy
    X[:, k + 6] = np.minimum.reduce([cx, cy, 1 - cx, 1 - cy])
    X[:, k + 7] = (boxes.side.to_numpy() == "B").astype(float)
    return X


def predict(model, boxes: pd.DataFrame) -> np.ndarray:
    return np.clip(model.predict(features(boxes)), 0.0, 1000.0)


def _report(train: pd.DataFrame, val: pd.DataFrame, pred: np.ndarray) -> pd.DataFrame:
    med = train.groupby("label").deduction.median()
    base = val.label.map(med).fillna(train.deduction.median()).to_numpy()
    err = np.abs(pred - val.deduction.to_numpy()); berr = np.abs(base - val.deduction.to_numpy())
    rows = []
    for i, c in enumerate(SURFACE_CLASSES):
        m = (val.label.to_numpy() == i + 1)
        rows.append({"class": c, "n": int(m.sum()), "mae": float(err[m].mean()) if m.any() else float("nan"),
                     "baseline_mae": float(berr[m].mean()) if m.any() else float("nan")})
    rows.append({"class": "ALL", "n": len(val), "mae": float(err.mean()), "baseline_mae": float(berr.mean())})
    return pd.DataFrame(rows)


def fit(train: pd.DataFrame, val: pd.DataFrame, seed: int = 42):
    model = HistGradientBoostingRegressor(max_iter=500, learning_rate=0.05, max_leaf_nodes=31, early_stopping=True,
                                          validation_fraction=0.1, random_state=seed)
    model.fit(features(train), train.deduction.to_numpy(float))
    return model, _report(train, val, predict(model, val))


def save(model, path: Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True); joblib.dump(model, path)


def load(path: Path):
    return joblib.load(path)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="deduction_model")
    p.add_argument("--config", default="config.toml"); p.add_argument("--out", required=True)
    p.add_argument("--final-eval", action="store_true"); p.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)
    cfg = load_config(args.config)
    _, train = load_surface_split(cfg.dataset_dir, cfg.splits_path, "train")
    _, val = load_surface_split(cfg.dataset_dir, cfg.splits_path, "val")
    model, report = fit(train, val, args.seed)
    out = Path(args.out); save(model, out)
    report.to_csv(out.parent / "deduction_val.csv", index=False)
    print(f"fit on {len(train)} boxes; val:"); print(report.to_string(index=False, float_format=lambda v: f"{v:.1f}"))
    if args.final_eval:
        _, test = load_surface_split(cfg.dataset_dir, cfg.splits_path, "test", allow_test=True)
        rep = _report(train, test, predict(model, test)); rep.to_csv(out.parent / "deduction_test.csv", index=False)
        print("test:"); print(rep.to_string(index=False, float_format=lambda v: f"{v:.1f}"))


if __name__ == "__main__":
    main()
