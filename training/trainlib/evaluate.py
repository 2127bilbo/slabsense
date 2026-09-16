"""Per-grade MAE tables against TAG scores (spec §7 metrics, §12)."""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import torch

from .config import load_config
from .data import SCALE
from .models import ScoreRegressor
from .tables import TASKS, load_task_table
from .train import LOW_THRESHOLD, make_loader


@torch.no_grad()
def _predict(model, loader, device):
    model.eval(); preds, targets, masks = [], [], []
    for imgs, sides, t, m in loader:
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            p = model(imgs.to(device), sides.to(device))
        preds.append(p.float().cpu()); targets.append(t); masks.append(m)
    return torch.cat(preds), torch.cat(targets), torch.cat(masks)


def per_grade_table(model, df: pd.DataFrame, task: str, cache_dir, device, batch_size=64, workers=0, input_size=None) -> pd.DataFrame:
    loader = make_loader(df, task, cache_dir, False, batch_size, workers, input_size)
    pred, target, mask = _predict(model, loader, device)
    err = (pred - target).abs() * SCALE
    low = mask * (target < LOW_THRESHOLD)
    names = TASKS[task]["targets"]
    rows = []
    groups = list(df.groupby("grade_label").indices.items()) + [("ALL", list(range(len(df))))]
    for grade, idx in groups:
        idx = torch.as_tensor(list(idx))
        m, l, e = mask[idx], low[idx], err[idx]
        row = {"grade_label": grade, "n": int(m.sum()), "n_low": int(l.sum()),
               "mae_points": float((e * m).sum() / max(m.sum(), 1)),
               "mae_low_points": float((e * l).sum() / l.sum()) if l.sum() > 0 else float("nan")}
        for j, name in enumerate(names):
            row[f"mae_{name}"] = float((e[:, j] * m[:, j]).sum() / max(m[:, j].sum(), 1))
        rows.append(row)
    return pd.DataFrame(rows)


def main(argv=None) -> Path:
    p = argparse.ArgumentParser(prog="evaluate")
    p.add_argument("--config", default="config.toml"); p.add_argument("--task", choices=list(TASKS), required=True)
    p.add_argument("--checkpoint", required=True); p.add_argument("--split", choices=["val", "test"], default="val")
    p.add_argument("--final-eval", action="store_true"); p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--workers", type=int, default=6); p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--limit-cards", type=int); p.add_argument("--input-size", type=int)
    args = p.parse_args(argv)
    cfg = load_config(args.config); device = torch.device(args.device)
    df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, args.split, args.limit_cards, allow_test=args.final_eval)
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = ScoreRegressor(ckpt["n_out"], ckpt["backbone"], pretrained=False)
    model.load_state_dict(ckpt["model"]); model.to(device)
    table = per_grade_table(model, df, args.task, cfg.cache_dir, device, args.batch_size, args.workers, args.input_size)
    out = Path(args.checkpoint).parent / f"eval_{args.split}.csv"
    table.to_csv(out, index=False)
    print(table.to_string(index=False, float_format=lambda v: f"{v:.1f}"))
    return out


if __name__ == "__main__":
    main()
