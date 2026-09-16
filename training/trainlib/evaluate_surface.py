"""Per-grade / per-class tile evaluation and merged full-side evaluation for the surface detector."""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image
from torch.utils.data import DataLoader
from torchvision.ops import batched_nms

from .cache import cache_path
from .config import load_config
from .det_metrics import evaluate_detections, match
from .detector import load_detector
from .surface_tables import RGB_EXCLUDED_LABELS, SURFACE_CLASSES, VIEWS, boxes_for_view, load_surface_split
from .tile_data import TileDataset, collate_det
from .tiles import TILE, tile_grid


def filter_view_preds(pred: dict, view: str) -> dict:
    """Drop predictions whose label is excluded from `view`'s ground truth (rgb has no DENT labels:
    the detector has no view input and cannot know it should not emit them on a flat-light image)."""
    if view != "rgb":
        return pred
    keep = ~torch.isin(pred["labels"], torch.tensor(sorted(RGB_EXCLUDED_LABELS), dtype=pred["labels"].dtype))
    return {"boxes": pred["boxes"][keep], "labels": pred["labels"][keep], "scores": pred["scores"][keep]}


def merge_tiles(preds_per_tile: list[tuple[int, int, dict]], iou: float = 0.5) -> dict:
    """Translate per-tile detections to image coordinates and apply per-class NMS."""
    boxes, labels, scores = [], [], []
    for x0, y0, p in preds_per_tile:
        if len(p["boxes"]) == 0:
            continue
        boxes.append(p["boxes"] + torch.tensor([x0, y0, x0, y0], dtype=p["boxes"].dtype))
        labels.append(p["labels"]); scores.append(p["scores"])
    if not boxes:
        return {"boxes": torch.zeros(0, 4), "labels": torch.zeros(0, dtype=torch.int64), "scores": torch.zeros(0)}
    b, l, s = torch.cat(boxes), torch.cat(labels), torch.cat(scores)
    keep = batched_nms(b, s, l, iou)
    return {"boxes": b[keep], "labels": l[keep], "scores": s[keep]}


@torch.no_grad()
def _predict(model, imgs, device):
    with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
        out = model([i.to(device) for i in imgs])
    return [{"boxes": o["boxes"].float().cpu(), "labels": o["labels"].cpu(), "scores": o["scores"].float().cpu()} for o in out]


def _fmt(v: float) -> str:
    return "nan" if (isinstance(v, float) and math.isnan(v)) else f"{v:.4f}"


def tile_eval(model, index: pd.DataFrame, cache_dir: Path, device, batch_size: int, workers: int, score_thr: float):
    assert index.index.equals(pd.RangeIndex(len(index))), \
        "index must carry a RangeIndex: g.index is used positionally into preds/gts below"
    loader = DataLoader(TileDataset(index, cache_dir, False), batch_size=batch_size, shuffle=False,
                        num_workers=workers, collate_fn=collate_det)
    views = index["view"].tolist()
    preds, gts = [], []
    model.eval()
    for imgs, tgts in loader:
        batch = _predict(model, imgs, device)
        preds += [filter_view_preds(p, views[len(preds) + j]) for j, p in enumerate(batch)]
        gts += tgts
    rows = []
    for grade, g in index.groupby("grade_label", sort=True):
        ii = g.index.tolist()
        m = evaluate_detections([preds[i] for i in ii], [gts[i] for i in ii], len(SURFACE_CLASSES), score_thr=score_thr)
        rows.append({"grade": grade, "n_tiles": len(ii), "n_gt": sum(m["n_gt"].values()), "map50": m["map50"],
                     "precision": m["precision"], "recall": m["recall"]})
    m = evaluate_detections(preds, gts, len(SURFACE_CLASSES), score_thr=score_thr)
    rows.append({"grade": "ALL", "n_tiles": len(index), "n_gt": sum(m["n_gt"].values()), "map50": m["map50"],
                 "precision": m["precision"], "recall": m["recall"]})
    view_rows = []
    for view, g in index.groupby("view", sort=True):
        ii = g.index.tolist()
        mv = evaluate_detections([preds[i] for i in ii], [gts[i] for i in ii], len(SURFACE_CLASSES), score_thr=score_thr)
        view_rows.append({"view": view, "n_tiles": len(ii), "n_gt": sum(mv["n_gt"].values()), "map50": mv["map50"],
                          "precision": mv["precision"], "recall": mv["recall"]})
    classes = [{"class": c, "n_gt": m["n_gt"][i + 1], "ap50": m["ap50"][i + 1],
                "precision": m["precision_by_class"][i + 1], "recall": m["recall_by_class"][i + 1]}
               for i, c in enumerate(SURFACE_CLASSES)]
    return pd.DataFrame(rows), pd.DataFrame(view_rows), pd.DataFrame(classes)


def _fp_per_side(p: dict, gb: torch.Tensor, gl: torch.Tensor, score_thr: float) -> int:
    """Class-aware false positives above score_thr: a box predicted on a real defect but with the
    wrong class is counted as a false positive, not a match."""
    keep = p["scores"] >= score_thr
    pb, pl, ps = p["boxes"][keep], p["labels"][keep], p["scores"][keep]
    fp = 0
    for c in sorted(set(pl.tolist())):
        cm, gm = pl == c, gl == c
        fp += sum(1 for f in match(pb[cm], ps[cm], gb[gm]) if not f)
    return fp


