"""Evaluate a trained card segmentation checkpoint on held-out synthetic samples and (if present)
the app's real-photo validation folder (plan 2026-09-21-card-model)."""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import torch
from torch.utils.data import DataLoader

from .card_backgrounds import RealPool, report_data_path
from .card_data import RealCardVal, SyntheticVal, collate_cards, list_cutouts
from .card_metrics import evaluate_batch
from .card_model import CardSegNet
from .config import load_config

# Package-root-relative, not cwd-relative (final review 2026-09-21, finding 2) -- see
# train_card.DEFAULT_BACKGROUNDS.
DEFAULT_BACKGROUNDS = Path(__file__).resolve().parents[1] / "data" / "backgrounds"
DEFAULT_REAL_VAL = Path(__file__).resolve().parents[1] / "data" / "card-val"

SYNTH_COLUMNS = ["index", "iou", "corner_err_pct", "failure", "reason", "gated"]
REAL_COLUMNS = ["path", "iou", "corner_err_pct", "failure", "reason", "gated"]

# Acceptance thresholds (plan 2026-09-21-card-model, Global Constraints).
ACCEPT_MIN_N = 100
ACCEPT_MIN_IOU = 0.97
ACCEPT_MAX_CORNER_MEAN = 0.8
ACCEPT_MAX_CORNER_P95 = 2.0
ACCEPT_MAX_FAIL_RATE = 0.02
PROVISIONAL_MIN_SYNTH_IOU = 0.98


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="evaluate_card")
    p.add_argument("--config", default="config.toml")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--real", default=str(DEFAULT_REAL_VAL))
    p.add_argument("--synthetic-n", type=int, default=2000)
    p.add_argument("--seed", type=int, default=12345)
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--backgrounds", default=str(DEFAULT_BACKGROUNDS))
    p.add_argument("--input-size", type=int, default=None,
                   help="defaults to the checkpoint's own input_size")
    p.add_argument("--canvas", type=int, default=None, help="defaults to 2x --input-size")
    return p


@torch.no_grad()
def _run_eval(model: torch.nn.Module, loader: DataLoader, device: torch.device) -> list[dict]:
    model.eval()
    rows: list[dict] = []
    for imgs, masks, metas in loader:
        imgs_d = imgs.to(device)
        with torch.autocast(device_type=device.type, enabled=(device.type == "cuda")):
            logits = model(imgs_d)
        logits = logits.float().cpu()
        for r, meta in zip(evaluate_batch(logits, masks, metas), metas):
            rows.append({"meta": meta, **r})
    return rows


def _gated_fail_rate(df: pd.DataFrame) -> tuple[float, int]:
    """`fail_rate` over gated rows only (final review 2026-09-21, finding 3), plus `n_gated`."""
    gated = df[df["gated"]]
    n_gated = len(gated)
    fail_rate = float(gated["failure"].mean()) if n_gated else float("nan")
    return fail_rate, n_gated


