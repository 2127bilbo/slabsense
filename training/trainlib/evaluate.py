"""Per-grade metric tables against TAG typed targets (spec §7 metrics, §12)."""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import torch

from . import metrics
from .config import load_config
from .data import SCALE
from .models import ScoreRegressor, to_scores
from .tables import TASKS, filter_cached, load_task_table
from .train import make_loader


@torch.no_grad()
def _predict(model, loader, device):
    model.eval(); preds, targets, masks = [], [], []
    for imgs, sides, t, m in loader:
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            p = model(imgs.to(device), sides.to(device))
        preds.append(p.float().cpu()); targets.append(t); masks.append(m)
    return torch.cat(preds), torch.cat(targets), torch.cat(masks)


def per_grade_table(model, df: pd.DataFrame, task: str, cache_dir, device, kinds, target_names,
                    batch_size=64, workers=0, input_size=None) -> pd.DataFrame:
    loader = make_loader(df, task, cache_dir, False, batch_size, workers, input_size)
    pred, target, mask = _predict(model, loader, device)
    scores = to_scores(pred, kinds)
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
    df, dropped = filter_cached(df, cfg.cache_dir)
    print(f"{args.split}: dropped {dropped} rows with no cached crop")
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = ScoreRegressor(ckpt["n_out"], ckpt["backbone"], pretrained=False)
    model.load_state_dict(ckpt["model"]); model.to(device)
    kinds = ckpt["kinds"]; target_names = ckpt["target_names"]
    table = per_grade_table(model, df, args.task, cfg.cache_dir, device, kinds, target_names,
                            args.batch_size, args.workers, args.input_size)
    out = Path(args.checkpoint).parent / f"eval_{args.split}.csv"
    table.to_csv(out, index=False)
    print(table.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    return out


if __name__ == "__main__":
    main()
