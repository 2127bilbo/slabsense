import numpy as np
import pandas as pd

from trainlib import deduction_model as dmod
from trainlib import surface_tables as st


def _boxes(n, seed):
    rng = np.random.default_rng(seed)
    label = rng.integers(1, 8, size=n)
    w = rng.uniform(0.002, 0.2, size=n); h = rng.uniform(0.002, 0.2, size=n)
    ded = np.clip(60 * label + 900 * np.sqrt(w * h) + rng.normal(0, 10, size=n), 0, 1000)
    return pd.DataFrame({"cert": [f"C{i}" for i in range(n)], "side": rng.choice(["F", "B"], size=n), "label": label,
                         "cls": [st.SURFACE_CLASSES[l - 1] for l in label], "x": rng.uniform(0, 0.8, size=n),
                         "y": rng.uniform(0, 0.8, size=n), "w": w, "h": h, "deduction": ded})


def test_feature_layout():
    b = _boxes(3, 0)
    X = dmod.features(b)
    assert X.shape == (3, 7 + 8)
    assert X[:, :7].sum(axis=1).tolist() == [1.0, 1.0, 1.0]
    assert np.allclose(X[:, 7], np.log(b.w * b.h))
    assert np.allclose(X[:, 14], (b.side == "B").astype(float))


def test_fit_beats_class_median_and_roundtrips(tmp_path):
    train, val = _boxes(2000, 1), _boxes(300, 2)
    model, report = dmod.fit(train, val, seed=0)
    assert list(report.columns) == ["class", "n", "mae", "baseline_mae"]
    allrow = report[report["class"] == "ALL"].iloc[0]
    assert allrow.mae < 0.5 * allrow.baseline_mae
    p = dmod.predict(model, val)
    assert p.min() >= 0.0 and p.max() <= 1000.0
    path = tmp_path / "d.joblib"; dmod.save(model, path)
    assert np.allclose(dmod.predict(dmod.load(path), val), p)