def _summary_line(prefix: str, n: int, iou_mean: float, corner_mean: float, corner_p95: float,
                  fail_rate: float, n_gated: int, extra: str = "") -> str:
    return (f"{prefix}: n={n} iou={iou_mean:.4f} corner_err_mean={corner_mean:.4f} "
           f"corner_err_p95={corner_p95:.4f} fail_rate={fail_rate:.4f} n_gated={n_gated}{extra}")


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    device = torch.device(args.device)

    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    input_size = args.input_size if args.input_size is not None else int(ckpt["input_size"])
    canvas = args.canvas if args.canvas is not None else 2 * input_size
    ckpt_dir = Path(args.checkpoint).parent

    model = CardSegNet(encoder=ckpt["encoder"], pretrained=False).to(device)
    model.load_state_dict(ckpt["model"])
    model.eval()

    # --- synthetic ---
    val_paths = list_cutouts(cfg.cache_dir, cfg.splits_path, "val")
    bg_dir = Path(args.backgrounds)
    bg_pool = RealPool(bg_dir)
    report_data_path("backgrounds", bg_dir, len(bg_pool), "files")
    synth_ds = SyntheticVal(val_paths, bg_pool, n=args.synthetic_n, seed=args.seed,
                            canvas=canvas, out=input_size)
    synth_loader = DataLoader(synth_ds, batch_size=args.batch_size, shuffle=False,
                              num_workers=args.workers, collate_fn=collate_cards,
                              persistent_workers=False)
    synth_rows = _run_eval(model, synth_loader, device)
    synth_df = pd.DataFrame([
        {"index": i, "iou": r["iou"], "corner_err_pct": r["corner_err_pct"],
         "failure": r["failure"], "reason": r["reason"], "gated": r["gated"]}
        for i, r in enumerate(synth_rows)
    ], columns=SYNTH_COLUMNS)
    synth_df.to_csv(ckpt_dir / "eval_synth.csv", index=False)

    synth_n = len(synth_df)
    synth_iou_mean = float(synth_df["iou"].mean()) if synth_n else float("nan")
    synth_corner = synth_df["corner_err_pct"].dropna()
    synth_corner_mean = float(synth_corner.mean()) if len(synth_corner) else float("nan")
    synth_corner_p95 = float(synth_corner.quantile(0.95)) if len(synth_corner) else float("nan")
    synth_fail_rate, synth_n_gated = _gated_fail_rate(synth_df)
    print(_summary_line("synthetic", synth_n, synth_iou_mean, synth_corner_mean, synth_corner_p95,
                        synth_fail_rate, synth_n_gated))

    # --- real ---
    real_folder = Path(args.real)
    real_ds = RealCardVal(real_folder, out=input_size)
    report_data_path("real-val", real_folder, len(real_ds), "sides")
    real_summary = None
    if real_folder.is_dir() and len(real_ds) >= 1:
        real_loader = DataLoader(real_ds, batch_size=args.batch_size, shuffle=False,
                                 num_workers=args.workers, collate_fn=collate_cards,
                                 persistent_workers=False)
        real_rows = _run_eval(model, real_loader, device)
        real_df = pd.DataFrame([
            {"path": r["meta"]["path"], "iou": r["iou"], "corner_err_pct": r["corner_err_pct"],
             "failure": r["failure"], "reason": r["reason"], "gated": r["gated"]}
            for r in real_rows
        ], columns=REAL_COLUMNS)
        real_df.to_csv(ckpt_dir / "eval_real.csv", index=False)

        real_n = len(real_df)
        real_iou_mean = float(real_df["iou"].mean()) if real_n else float("nan")
        real_corner = real_df["corner_err_pct"].dropna()
        real_corner_mean = float(real_corner.mean()) if len(real_corner) else float("nan")
        real_corner_p95 = float(real_corner.quantile(0.95)) if len(real_corner) else float("nan")
        real_fail_rate, real_n_gated = _gated_fail_rate(real_df)
        print(_summary_line("real", real_n, real_iou_mean, real_corner_mean, real_corner_p95,
                            real_fail_rate, real_n_gated,
                            extra=f" skipped_rotation={real_ds.skipped_rotation}"))
        real_summary = {"n": real_n, "iou": real_iou_mean, "corner_err_mean": real_corner_mean,
                        "corner_err_p95": real_corner_p95, "fail_rate": real_fail_rate,
                        "n_gated": real_n_gated}

    # --- verdict ---
    if (real_summary is not None and real_summary["n"] >= ACCEPT_MIN_N
            and real_summary["iou"] >= ACCEPT_MIN_IOU
            and real_summary["corner_err_mean"] <= ACCEPT_MAX_CORNER_MEAN
            and real_summary["corner_err_p95"] <= ACCEPT_MAX_CORNER_P95
            and real_summary["fail_rate"] <= ACCEPT_MAX_FAIL_RATE):
        verdict = "accept"
    elif (real_summary is None or real_summary["n"] < ACCEPT_MIN_N) and synth_iou_mean >= PROVISIONAL_MIN_SYNTH_IOU:
        verdict = "provisional"
    else:
        verdict = "reject"
    print(f"verdict: {verdict}")
    return 0


if __name__ == "__main__":
    main()
