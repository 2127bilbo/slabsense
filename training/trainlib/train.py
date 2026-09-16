"""Train a corner or edge score regressor (spec §7)."""
from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from .config import load_config
from .data import SCALE, CropDataset, collate
from .models import ScoreRegressor, count_params, masked_huber
from .tables import TASKS, filter_cached, load_task_table

LOG_COLUMNS = ["epoch", "train_loss", "val_loss", "val_mae_points", "val_mae_low_points", "lr", "seconds"]
LOW_THRESHOLD = 900.0 / SCALE


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
def evaluate_loader(model, loader, device) -> dict:
    model.eval()
    abs_sum = 0.0; n = 0; low_sum = 0.0; n_low = 0; loss_sum = 0.0; batches = 0
    for imgs, sides, targets, masks in loader:
        imgs, sides, targets, masks = imgs.to(device), sides.to(device), targets.to(device), masks.to(device)
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            pred = model(imgs, sides)
        pred = pred.float()
        loss_sum += masked_huber(pred, targets, masks).item(); batches += 1
        err = (pred - targets).abs() * masks
        abs_sum += err.sum().item(); n += int(masks.sum().item())
        low = masks * (targets < LOW_THRESHOLD)
        low_sum += ((pred - targets).abs() * low).sum().item(); n_low += int(low.sum().item())
    return {"loss": loss_sum / max(batches, 1), "mae_points": SCALE * abs_sum / max(n, 1),
            "mae_low_points": SCALE * low_sum / max(n_low, 1) if n_low else float("nan"), "n": n, "n_low": n_low}


def run_epoch(model, loader, optimizer, scaler, scheduler, device) -> float:
    model.train(); total = 0.0; batches = 0
    for imgs, sides, targets, masks in loader:
        imgs, sides, targets, masks = imgs.to(device), sides.to(device), targets.to(device), masks.to(device)
        optimizer.zero_grad(set_to_none=True)
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            pred = model(imgs, sides)
        loss = masked_huber(pred.float(), targets, masks)
        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optimizer); scaler.update(); scheduler.step()
        total += loss.item(); batches += 1
    return total / max(batches, 1)


def main(argv=None) -> Path:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    torch.manual_seed(args.seed)
    device = torch.device(args.device)
    spec = TASKS[args.task]

    train_df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, "train", args.limit_cards, args.seed)
    val_df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, "val", args.val_limit_cards, args.seed)
    train_df, train_dropped = filter_cached(train_df, cfg.cache_dir)
    val_df, val_dropped = filter_cached(val_df, cfg.cache_dir)
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
        w = csv.writer(f); w.writerow(LOG_COLUMNS)
        for epoch in range(1, args.epochs + 1):
            t0 = time.time()
            train_loss = run_epoch(model, train_loader, optimizer, scaler, scheduler, device)
            val = evaluate_loader(model, val_loader, device)
            secs = time.time() - t0
            w.writerow([epoch, f"{train_loss:.5f}", f"{val['loss']:.5f}", f"{val['mae_points']:.2f}",
                        f"{val['mae_low_points']:.2f}", f"{scheduler.get_last_lr()[0]:.2e}", f"{secs:.1f}"]); f.flush()
            print(f"epoch {epoch}/{args.epochs} train {train_loss:.4f} val {val['loss']:.4f} "
                  f"MAE {val['mae_points']:.1f} pts (low<900: {val['mae_low_points']:.1f} on n={val['n_low']}) {secs:.0f}s")
            state = {"model": model.state_dict(), "task": args.task, "backbone": args.backbone,
                     "n_out": len(spec["targets"]), "epoch": epoch, "val_mae": val["mae_points"]}
            torch.save(state, run_dir / "last.pt")
            if val["mae_points"] < best:
                best = val["mae_points"]; torch.save(state, run_dir / "best.pt")
    print(f"best val MAE {best:.2f} points; artifacts in {run_dir}")
    if device.type == "cuda":
        print(f"peak GPU memory: {torch.cuda.max_memory_allocated()/2**30:.2f} GiB")
    return run_dir


if __name__ == "__main__":
    main()
