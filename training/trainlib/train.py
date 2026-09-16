"""Train a corner or edge score model with typed targets (spec §7)."""
from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from . import metrics
from .config import load_config
from .data import SCALE, CropDataset, collate
from .models import ScoreRegressor, count_params, masked_loss, to_scores
from .tables import TASKS, filter_cached, load_task_table, target_kinds, target_names

BASE_LOG_COLUMNS = ["epoch", "train_loss", "val_loss", "lr", "seconds"]


def metric_keys(targets) -> list[str]:
    """Metric column names in target order: one `mae_<name>` per regression target,
    four columns (`auroc`/`precision`/`recall`/`npos`) per binary target."""
    keys = []
    for name, kind, _column in targets:
        if kind == "regress":
            keys.append(f"mae_{name}")
        else:
            keys += [f"auroc_{name}", f"precision_{name}", f"recall_{name}", f"npos_{name}"]
    return keys


def log_columns(task: str) -> list[str]:
    return BASE_LOG_COLUMNS + metric_keys(TASKS[task]["targets"])


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="train")
    p.add_argument("--config", default="config.toml")
    p.add_argument("--task", choices=list(TASKS), required=True)
    p.add_argument("--run-name", required=True)
    p.add_argument("--epochs", type=int, default=10)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--weight-decay", type=float, default=0.05)
    p.add_argument("--limit-cards", type=int)
    p.add_argument("--val-limit-cards", type=int)
    p.add_argument("--backbone", default="convnext_tiny")
    p.add_argument("--no-pretrained", action="store_true")
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--input-size", type=int, help="override the square input size (tests only)")
    return p


def make_loader(df, task, cache_dir, train, batch_size, workers, input_size=None):
    ds = CropDataset(df, task, cache_dir, train=train, input_size=(input_size, input_size) if input_size else None)
    return DataLoader(ds, batch_size=batch_size, shuffle=train, num_workers=workers, collate_fn=collate,
                      pin_memory=(workers > 0), drop_last=False, persistent_workers=(workers > 0))


@torch.no_grad()
def evaluate_loader(model, loader, device, kinds, names) -> dict:
    """`loss` plus, per target (in order): `mae_<name>` for regression, or
    `auroc_<name>`/`precision_<name>`/`recall_<name>`/`npos_<name>` for binary."""
    model.eval()
    n_targets = len(kinds)
    loss_sum = 0.0
    batches = 0
    mae_sum = [0.0] * n_targets
    mae_n = [0] * n_targets
    scores_by_col: list[list[torch.Tensor]] = [[] for _ in range(n_targets)]
    labels_by_col: list[list[torch.Tensor]] = [[] for _ in range(n_targets)]
    for imgs, sides, targets, masks in loader:
        imgs, sides, targets, masks = imgs.to(device), sides.to(device), targets.to(device), masks.to(device)
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            pred = model(imgs, sides)
        pred = pred.float()
        loss_sum += masked_loss(pred, targets, masks, kinds).item()
        batches += 1
        scores = to_scores(pred, kinds)
        for j in range(n_targets):
            m = masks[:, j].cpu()
            if kinds[j] == "regress":
                err = (scores[:, j].cpu() - targets[:, j].cpu()).abs() * m
                mae_sum[j] += err.sum().item()
                mae_n[j] += int(m.sum().item())
            else:
                keep = m.bool()
                scores_by_col[j].append(scores[:, j].cpu()[keep])
                labels_by_col[j].append(targets[:, j].cpu()[keep])
    result = {"loss": loss_sum / max(batches, 1)}
    for j, name in enumerate(names):
        if kinds[j] == "regress":
            result[f"mae_{name}"] = SCALE * mae_sum[j] / mae_n[j] if mae_n[j] else float("nan")
        else:
            s = torch.cat(scores_by_col[j]) if scores_by_col[j] else torch.empty(0)
            l = torch.cat(labels_by_col[j]) if labels_by_col[j] else torch.empty(0)
            result[f"auroc_{name}"] = metrics.auroc(s, l)
            precision, recall = metrics.precision_recall_at(s, l)
            result[f"precision_{name}"] = precision
            result[f"recall_{name}"] = recall
            result[f"npos_{name}"] = int((l == 1).sum().item()) if l.numel() else 0
    return result


