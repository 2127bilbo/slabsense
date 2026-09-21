"""Train the card segmentation model on synthetic composites (plan 2026-09-21-card-model)."""
from __future__ import annotations

import argparse
import csv
import json
import math
import time
from pathlib import Path

import torch
from torch.optim.swa_utils import AveragedModel, get_ema_multi_avg_fn
from torch.utils.data import DataLoader

from .card_backgrounds import RealPool, report_data_path
from .card_data import SyntheticCards, SyntheticVal, collate_cards, list_cutouts
from .card_metrics import evaluate_batch
from .card_model import CardSegNet, bce_dice, count_params
from .config import load_config

LOG_COLUMNS = ["epoch", "train_loss", "val_loss", "lr", "seconds", "iou", "corner_err_pct", "fail_rate"]

# Package-root-relative, not cwd-relative: every documented command runs this from `training/`,
# where a plain "training/data/backgrounds" default would resolve to training/training/data/...
# and never be found (final review 2026-09-21, finding 2).
DEFAULT_BACKGROUNDS = Path(__file__).resolve().parents[1] / "data" / "backgrounds"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="train_card")
    p.add_argument("--config", default="config.toml")
    p.add_argument("--run-name", required=True)
    p.add_argument("--epochs", type=int, default=12)
    p.add_argument("--samples-per-epoch", type=int, default=60000)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--workers", type=int, default=16)
    p.add_argument("--val-workers", type=int, default=8,
                  help="SyntheticVal loader workers; kept low (default 8) independent of --workers "
                       "-- persistent val workers add to /dev/shm alongside a full set of train "
                       "workers (HANDOFF-rented-gpu.md Step 12.3)")
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--warmup-iters", type=int, default=500)
    p.add_argument("--ema-decay", type=float, default=0.999)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--cutouts-limit", type=int, help="cap the number of cutout files loaded per split (dev/tests)")
    p.add_argument("--backgrounds", default=str(DEFAULT_BACKGROUNDS))
    p.add_argument("--no-pretrained", action="store_true")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--val-n", type=int, default=2000)
    p.add_argument("--canvas", type=int, default=None,
                  help="compositor canvas size; defaults to 2x --input-size (tests only need to override "
                       "--input-size, which scales canvas/out proportionally)")
    p.add_argument("--input-size", type=int, default=512, help="model input / compositor output size")
    return p


def _lr_at(step: int, total: int, warmup: int, base: float) -> float:
    if step < warmup:
        return base * (step + 1) / warmup
    t = (step - warmup) / max(1, total - warmup)
    return base * 0.5 * (1.0 + math.cos(math.pi * min(1.0, t)))