def full_side_eval(model, cfg, split: str, n_cards: int, device, score_thr: float, allow_test: bool,
                   seed: int = 42, views: tuple[str, ...] = VIEWS) -> pd.DataFrame:
    sides, boxes = load_surface_split(cfg.dataset_dir, cfg.splits_path, split, allow_test=allow_test)
    sides = sides[sides.view.isin(views)]
    # a seeded random sample of n_cards cards whose images are all cached, so a partial cache (local smoke) still evaluates
    cached = sides[sides.image_key.map(lambda k: cache_path(cfg.cache_dir, k).exists())]
    full = cached.groupby("cert").size()
    certs_all = full[full == sides.groupby("cert").size().reindex(full.index)].index.tolist()
    rng = np.random.default_rng(seed)
    n = min(n_cards, len(certs_all))
    certs = sorted(rng.choice(certs_all, size=n, replace=False).tolist()) if n else []
    sides = sides[sides.cert.isin(certs)]
    by_view = {v: {k: g for k, g in boxes_for_view(boxes, v).groupby(["cert", "side"])} for v in views}
    preds, gts, fps, side_views = [], [], [], []
    model.eval()
    for r in sides.itertuples():
        path = cache_path(cfg.cache_dir, r.image_key)
        if not path.exists():
            continue
        with Image.open(path) as im:
            img = im.convert("RGB")
        w, h = img.size
        per_tile = []
        for x0, y0 in tile_grid(w, h):
            crop = img.crop((x0, y0, x0 + TILE, y0 + TILE))
            t = torch.from_numpy(np.asarray(crop, dtype="float32") / 255.0).permute(2, 0, 1)
            per_tile.append((x0, y0, _predict(model, [t], device)[0]))
        p = filter_view_preds(merge_tiles(per_tile), r.view)
        g = by_view[r.view].get((r.cert, r.side))
        gb = torch.tensor([[b.x * w, b.y * h, (b.x + b.w) * w, (b.y + b.h) * h] for b in g.itertuples()],
                          dtype=torch.float32).reshape(-1, 4) if g is not None else torch.zeros(0, 4)
        gl = torch.tensor([int(b.label) for b in g.itertuples()], dtype=torch.int64) if g is not None else torch.zeros(0, dtype=torch.int64)
        preds.append(p); gts.append({"boxes": gb, "labels": gl}); side_views.append(r.view)
        fps.append(_fp_per_side(p, gb, gl, score_thr))
    rows = []
    for view in sorted(set(side_views)) + ["ALL"]:
        ii = [i for i, v in enumerate(side_views) if view == "ALL" or v == view]
        m = evaluate_detections([preds[i] for i in ii], [gts[i] for i in ii], len(SURFACE_CLASSES), score_thr=score_thr)
        n = len(ii)
        rows.append({"view": view, "n_sides": n, "n_gt": sum(m["n_gt"].values()), "map50": m["map50"],
                     "precision": m["precision"], "recall": m["recall"],
                     "fp_per_side": (sum(fps[i] for i in ii) / n if n else float("nan"))})
    return pd.DataFrame(rows)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="evaluate_surface")
    p.add_argument("--config", default="config.toml"); p.add_argument("--checkpoint", required=True)
    p.add_argument("--split", choices=["val", "test"], default="val"); p.add_argument("--final-eval", action="store_true")
    p.add_argument("--batch-size", type=int, default=8); p.add_argument("--workers", type=int, default=8)
    p.add_argument("--limit-tiles", type=int); p.add_argument("--full-cards", type=int)
    p.add_argument("--score-thr", type=float, default=0.5); p.add_argument("--seed", type=int, default=42)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu"); p.add_argument("--min-size", type=int)
    p.add_argument("--views", default="sfx,rgb", help="comma-separated views to evaluate on")
    args = p.parse_args(argv)
    if args.split == "test" and not args.final_eval:
        raise SystemExit("the test split is read only with --final-eval, once per accepted checkpoint")
    views = tuple(v.strip() for v in args.views.split(","))
    cfg = load_config(args.config)
    device = torch.device(args.device)
    model, ckpt = load_detector(args.checkpoint, device)
    if args.min_size:
        model.transform.min_size = (args.min_size,); model.transform.max_size = args.min_size
    index = pd.read_parquet(Path(cfg.cache_dir) / "tiles" / f"{args.split}.parquet").reset_index(drop=True)
    index = index[index.view.isin(views)].reset_index(drop=True)
    if args.limit_tiles is not None and args.limit_tiles < len(index):
        index = index.sample(n=args.limit_tiles, random_state=args.seed).sort_index().reset_index(drop=True)
    grade_df, view_df, class_df = tile_eval(model, index, cfg.cache_dir, device, args.batch_size, args.workers, args.score_thr)
    out_dir = Path(args.checkpoint).parent
    grade_df.to_csv(out_dir / f"eval_{args.split}.csv", index=False)
    view_df.to_csv(out_dir / f"eval_{args.split}_views.csv", index=False)
    class_df.to_csv(out_dir / f"eval_{args.split}_classes.csv", index=False)
    print(f"checkpoint epoch {ckpt['epoch']} (map50 at save {ckpt['map50']:.4f}); split {args.split}; {len(index)} tiles")
    print(grade_df.to_string(index=False, float_format=lambda v: _fmt(v)))
    print(view_df.to_string(index=False, float_format=lambda v: _fmt(v)))
    print(class_df.to_string(index=False, float_format=lambda v: _fmt(v)))
    if args.full_cards:
        fs = full_side_eval(model, cfg, args.split, args.full_cards, device, args.score_thr, allow_test=args.final_eval,
                            seed=args.seed, views=views)
        fs.to_csv(out_dir / f"eval_{args.split}_fullside.csv", index=False)
        print("full-side:"); print(fs.to_string(index=False, float_format=lambda v: _fmt(v)))


if __name__ == "__main__":
    main()