def run_epoch(model, loader, optimizer, scaler, scheduler, device, kinds) -> float:
    model.train(); total = 0.0; batches = 0
    for imgs, sides, targets, masks in loader:
        imgs, sides, targets, masks = imgs.to(device), sides.to(device), targets.to(device), masks.to(device)
        optimizer.zero_grad(set_to_none=True)
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            pred = model(imgs, sides)
        loss = masked_loss(pred.float(), targets, masks, kinds)
        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optimizer); scaler.update(); scheduler.step()
        total += loss.item(); batches += 1
    return total / max(batches, 1)


def _fmt(v) -> str:
    return str(v) if isinstance(v, int) else f"{v:.4f}"


def main(argv=None) -> Path:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    torch.manual_seed(args.seed)
    device = torch.device(args.device)
    spec = TASKS[args.task]
    kinds = target_kinds(args.task)
    names = target_names(args.task)
    cols = log_columns(args.task)
    metric_cols = cols[len(BASE_LOG_COLUMNS):]

    train_df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, "train", args.limit_cards, args.seed)
    val_df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, "val", args.val_limit_cards, args.seed)
    train_df, train_dropped = filter_cached(train_df, cfg.cache_dir, args.task)
    val_df, val_dropped = filter_cached(val_df, cfg.cache_dir, args.task)
    print(f"train: dropped {train_dropped} rows with no cached crop")
    print(f"val: dropped {val_dropped} rows with no cached crop")
    train_loader = make_loader(train_df, args.task, cfg.cache_dir, True, args.batch_size, args.workers, args.input_size)
    val_loader = make_loader(val_df, args.task, cfg.cache_dir, False, args.batch_size, args.workers, args.input_size)

    model = ScoreRegressor(len(spec["targets"]), args.backbone, pretrained=not args.no_pretrained).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    steps = max(1, args.epochs * len(train_loader))
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=args.lr, total_steps=steps, pct_start=0.1)
    scaler = torch.amp.GradScaler("cuda", enabled=(device.type == "cuda"))

    run_dir = Path(cfg.runs_dir) / args.task / args.run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "args.json").write_text(json.dumps(vars(args), indent=1), encoding="utf-8")
    print(f"{args.task}: {len(train_df)} train rows / {len(val_df)} val rows; params {count_params(model):,}; device {device}")

    best = float("inf")
    with open(run_dir / "log.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(cols)
        for epoch in range(1, args.epochs + 1):
            t0 = time.time()
            train_loss = run_epoch(model, train_loader, optimizer, scaler, scheduler, device, kinds)
            val = evaluate_loader(model, val_loader, device, kinds, names)
            secs = time.time() - t0
            row = [epoch, f"{train_loss:.5f}", f"{val['loss']:.5f}", f"{scheduler.get_last_lr()[0]:.2e}", f"{secs:.1f}"]
            row += [_fmt(val[k]) for k in metric_cols]
            w.writerow(row); f.flush()
            metrics_str = " ".join(f"{k}={_fmt(val[k])}" for k in metric_cols)
            print(f"epoch {epoch}/{args.epochs} train {train_loss:.4f} val {val['loss']:.4f} {metrics_str} {secs:.0f}s")
            state = {"model": model.state_dict(), "task": args.task, "backbone": args.backbone,
                     "n_out": len(spec["targets"]), "epoch": epoch, "val_loss": val["loss"],
                     "kinds": kinds, "target_names": names}
            torch.save(state, run_dir / "last.pt")
            if val["loss"] < best:
                best = val["loss"]; torch.save(state, run_dir / "best.pt")
    print(f"best val loss {best:.5f}; artifacts in {run_dir}")
    if device.type == "cuda":
        print(f"peak GPU memory: {torch.cuda.max_memory_allocated()/2**30:.2f} GiB")
    return run_dir


if __name__ == "__main__":
    main()