def main(argv=None) -> Path:
    args = build_parser().parse_args(argv)
    if args.canvas is None:
        args.canvas = 2 * args.input_size  # keeps the production 1024:512 = 2:1 canvas:out ratio
    cfg = load_config(args.config)
    torch.manual_seed(args.seed)
    device = torch.device(args.device)

    train_paths = list_cutouts(cfg.cache_dir, cfg.splits_path, "train")
    val_paths = list_cutouts(cfg.cache_dir, cfg.splits_path, "val")
    if args.cutouts_limit is not None:
        train_paths = train_paths[:args.cutouts_limit]
        val_paths = val_paths[:args.cutouts_limit]
    if not train_paths:
        raise ValueError("no train-split cutouts found under <cache_dir>/cutouts")
    if not val_paths:
        raise ValueError("no val-split cutouts found under <cache_dir>/cutouts")

    bg_dir = Path(args.backgrounds)
    bg_pool = RealPool(bg_dir)
    report_data_path("backgrounds", bg_dir, len(bg_pool), "files")
    canvas, out = args.canvas, args.input_size

    train_ds = SyntheticCards(train_paths, bg_pool, args.samples_per_epoch, base_seed=args.seed,
                              canvas=canvas, out=out)
    val_ds = SyntheticVal(val_paths, bg_pool, n=args.val_n, seed=12345, canvas=canvas, out=out)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=args.val_workers,
                            collate_fn=collate_cards, persistent_workers=(args.val_workers > 0))

    model = CardSegNet(pretrained=not args.no_pretrained).to(device)
    ema = AveragedModel(model, multi_avg_fn=get_ema_multi_avg_fn(args.ema_decay), use_buffers=True)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scaler = torch.amp.GradScaler("cuda", enabled=(device.type == "cuda"))

    steps_per_epoch = max(1, args.samples_per_epoch // args.batch_size)
    total_steps = max(1, args.epochs * steps_per_epoch)

    run_dir = Path(cfg.runs_dir) / "card" / args.run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "args.json").write_text(json.dumps(vars(args), indent=1), encoding="utf-8")
    print(f"card: {len(train_paths)} train cutouts / {len(val_paths)} val cutouts; "
          f"params {count_params(model):,}; device {device}")

    best_iou = float("-inf")
    step = 0
    last_lr = args.lr
    with open(run_dir / "log.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(LOG_COLUMNS)
        for epoch in range(1, args.epochs + 1):
            t0 = time.time()
            train_ds.set_epoch(epoch - 1)
            # IterableDataset + persistent_workers can't pick up the new epoch seed on later
            # epochs, so the loader is rebuilt fresh every epoch instead.
            train_loader = DataLoader(train_ds, batch_size=args.batch_size, num_workers=args.workers,
                                      collate_fn=collate_cards, persistent_workers=False,
                                      pin_memory=(device.type == "cuda"))

            model.train()
            train_total = 0.0
            train_n = 0
            for imgs, masks, _metas in train_loader:
                imgs, masks = imgs.to(device), masks.to(device)
                last_lr = _lr_at(step, total_steps, args.warmup_iters, args.lr)
                for g in optimizer.param_groups:
                    g["lr"] = last_lr
                optimizer.zero_grad(set_to_none=True)
                with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
                    logits = model(imgs)
                loss = bce_dice(logits.float(), masks)
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
                scaler.step(optimizer)
                scaler.update()
                ema.update_parameters(model)
                train_total += loss.item()
                train_n += 1
                step += 1
            train_loss = train_total / max(train_n, 1)

            eval_model = ema.module
            eval_model.eval()
            val_total = 0.0
            val_n = 0
            iou_total = 0.0
            iou_n = 0
            corner_err_total = 0.0
            corner_err_n = 0
            fail_n = 0
            gated_n = 0
            sample_n = 0
            with torch.no_grad():
                for imgs, masks, metas in val_loader:
                    imgs, masks = imgs.to(device), masks.to(device)
                    with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
                        logits = eval_model(imgs)
                    logits = logits.float()
                    val_total += bce_dice(logits, masks).item()
                    val_n += 1
                    for r in evaluate_batch(logits, masks, metas):
                        sample_n += 1
                        if not math.isnan(r["iou"]):
                            iou_total += r["iou"]
                            iou_n += 1
                        if not math.isnan(r["corner_err_pct"]):
                            corner_err_total += r["corner_err_pct"]
                            corner_err_n += 1
                        if r["gated"]:
                            gated_n += 1
                            if r["failure"]:
                                fail_n += 1
            val_loss = val_total / max(val_n, 1)
            iou = iou_total / max(iou_n, 1)
            corner_err_pct = corner_err_total / corner_err_n if corner_err_n else float("nan")
            # fail_rate is over GATED samples only -- ones whose TRUE quad itself passes the app's
            # own is_failure gate (final review 2026-09-21, finding 3) -- not the full val set,
            # most of which the synthetic distribution's own aspect/perspective jitter would have
            # the app reject regardless of the model.
            fail_rate = fail_n / gated_n if gated_n else float("nan")
            secs = time.time() - t0

            row = [epoch, f"{train_loss:.5f}", f"{val_loss:.5f}", f"{last_lr:.2e}", f"{secs:.1f}",
                  f"{iou:.4f}", f"{corner_err_pct:.4f}", f"{fail_rate:.4f}"]
            w.writerow(row)
            f.flush()
            print(f"epoch {epoch}/{args.epochs} train {train_loss:.4f} val {val_loss:.4f} "
                  f"iou {iou:.4f} fail_rate {fail_rate:.4f} n_gated {gated_n}/{sample_n} {secs:.0f}s")

            ckpt = {"model": eval_model.state_dict(), "encoder": model.encoder_name, "epoch": epoch,
                   "iou": iou, "input_size": out}
            torch.save(ckpt, run_dir / "last.pt")
            if iou > best_iou:
                best_iou = iou
                torch.save(ckpt, run_dir / "best.pt")
    print(f"best iou {best_iou:.4f}; artifacts in {run_dir}")
    if device.type == "cuda":
        print(f"peak GPU memory: {torch.cuda.max_memory_allocated()/2**30:.2f} GiB")
    return run_dir


if __name__ == "__main__":
    main()
