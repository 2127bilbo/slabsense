"""Per-grade metric tables against TAG typed targets (spec §7 metrics, §12)."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from . import metrics
from .config import load_config
from .data import SCALE
from .models import ScoreRegressor, to_scores
from .tables import TASKS, centering_deviation_bucket, filter_cached, load_task_table, target_index
from .train import make_loader

# Channel-pair labels, positional: `pairs[0]` -> `lr`, `pairs[1]` -> `tb` (matches the order of
# `TASKS["centering_rgb"]["ratio_pairs"]`, the only task with ratio pairs today).
_RATIO_AXES = ("lr", "tb")


@torch.no_grad()
def _predict(model, loader, device):
    model.eval(); preds, targets, masks = [], [], []
    for imgs, sides, t, m in loader:
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            p = model(imgs.to(device), sides.to(device))
        preds.append(p.float().cpu()); targets.append(t); masks.append(m)
    return torch.cat(preds), torch.cat(targets), torch.cat(masks)


def _rows_with_every_pair_column_present(masks: torch.Tensor, pairs: list[tuple[int, int]]) -> torch.Tensor:
    idx_cols = sorted({i for pair in pairs for i in pair})
    keep = torch.ones(masks.shape[0], dtype=torch.bool)
    for i in idx_cols:
        keep &= masks[:, i] > 0
    return keep


def ratio_metrics(scores: torch.Tensor, targets: torch.Tensor, masks: torch.Tensor,
                  pairs: list[tuple[int, int]]) -> dict:
    """Compression-ratio metrics for `pairs` (channel-index tuples into `scores`/`targets`/
    `masks`, e.g. `[(dte_l_idx, dte_r_idx), (dte_t_idx, dte_b_idx)]`; positionally labelled via
    `_RATIO_AXES`, i.e. the first pair is `lr` and the second is `tb`).

    For each pair `(i, j)`, `r = x[:, i] / (x[:, i] + x[:, j] + 1e-6)` on the 0-1 scale, for both
    `scores` and `targets`, restricted to rows where every mask column referenced by any pair is
    1 (the centering task's four distances are always present or all missing together, but this
    keeps the function correct regardless). Returns a dict with:

    - `mae_ratio_<axis>`: mean `|pred_ratio - target_ratio| * 100` (ratio points) for that axis;
      NaN if no row qualifies.
    - `within1` / `within2`: fraction of qualifying rows where, for EVERY axis, that row's delta
      is `<= 1` / `<= 2` ratio points; NaN if no row qualifies.
    - `slope`: ordinary least-squares slope (`numpy.polyfit` degree 1, free intercept) of the
      PREDICTED deviation `|pred_ratio*100 - 50|` regressed on the TAG deviation
      `|target_ratio*100 - 50|`, pooled over every axis and qualifying row. This is the
      compression test: under `pred ~= c * tag + noise` this slope estimates `c` directly, so a
      model that compresses toward the center (predicts less deviation than TAG as TAG's
      deviation grows) reads below 1. The other regression direction (TAG on predicted) is the
      wrong test here - for a noisy compressing model it is pulled back toward 1 by the
      predicted deviation's own noise (attenuation bias / regression dilution) and can pass a
      ">= 1" style bar even when the model is compressing hard. NaN with fewer than 2 pooled
      points or when the TAG deviation has zero spread (an undefined/degenerate fit).
    """
    keep = _rows_with_every_pair_column_present(masks, pairs)
    result: dict[str, float] = {}
    deltas, pred_devs, target_devs = [], [], []
    for axis, (i, j) in zip(_RATIO_AXES, pairs):
        s_i, s_j = scores[keep, i], scores[keep, j]
        t_i, t_j = targets[keep, i], targets[keep, j]
        pred_r = s_i / (s_i + s_j + 1e-6)
        target_r = t_i / (t_i + t_j + 1e-6)
        delta = (pred_r - target_r).abs() * 100
        result[f"mae_ratio_{axis}"] = float(delta.mean()) if delta.numel() else float("nan")
        deltas.append(delta)
        pred_devs.append((pred_r * 100 - 50).abs())
        target_devs.append((target_r * 100 - 50).abs())

    if deltas and deltas[0].numel():
        row_max = torch.stack(deltas, dim=1).amax(dim=1)
        result["within1"] = float((row_max <= 1).float().mean())
        result["within2"] = float((row_max <= 2).float().mean())
    else:
        result["within1"] = float("nan")
        result["within2"] = float("nan")

    if pred_devs and pred_devs[0].numel():
        pred = torch.cat(pred_devs).numpy()
        tag = torch.cat(target_devs).numpy()
        # predicted deviation regressed on TAG's: slope < 1 means the model compresses (under-
        # predicts deviation as TAG's grows). See the docstring for why this direction, not the
        # reverse regression, is the compression test.
        result["slope"] = float(np.polyfit(tag, pred, 1)[0]) if len(tag) >= 2 and np.ptp(tag) > 0 else float("nan")
    else:
        result["slope"] = float("nan")
    return result


def bucket_table(scores: torch.Tensor, targets: torch.Tensor, masks: torch.Tensor,
                 pairs: list[tuple[int, int]], buckets) -> pd.DataFrame:
    """Group rows by `buckets` (bucket labels 0-4, e.g. from `tables.centering_deviation_bucket`
    on the targets) and report, per bucket: `n` (row count) and the mean TAG / predicted
    deviation in ratio points (`max` over `pairs`' axes of `|ratio*100 - 50|`), restricted to
    rows where every mask column referenced by `pairs` is 1. Always returns 5 rows (buckets
    0-4); a bucket with no qualifying rows gets `n=0` and NaN means.
    """
    keep = _rows_with_every_pair_column_present(masks, pairs).numpy()
    pred_devs, target_devs = [], []
    for i, j in pairs:
        s_i, s_j = scores[:, i], scores[:, j]
        t_i, t_j = targets[:, i], targets[:, j]
        pred_devs.append((s_i / (s_i + s_j + 1e-6) * 100 - 50).abs())
        target_devs.append((t_i / (t_i + t_j + 1e-6) * 100 - 50).abs())
    pred_dev = torch.stack(pred_devs, dim=1).amax(dim=1).numpy()
    target_dev = torch.stack(target_devs, dim=1).amax(dim=1).numpy()

    bucket_arr = pd.Series(buckets).reset_index(drop=True).to_numpy()
    rows = []
    for k in range(5):
        sel = keep & (bucket_arr == k)
        n = int(sel.sum())
        rows.append({
            "bucket": k,
            "n": n,
            "tag_mean_dev": float(target_dev[sel].mean()) if n else float("nan"),
            "pred_mean_dev": float(pred_dev[sel].mean()) if n else float("nan"),
        })
    return pd.DataFrame(rows)


def _grade_table(df: pd.DataFrame, task: str, target_names, kinds, scores: torch.Tensor,
                 target: torch.Tensor, mask: torch.Tensor) -> pd.DataFrame:
    ratio_pair_names = TASKS[task].get("ratio_pairs")
    pairs = ([(target_index(task, a), target_index(task, b)) for a, b in ratio_pair_names]
             if ratio_pair_names else None)
    rows = []
    groups = list(df.groupby("grade_label").indices.items()) + [("ALL", list(range(len(df))))]
    for grade, idx in groups:
        idx = torch.as_tensor(list(idx))
        row = {"grade_label": grade, "n_rows": int(len(idx))}
        for j, name in enumerate(target_names):
            m, s, t = mask[idx, j], scores[idx, j], target[idx, j]
            if kinds[j] == "regress":
                err = (s - t).abs() * m
                n = int(m.sum().item())
                row[f"mae_{name}"] = float(SCALE * err.sum() / n) if n else float("nan")
            else:
                keep = m.bool()
                sc, lb = s[keep], t[keep]
                row[f"auroc_{name}"] = metrics.auroc(sc, lb)
                precision, recall = metrics.precision_recall_at(sc, lb)
                row[f"precision_{name}"] = precision
                row[f"recall_{name}"] = recall
                row[f"npos_{name}"] = int((lb == 1).sum().item()) if lb.numel() else 0
        if pairs:
            rm = ratio_metrics(scores[idx], target[idx], mask[idx], pairs)
            row["mae_ratio_lr"] = rm["mae_ratio_lr"]
            row["mae_ratio_tb"] = rm["mae_ratio_tb"]
            row["within1"] = rm["within1"]
            row["within2"] = rm["within2"]
            row["slope"] = rm["slope"] if grade == "ALL" else float("nan")
        rows.append(row)
    return pd.DataFrame(rows)


def per_grade_table(model, df: pd.DataFrame, task: str, cache_dir, device, kinds, target_names,
                    batch_size=64, workers=0, input_size=None, phone_sim=False) -> pd.DataFrame:
    loader = make_loader(df, task, cache_dir, False, batch_size, workers, input_size, phone_sim=phone_sim)
    pred, target, mask = _predict(model, loader, device)
    scores = to_scores(pred, kinds)
    return _grade_table(df, task, target_names, kinds, scores, target, mask)


def main(argv=None) -> Path:
    p = argparse.ArgumentParser(prog="evaluate")
    p.add_argument("--config", default="config.toml"); p.add_argument("--task", choices=list(TASKS), required=True)
    p.add_argument("--checkpoint", required=True); p.add_argument("--split", choices=["val", "test"], default="val")
    p.add_argument("--final-eval", action="store_true"); p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--workers", type=int, default=6); p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--limit-cards", type=int); p.add_argument("--input-size", type=int)
    p.add_argument("--phone-sim", action="store_true",
                   help="deterministic phone-photo simulation on the eval crops "
                        "(corners/edges: black backdrop + 1 px blur + 0.5x resolution; "
                        "centering: 1 px blur + 0.5x resolution only, no backdrop change)")
    args = p.parse_args(argv)
    if args.phone_sim:
        print("phone-sim: ON")
    cfg = load_config(args.config); device = torch.device(args.device)
    df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, args.split, args.limit_cards, allow_test=args.final_eval)
    df, dropped = filter_cached(df, cfg.cache_dir, args.task)
    print(f"{args.split}: dropped {dropped} rows with no cached crop")
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = ScoreRegressor(ckpt["n_out"], ckpt["backbone"], pretrained=False)
    model.load_state_dict(ckpt["model"]); model.to(device)
    kinds = ckpt["kinds"]; target_names = ckpt["target_names"]
    loader = make_loader(df, args.task, cfg.cache_dir, False, args.batch_size, args.workers, args.input_size,
                         phone_sim=args.phone_sim)
    pred, target, mask = _predict(model, loader, device)
    scores = to_scores(pred, kinds)
    table = _grade_table(df, args.task, target_names, kinds, scores, target, mask)
    suffix = "_phonesim" if args.phone_sim else ""
    out = Path(args.checkpoint).parent / f"eval_{args.split}{suffix}.csv"
    table.to_csv(out, index=False)
    print(table.to_string(index=False, float_format=lambda v: f"{v:.4f}"))

    ratio_pair_names = TASKS[args.task].get("ratio_pairs")
    if ratio_pair_names:
        pairs = [(target_index(args.task, a), target_index(args.task, b)) for a, b in ratio_pair_names]
        target_df = pd.DataFrame({name: (target[:, j] * SCALE).numpy() for j, name in enumerate(target_names)})
        buckets = centering_deviation_bucket(target_df)
        bt = bucket_table(scores, target, mask, pairs, buckets)
        bt_out = Path(args.checkpoint).parent / f"eval_{args.split}{suffix}_buckets.csv"
        bt.to_csv(bt_out, index=False)
        print(bt.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    return out


if __name__ == "__main__":
    main()
