"""Train the surface defect detector on cached tiles (plan 2026-09-16-surface-detector)."""
from __future__ import annotations

import argparse
import csv
import json
import math
import time
from pathlib import Path

import pandas as pd
import torch
from torch.utils.data import DataLoader, WeightedRandomSampler

from .config import load_config
from .det_metrics import evaluate_detections, filter_view_preds
from .detector import build_detector, save_checkpoint
from .surface_tables import SURFACE_CLASSES
from .tile_data import TileDataset, collate_det

LOG_COLUMNS = ["epoch", "train_loss", "val_loss_proxy", "lr", "seconds", "map50", "precision", "recall"] + \
              [f"ap50_{c}" for c in SURFACE_CLASSES]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="train_surface")
    p.add_argument("--config", default="config.toml"); p.add_argument("--run-name", required=True)
    p.add_argument("--epochs", type=int, default=8); p.add_argument("--batch-size", type=int, default=8)
    p.add_argument("--lr", type=float, default=0.01); p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--warmup-iters", type=int, default=500); p.add_argument("--workers", type=int, default=8)
    p.add_argument("--limit-tiles", type=int); p.add_argument("--val-limit-tiles", type=int)
    p.add_argument("--no-pretrained", action="store_true"); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--min-size", type=int, help="override the detector's internal resize (tests only)")
    p.add_argument("--init", help="start from this checkpoint's weights (fine-tuning)")
    p.add_argument("--views", default="sfx,rgb", help="comma-separated views to train and validate on")
    p.add_argument("--neg-grades", default="",
                   help="comma-separated grade labels whose box-free tiles are kept as negatives (train only); "
                        "empty = keep all negatives")
    p.add_argument("--balance", action="store_true",
                   help="class-balanced tile sampling (WeightedRandomSampler over tile_weights)")
    p.add_argument("--classes", default="",
                   help="comma-separated SURFACE_CLASSES names to detect (e.g. CREASE,SCRATCH); empty = all")
    return p


def _index(cache_dir: Path, split: str, limit: int | None, seed: int, views: str = "sfx,rgb",
           neg_grades: str = "", classes: str = "") -> pd.DataFrame:
    """Tile index for a split, filtered to `views`. `neg_grades` (comma-separated grade labels) keeps
    box-free tiles only from cards of those grades: TAG marks a subset of the defects on a card, so a
    'clean' side of a low-grade card often carries unmarked defects that would be taught as background;
    sides of 9+ cards are genuinely clean. `classes` (comma-separated SURFACE_CLASSES names) restricts
    the detector to those classes: boxes of other classes are removed, and a tile whose boxes were all
    removed is dropped rather than kept as a negative (it still contains an unmarked defect of a class
    the model is not asked to learn). Label ids keep their SURFACE_CLASSES numbering."""
    df = pd.read_parquet(Path(cache_dir) / "tiles" / f"{split}.parquet")
    df = df[df.view.isin([v.strip() for v in views.split(",")])]
    if classes:
        keep_labels = {SURFACE_CLASSES.index(c.strip()) + 1 for c in classes.split(",")}
        kept = [[b for b in json.loads(s) if int(b[0]) in keep_labels] for s in df.boxes]
        had = df.n_boxes.to_numpy() > 0
        df = df.assign(boxes=[json.dumps(b) for b in kept], n_boxes=[len(b) for b in kept])
        df = df[~(had & (df.n_boxes == 0))]
    if neg_grades:
        keep_grades = {g.strip() for g in neg_grades.split(",")}
        df = df[(df.n_boxes > 0) | df.grade_label.isin(keep_grades)]
    if limit is not None and limit < len(df):
        df = df.sample(n=limit, random_state=seed).sort_index()
    return df.reset_index(drop=True)


def tile_weights(index: pd.DataFrame) -> torch.Tensor:
    """Sampling weight per tile for class balancing: a tile with boxes is weighted by the inverse square
    root of the frequency of its rarest class (normalized so the mean positive weight is 1); box-free
    tiles get weight 1. Creases are ~37% of boxes and pits ~6%, so a pit tile is drawn ~2.5x as often."""
    labels_per_tile = [[int(b[0]) for b in json.loads(s)] for s in index.boxes]
    counts: dict[int, int] = {}
    for labs in labels_per_tile:
        for l in labs:
            counts[l] = counts.get(l, 0) + 1
    raw = [min(1.0 / math.sqrt(counts[l]) for l in labs) if labs else None for labs in labels_per_tile]
    pos = [r for r in raw if r is not None]
    mean_pos = (sum(pos) / len(pos)) if pos else 1.0
    return torch.tensor([1.0 if r is None else r / mean_pos for r in raw], dtype=torch.double)


def _to(device, imgs, tgts):
    return [i.to(device) for i in imgs], [{k: v.to(device) for k, v in t.items()} for t in tgts]


@torch.no_grad()
def evaluate_loader(model, loader, device, views: list[str] | None = None) -> dict:
    """`views[i]` is the view of the i-th tile in loader order (shuffle=False); predictions excluded from
    that view's ground truth (rgb DENT) are dropped before scoring, matching `evaluate_surface`."""
    model.eval()
    preds, gts = [], []
    for imgs, tgts in loader:
        imgs = [i.to(device) for i in imgs]
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            out = model(imgs)
        batch = [{k: v.float().cpu() if k != "labels" else v.cpu() for k, v in o.items()} for o in out]
        if views is not None:
            batch = [filter_view_preds(p, views[len(preds) + j]) for j, p in enumerate(batch)]
        preds += batch
        gts += [{"boxes": t["boxes"], "labels": t["labels"]} for t in tgts]
    return evaluate_detections(preds, gts, n_classes=len(SURFACE_CLASSES))


