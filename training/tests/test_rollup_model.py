"""Step 13.5: TAG's eight-subgrade rollup learned as monotone boosted trees, exported as the JSON
tree format `api/_lib/surfaceDeduction.js` already walks."""
import json

import numpy as np
import pandas as pd
import pytest

from trainlib import rollup_model as rm


def _frame(n, seed):
    """Synthetic certs whose grade follows a monotone rule of the four rollups (+ noise)."""
    rng = np.random.default_rng(seed)
    r = rng.uniform(0, 1000, size=(n, 4))
    sf, sb = rng.uniform(0, 1000, size=n), rng.uniform(0, 1000, size=n)
    nd = rng.integers(0, 6, size=n); nf, nb = rng.integers(0, 4, size=n), rng.integers(0, 4, size=n)
    score = 0.6 * np.minimum(r.min(axis=1), np.minimum(sf, sb)) + 0.4 * r.mean(axis=1) - 15 * nd + rng.normal(0, 8, size=n)
    idx = np.clip(np.round((score - 100) / 900 * 18), 0, 18).astype(int)
    return pd.DataFrame({"cert": [f"C{seed}{i}" for i in range(n)],
                         "rollup_centering": r[:, 0], "rollup_corners": r[:, 1], "rollup_edges": r[:, 2],
                         "rollup_surface": r[:, 3], "surface_front": sf, "surface_back": sb,
                         "n_markers_front": nf, "n_markers_back": nb, "n_dings": nd,
                         "score_total": score, "grade_label": [rm.GRADES[i] for i in idx]})


def test_grade_order_and_index_roundtrip():
    assert len(rm.GRADES) == 19 and rm.GRADES[0] == "1 POOR" and rm.GRADES[-2:] == ["10 GEM MINT", "10 PRISTINE"]
    assert rm.grade_index(pd.Series(["1 POOR", "9 MINT", "10 PRISTINE"])).tolist() == [0, 16, 18]


def test_rows_drops_certs_missing_any_input_or_without_a_published_total():
    df = _frame(6, 0); df.loc[2, "rollup_edges"] = np.nan; df.loc[3, "grade_label"] = None; df.loc[4, "score_total"] = np.nan
    rows = rm.rows(df)
    assert len(rows) == 3 and list(rows.columns[-1:]) == ["target"]
    assert rm.FEATURES == ["rollup_centering", "rollup_corners", "rollup_edges", "rollup_surface",
                           "surface_front", "surface_back", "n_markers_front", "n_markers_back", "n_dings"]
    assert rm.MONOTONE == [1, 1, 1, 1, 1, 0, -1, -1, -1]  # TAG's published back-surface score is not monotone


def test_fit_is_monotone_and_beats_the_min_rollup_baseline():
    train, val = rm.rows(_frame(4000, 1)), rm.rows(_frame(800, 2))
    model, report = rm.fit(train, val, seed=0)
    assert list(report.columns) == ["split", "n", "exact", "within_half", "baseline_exact"]
    row = report.iloc[0]
    assert row.exact > 0.6 and row.within_half > 0.95 and row.exact > row.baseline_exact
    X = rm.features(val)
    base = rm.predict_index(model, X)
    for j, direction in enumerate(rm.MONOTONE):
        if direction == 0:
            continue
        Xp = X.copy(); Xp[:, j] = Xp[:, j] + (50 if direction > 0 else 1)  # better score / one more defect
        delta = rm.predict_index(model, Xp) - base
        assert (direction * delta >= -1e-9).all(), f"feature {j} not monotone in direction {direction}"
    labels = rm.predict_grade(model, X)
    assert set(labels) <= set(rm.GRADES)


def test_json_export_matches_sklearn_and_carries_test_vectors(tmp_path):
    train, val = rm.rows(_frame(1500, 3)), rm.rows(_frame(200, 4))
    model, _ = rm.fit(train, val, seed=0)
    doc = rm.to_json(model, val, version="grade-rollup-test", n_vectors=5)
    for key in ("version", "baseline", "features", "grades", "clip", "node_fields", "trees", "test_vectors"):
        assert key in doc
    assert doc["node_fields"] == ["value", "feature", "threshold", "missing_left", "left", "right", "is_leaf"]
    assert doc["clip"] == [0, 18] and doc["features"] == rm.FEATURES and doc["grades"] == rm.GRADES
    X = rm.features(val)
    walked = np.array([rm.predict_json(doc, x) for x in X])
    assert np.allclose(walked, rm.predict_index(model, X), atol=1e-6)
    v = doc["test_vectors"][0]
    assert set(v) == set(rm.FEATURES) | {"expected_index", "expected_grade"}
    assert abs(rm.predict_json(doc, [v[f] for f in rm.FEATURES]) - v["expected_index"]) < 1e-9


def test_cli_fits_from_manifest_and_writes_json(tmp_path):
    ds = tmp_path / "dataset"; ds.mkdir()
    frame = pd.concat([_frame(600, 5), _frame(150, 6), _frame(150, 7)]).reset_index(drop=True)
    frame.to_parquet(ds / "manifest.parquet", index=False)
    splits = ["train"] * 600 + ["val"] * 150 + ["test"] * 150
    pd.DataFrame({"cert": frame.cert, "split": splits}).to_parquet(tmp_path / "splits.parquet", index=False)
    (tmp_path / "ds.toml").write_text('[bucket]\nendpoint="e"\nregion="auto"\nname="b"\nprefix="p"\n', encoding="utf-8")
    cfg = tmp_path / "config.toml"
    cfg.write_text('[paths]\ndataset_dir = "dataset"\nsplits_path = "splits.parquet"\ncache_dir = "cache"\nruns_dir = "runs"\n'
                   '[r2]\nconfig_toml = "ds.toml"\n', encoding="utf-8")
    out = tmp_path / "models" / "grade-rollup-v1.json"
    rm.main(["--config", str(cfg), "--out", str(out), "--seed", "0", "--train-splits", "train", "--val-splits", "val"])
    doc = json.loads(out.read_text())
    assert doc["monotone"] == rm.MONOTONE
    assert doc["version"] == "grade-rollup-v1" and len(doc["trees"]) > 0
    rep = pd.read_csv(out.parent / "rollup_val.csv")
    assert rep.split.tolist() == ["val"] and not (out.parent / "rollup_test.csv").exists()
    rm.main(["--config", str(cfg), "--out", str(out), "--seed", "0", "--final-eval", "--train-splits", "train", "--val-splits", "val"])
    assert pd.read_csv(out.parent / "rollup_test.csv").split.tolist() == ["test"]
