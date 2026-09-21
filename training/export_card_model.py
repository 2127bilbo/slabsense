"""Export a trained CardSegNet checkpoint to ONNX (fp32 -> fp16 + int8) with contract + parity
sidecars (plan 2026-09-21-card-model, Task 6: Export). Mirrors `export_onnx.py`'s structure.

    .venv/Scripts/python.exe export_card_model.py --checkpoint weights/card/v1/best.pt --run-name v1

Writes to --out-dir (default weights/onnx/):
    card-<run>.fp32.onnx, card-<run>.fp16.onnx, card-<run>.int8.onnx   (gitignored, large)
    card-<run>.json          preprocessing + I/O contract for the app (tracked)
    card-<run>.parity.json   torch-vs-ONNX agreement and metrics on synthetic val samples (tracked)

Input: `image` float32 [N,3,S,S], NCHW, x/255 then ImageNet mean/std normalised, produced by
letterboxing the source photo (pad the short side to a square with the outer-8px-ring mean
colour, then resize to S). Output: `mask` [N,1,S,S] logits; sigmoid > 0.5 is card. Only the batch
axis `N` is dynamic.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch.utils.data import DataLoader

from trainlib.card_backgrounds import RealPool
from trainlib.card_data import SyntheticVal, collate_cards, list_cutouts
from trainlib.card_model import CardSegNet
from trainlib.config import load_config
from trainlib.data import MEAN, STD

FP16_BLOCK_DEFAULT = "LayerNormalization,GlobalAveragePool,Gemm,Div,Erf,Flatten,Concat,Resize,Sigmoid"
FP16_DISAGREEMENT_MAX = 0.005


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export_fp32(model: torch.nn.Module, input_size: int, out: Path) -> None:
    image = torch.zeros(1, 3, input_size, input_size)
    with warnings.catch_warnings():
        # torch 2.9 defaults `torch.onnx.export` to the new dynamo-based exporter and warns when
        # `dynamo=False` opts back into the legacy TorchScript-tracer path; `export_onnx.py`
        # (this script's model) uses that same legacy path deliberately (opset 17, dynamic batch
        # via `dynamic_axes`, which the dynamo exporter handles differently), so only this one
        # deprecation notice is silenced here -- the export itself is unaffected.
        warnings.filterwarnings("ignore", category=DeprecationWarning,
                                message=r".*legacy TorchScript-based ONNX export.*")
        warnings.filterwarnings("ignore", category=DeprecationWarning,
                                message=r".*The feature will be removed\. Please remove usage of this function.*")
        torch.onnx.export(
            model, (image,), str(out),
            input_names=["image"], output_names=["mask"],
            dynamic_axes={"image": {0: "N"}, "mask": {0: "N"}},
            opset_version=17, do_constant_folding=True, dynamo=False,
        )
    onnx.checker.check_model(onnx.load(str(out)))


def convert_fp16(src: Path, dst: Path, block: list[str] | None = None) -> bool:
    """fp16 weights and activations, fp32 I/O; `block` lists op types kept in fp32 (see the CLI
    help / plan Global Constraints for why these op types)."""
    try:
        from onnxruntime.transformers.float16 import convert_float_to_float16
    except Exception as e:  # pragma: no cover
        print(f"fp16 skipped ({e})"); return False
    try:
        m = onnx.load(str(src))
        m16 = convert_float_to_float16(m, keep_io_types=True, op_block_list=list(block or []))
        onnx.save(m16, str(dst))
    except Exception as e:
        print(f"fp16 skipped ({e})"); return False
    return True


def quantize_int8(src: Path, dst: Path) -> bool:
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        from onnxruntime.quantization.shape_inference import quant_pre_process
    except Exception as e:  # pragma: no cover
        print(f"int8 skipped ({e})"); return False
    pre = dst.with_suffix(".pre.onnx")
    try:
        quant_pre_process(str(src), str(pre))
        quantize_dynamic(str(pre), str(dst), weight_type=QuantType.QInt8)
    except Exception as e:
        print(f"int8 skipped ({e})"); return False
    finally:
        pre.unlink(missing_ok=True)
    return True


def ort_session(path: Path) -> ort.InferenceSession:
    so = ort.SessionOptions(); so.intra_op_num_threads = max(1, (torch.get_num_threads() or 4))
    return ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])


@torch.no_grad()
def collect(model: torch.nn.Module, loader: DataLoader, sessions: dict[str, ort.InferenceSession]):
    """Run torch + every ORT session on the same batches. Returns torch logits, per-variant ORT
    logits, per-variant mean seconds/image, and the sample count -- all as numpy float32."""
    model.eval()
    torch_logits, variant_logits = [], {k: [] for k in sessions}
    timing = {k: 0.0 for k in sessions}
    n = 0
    for imgs, _masks, _metas in loader:
        torch_logits.append(model(imgs).numpy().astype(np.float32))
        feed = {"image": imgs.numpy().astype(np.float32)}
        for k, s in sessions.items():
            t0 = time.perf_counter()
            out = s.run(["mask"], feed)[0]
            timing[k] += time.perf_counter() - t0
            variant_logits[k].append(out.astype(np.float32))
        n += len(imgs)
    torch_logits = np.concatenate(torch_logits)
    variant_logits = {k: np.concatenate(v) for k, v in variant_logits.items()}
    ms_per_image = {k: 1000.0 * v / max(1, n) for k, v in timing.items()}
    return torch_logits, variant_logits, ms_per_image, n


def parity_metrics(torch_logits: np.ndarray, variant_logits: dict[str, np.ndarray],
                    ms_per_image: dict[str, float]) -> dict[str, dict]:
    torch_mask = torch_logits > 0.0  # sigmoid(x) > 0.5 <=> x > 0
    result = {}
    for k, v in variant_logits.items():
        diff = np.abs(v - torch_logits)
        v_mask = v > 0.0
        disagree = v_mask != torch_mask
        flat_v, flat_t = v_mask.reshape(len(v_mask), -1), torch_mask.reshape(len(torch_mask), -1)
        inter = np.logical_and(flat_v, flat_t).sum(axis=1)
        union = np.logical_or(flat_v, flat_t).sum(axis=1)
        iou = np.where(union > 0, inter / np.maximum(union, 1), 1.0)
        result[k] = {
            "mean_abs_logit_diff": float(diff.mean()),
            "max_abs_logit_diff": float(diff.max()),
            "mask_disagreement_frac": float(disagree.mean()),
            "iou_vs_torch_mask": float(iou.mean()),
            "ms_per_image": float(ms_per_image[k]),
        }
    return result


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="export_card_model")
    ap.add_argument("--config", default="config.toml")
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--run-name", required=True)
    ap.add_argument("--out-dir", default="weights/onnx")
    ap.add_argument("--parity-rows", type=int, default=200, help="SyntheticVal (val-split) samples for torch-vs-ONNX checks")
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--backgrounds", default="training/data/backgrounds")
    ap.add_argument("--input-size", type=int, default=None, help="defaults to the checkpoint's own input_size")
    ap.add_argument("--fp16-block", default=FP16_BLOCK_DEFAULT,
                    help="comma-separated op types kept in fp32 in the fp16 export ('' for none)")
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    cfg = load_config(args.config)
    out_dir = Path(args.out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"card-{args.run_name}"

    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    input_size = args.input_size if args.input_size is not None else int(ckpt["input_size"])
    model = CardSegNet(encoder=ckpt["encoder"], pretrained=False)
    model.load_state_dict(ckpt["model"]); model.eval()

    fp32 = out_dir / f"{stem}.fp32.onnx"; fp16 = out_dir / f"{stem}.fp16.onnx"; int8 = out_dir / f"{stem}.int8.onnx"
    print(f"[{stem}] exporting fp32 ({input_size}x{input_size}) -> {fp32}")
    export_fp32(model, input_size, fp32)

    block = [b for b in args.fp16_block.split(",") if b]
    print(f"[{stem}] fp16 (fp32 kept for: {block or 'nothing'}) ...")
    has16 = convert_fp16(fp32, fp16, block)

    print(f"[{stem}] int8 ...")
    has8 = quantize_int8(fp32, int8)

    # -- parity on SyntheticVal (val-split cutouts) --------------------------------------------
    val_paths = list_cutouts(cfg.cache_dir, cfg.splits_path, "val")
    bg_pool = RealPool(args.backgrounds)
    canvas = 2 * input_size
    val_ds = SyntheticVal(val_paths, bg_pool, n=args.parity_rows, seed=args.seed, canvas=canvas, out=input_size)
    loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0, collate_fn=collate_cards)

    sessions = {"fp32": ort_session(fp32)}
    if has8:
        try:
            sessions["int8"] = ort_session(int8)
        except Exception as e:
            print(f"int8 session skipped ({e})")
    if has16:
        try:
            sessions["fp16"] = ort_session(fp16)
        except Exception as e:
            print(f"fp16 session skipped ({e})")

    print(f"[{stem}] parity on {args.parity_rows} synthetic val samples (seed {args.seed})")
    torch_logits, variant_logits, ms_per_image, n = collect(model, loader, sessions)
    variants = parity_metrics(torch_logits, variant_logits, ms_per_image)
    parity = {"rows": int(n), "seed": args.seed, **variants}
    for k, m in variants.items():
        print(f"  {k:5s} mean|diff|={m['mean_abs_logit_diff']:.5f} max|diff|={m['max_abs_logit_diff']:.4f} "
              f"mask_disagree={m['mask_disagreement_frac']:.5f} iou_vs_torch={m['iou_vs_torch_mask']:.4f} "
              f"{m['ms_per_image']:.2f} ms/img (CPU)")
    (out_dir / f"{stem}.parity.json").write_text(json.dumps(parity, indent=2))

    fail = False
    if "fp16" in variants and variants["fp16"]["mask_disagreement_frac"] >= FP16_DISAGREEMENT_MAX:
        print("PARITY FAIL")
        fail = True

    # -- contract sidecar for the app -----------------------------------------------------------
    def file_info(p: Path) -> dict:
        return {"path": p.name, "bytes": p.stat().st_size, "sha256": sha256(p)}

    files = {"fp32": file_info(fp32)}
    if fp16.exists():
        files["fp16"] = file_info(fp16)
    if int8.exists():
        files["int8"] = file_info(int8)

    contract = {
        "task": "card", "run": args.run_name, "encoder": ckpt["encoder"], "input_size": input_size,
        "inputs": {
            "image": {
                "shape": ["N", 3, input_size, input_size], "layout": "NCHW",
                "normalise": "x/255 then (x-mean)/std",
                "mean": MEAN.flatten().tolist(), "std": STD.flatten().tolist(),
                "letterbox": "pad the short side to square with the mean colour of the photo's "
                             "outer 8-px ring, then resize to S; keep scale/pad_x/pad_y to map "
                             "the mask back",
            },
        },
        "outputs": {
            "mask": {
                "shape": ["N", 1, input_size, input_size],
                "meaning": "logits; sigmoid > 0.5 is card; map back through the inverse letterbox",
            },
        },
        "files": files,
        "fp16_block": block,
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }
    (out_dir / f"{stem}.json").write_text(json.dumps(contract, indent=2))

    print(f"[{stem}] sizes: " + ", ".join(f"{name} {v['bytes']/1048576:.2f} MB" for name, v in files.items()))
    if "fp16" in files:
        fp16_mb = files["fp16"]["bytes"] / 1048576
        if fp16_mb > 10:
            print(f"WARNING: fp16 size {fp16_mb:.2f} MB exceeds the 10 MB target")

    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