def _lr_at(step: int, total: int, warmup: int, base: float) -> float:
    if step < warmup:
        return base * (step + 1) / warmup
    t = (step - warmup) / max(1, total - warmup)
    return base * 0.5 * (1.0 + math.cos(math.pi * min(1.0, t)))


def main(argv=None) -> Path:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    torch.manual_seed(args.seed)
    device = torch.device(args.device)
    train_idx = _index(cfg.cache_dir, "train", args.limit_tiles, args.seed, args.views, args.neg_grades, args.classes)
    val_idx = _index(cfg.cache_dir, "val", args.val_limit_tiles, args.seed, args.views, classes=args.classes)
    sampler = None
    if args.balance:
        g = torch.Generator(); g.manual_seed(args.seed)
        sampler = WeightedRandomSampler(tile_weights(train_idx), num_samples=len(train_idx), replacement=True,
                                        generator=g)
    train_loader = DataLoader(TileDataset(train_idx, cfg.cache_dir, True), batch_size=args.batch_size,
                              shuffle=(sampler is None), sampler=sampler,
                              num_workers=args.workers, collate_fn=collate_det, pin_memory=(device.type == "cuda"),
                              persistent_workers=(args.workers > 0), drop_last=True)
    val_loader = DataLoader(TileDataset(val_idx, cfg.cache_dir, False), batch_size=args.batch_size, shuffle=False,
                            num_workers=args.workers, collate_fn=collate_det, persistent_workers=(args.workers > 0))
    # --init loads a full checkpoint state dict one line below, so COCO weights would be downloaded
    # only to be overwritten; skip that download entirely when fine-tuning from a checkpoint.
    pretrained = not args.no_pretrained and not args.init
    model = build_detector(num_classes=len(SURFACE_CLASSES) + 1, pretrained=pretrained).to(device)
    if args.init:
        model.load_state_dict(torch.load(args.init, map_location="cpu", weights_only=False)["model"])
        # Building without pretrained weights leaves every backbone layer trainable (torchvision's
        # trainable_backbone_layers=5); a run from COCO weights trains only layer2-4 (=3). Freeze the
        # stem and layer1 so a fine-tune from a checkpoint uses the same regime as the run it starts from.
        for name, p in model.backbone.body.named_parameters():
            if not name.startswith(("layer2", "layer3", "layer4")):
                p.requires_grad_(False)
    if args.min_size:
        model.transform.min_size = (args.min_size,); model.transform.max_size = args.min_size
    params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.SGD(params, lr=args.lr, momentum=0.9, weight_decay=args.weight_decay)
    scaler = torch.amp.GradScaler("cuda", enabled=(device.type == "cuda"))
    total_steps = max(1, args.epochs * len(train_loader))

    run_dir = Path(cfg.runs_dir) / "surface" / args.run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "args.json").write_text(json.dumps(vars(args), indent=1), encoding="utf-8")
    print(f"surface: {len(train_idx)} train tiles ({int((train_idx.n_boxes > 0).sum())} positive; "
          f"{train_idx.view.value_counts().to_dict()}) / {len(val_idx)} val tiles; device {device}")

    best, step = -1.0, 0
    with open(run_dir / "log.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(LOG_COLUMNS)
        for epoch in range(1, args.epochs + 1):
            t0 = time.time(); model.train(); total = 0.0; n = 0
            for imgs, tgts in train_loader:
                for g in optimizer.param_groups:
                    g["lr"] = _lr_at(step, total_steps, args.warmup_iters, args.lr)
                imgs, tgts = _to(device, imgs, tgts)
                with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
                    losses = model(imgs, tgts)
                loss = sum(losses.values())
                optimizer.zero_grad(set_to_none=True)
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(params, 10.0)
                scaler.step(optimizer); scaler.update()
                total += float(loss.item()); n += 1; step += 1
            train_loss = total / max(n, 1)
            m = evaluate_loader(model, val_loader, device, val_idx.view.tolist())
            secs = time.time() - t0
            row = [epoch, f"{train_loss:.5f}", f"{1.0 - m['map50']:.5f}" if not math.isnan(m["map50"]) else "nan",
                   f"{optimizer.param_groups[0]['lr']:.2e}", f"{secs:.1f}", f"{m['map50']:.4f}",
                   f"{m['precision']:.4f}", f"{m['recall']:.4f}"] + [f"{m['ap50'][i + 1]:.4f}" for i in range(len(SURFACE_CLASSES))]
            w.writerow(row); f.flush()
            print(f"epoch {epoch}/{args.epochs} train {train_loss:.4f} map50 {m['map50']:.4f} "
                  f"P {m['precision']:.3f} R {m['recall']:.3f} {secs:.0f}s")
            save_checkpoint(model, run_dir / "last.pt", SURFACE_CLASSES, epoch, m["map50"])
            score = -1.0 if math.isnan(m["map50"]) else m["map50"]
            if score > best or not (run_dir / "best.pt").exists():
                best = max(best, score); save_checkpoint(model, run_dir / "best.pt", SURFACE_CLASSES, epoch, m["map50"])
    print(f"best map50 {best:.4f}; artifacts in {run_dir}")
    if device.type == "cuda":
        print(f"peak GPU memory: {torch.cuda.max_memory_allocated()/2**30:.2f} GiB")
    return run_dir


if __name__ == "__main__":
    main()
