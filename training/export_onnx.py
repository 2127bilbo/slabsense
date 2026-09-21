"""Export a trained ScoreRegressor checkpoint to ONNX (fp32 → fp16 + int8) with parity checks.

    .venv/Scripts/python.exe export_onnx.py --task corners --checkpoint weights/corners/v2/best.pt --run-name v2
    .venv/Scripts/python.exe export_onnx.py --task edges   --checkpoint weights/edges/v1/best.pt   --run-name v1

Writes to --out-dir (default weights/onnx/):
    <task>-<run>.fp32.onnx, <task>-<run>.fp16.onnx, <task>-<run>.int8.onnx   (gitignored, large)
    <task>-<run>.json      preprocessing + I/O contract for the app (tracked)
    <task>-<run>.parity.json  torch-vs-ONNX agreement and metrics on cached test rows (tracked)

The originals are never modified. Inputs: `images` float32 [N,3,H,W] normalized with ImageNet mean/std
(H,W = TASKS[task].input_size reversed), `sides` float32 [N,1] (0 = front, 1 = back). Output: `logits`
[N, n_out]; apply sigmoid to get wear probability / 0-1 scores (× 1000 = TAG points for deduction).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch

from trainlib import metrics
from trainlib.config import load_config
from trainlib.data import MEAN, STD, SCALE
from trainlib.models import ScoreRegressor
from trainlib.tables import TASKS, filter_cached, load_task_table
from trainlib.train import make_loader


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export_fp32(model, task: str, out: Path) -> None:
    w, h = TASKS[task]["input_size"]
    images = torch.zeros(1, 3, h, w)
    sides = torch.zeros(1, 1)
    torch.onnx.export(
        model, (images, sides), str(out),
        input_names=["images", "sides"], output_names=["logits"],
        dynamic_axes={"images": {0: "batch"}, "sides": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17, do_constant_folding=True, dynamo=False,
    )
    onnx.checker.check_model(onnx.load(str(out)))


def convert_fp16(src: Path, dst: Path, block: list[str] | None = None) -> bool:
    """fp16 weights and activations, fp32 I/O. `block` lists op types kept in fp32. The phone-augmented
    edge model produced a deterministic NaN on WebGPU for one real tile (2026-09-20) although no stored
    activation exceeded fp16 range, i.e. an fp16 accumulation inside a kernel overflowed (stage-3
    activations of ~1700 summed over 192 positions in the global pool is the likely one). Keeping the
    norm, pool, head and the GELU/division ops in fp32 fixed it at the cost of a few Cast nodes; the
    convolutions and matmuls, which are the size and the speed, stay fp16. WASM never showed it (it
    upcasts), so test fp16 exports on WebGPU, not just in Node."""
    try:
        from onnxruntime.transformers.float16 import convert_float_to_float16
    except Exception as e:  # pragma: no cover
        print(f"fp16 skipped ({e})"); return False
    m = onnx.load(str(src))
    m16 = convert_float_to_float16(m, keep_io_types=True, op_block_list=list(block or []))
    onnx.save(m16, str(dst))
    return True


def quantize_int8(src: Path, dst: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.shape_inference import quant_pre_process
    pre = dst.with_suffix(".pre.onnx")
    quant_pre_process(str(src), str(pre))
    quantize_dynamic(str(pre), str(dst), weight_type=QuantType.QInt8)
    pre.unlink(missing_ok=True)


def ort_session(path: Path) -> ort.InferenceSession:
    so = ort.SessionOptions(); so.intra_op_num_threads = max(1, (torch.get_num_threads() or 4))
    return ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])


@torch.no_grad()
def collect(model, loader, sessions: dict[str, ort.InferenceSession]):
    """Run torch + every ORT session on the same batches. Returns sigmoid scores, targets, masks, timings."""
    model.eval()
    out = {k: [] for k in ["torch", *sessions]}
    targets, masks = [], []
    timing = {k: 0.0 for k in sessions}
    n = 0
    for imgs, sides, t, m in loader:
        out["torch"].append(torch.sigmoid(model(imgs, sides)).numpy())
        feed = {"images": imgs.numpy().astype(np.float32), "sides": sides.numpy().astype(np.float32)}
        for k, s in sessions.items():
            t0 = time.perf_counter()
            logits = s.run(["logits"], feed)[0]
            timing[k] += time.perf_counter() - t0
            out[k].append(1.0 / (1.0 + np.exp(-logits.astype(np.float32))))
        targets.append(t.numpy()); masks.append(m.numpy()); n += len(imgs)
    return ({k: np.concatenate(v) for k, v in out.items()}, np.concatenate(targets), np.concatenate(masks),
            {k: v / max(1, n) for k, v in timing.items()})


def metric_table(scores: np.ndarray, target: np.ndarray, mask: np.ndarray, kinds, names) -> dict:
    row = {}
    for j, name in enumerate(names):
        m = mask[:, j].astype(bool)
        s = torch.from_numpy(scores[m, j]); tt = torch.from_numpy(target[m, j])
        if kinds[j] == "regress":
            row[f"mae_{name}"] = float(SCALE * (s - tt).abs().mean()) if len(s) else float("nan")
        else:
            row[f"auroc_{name}"] = metrics.auroc(s, tt)
            p, r = metrics.precision_recall_at(s, tt)
            row[f"precision_{name}"] = p; row[f"recall_{name}"] = r; row[f"npos_{name}"] = int((tt == 1).sum())
    return row


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="export_onnx")
    ap.add_argument("--config", default="config.toml")
    ap.add_argument("--task", choices=["corners", "edges", "centering_rgb"], required=True)
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--run-name", required=True)
    ap.add_argument("--out-dir", default="weights/onnx")
    ap.add_argument("--parity-rows", type=int, default=512, help="cached rows for torch-vs-ONNX checks")
    ap.add_argument("--split", choices=["val", "test"], default="val", help="split to draw parity rows from (test is only cached on the GPU box)")
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--fp16-block", default="LayerNormalization,GlobalAveragePool,Gemm,Div,Erf,Flatten,Concat",
                    help="comma-separated op types kept in fp32 in the fp16 export ('' for none). The default is what "
                         "stopped a deterministic NaN on WebGPU (2026-09-20); the fp16 backbone is where the size and speed are")
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    out_dir = Path(args.out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{args.task}-{args.run_name}"
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = ScoreRegressor(ckpt["n_out"], ckpt["backbone"], pretrained=False)
    model.load_state_dict(ckpt["model"]); model.eval()
    spec = TASKS[args.task]

    fp32 = out_dir / f"{stem}.fp32.onnx"; fp16 = out_dir / f"{stem}.fp16.onnx"; int8 = out_dir / f"{stem}.int8.onnx"
    print(f"[{stem}] exporting fp32 -> {fp32}")
    export_fp32(model, args.task, fp32)
    block = [b for b in args.fp16_block.split(",") if b]
    print(f"[{stem}] fp16 (fp32 kept for: {block or 'nothing'}) ..."); has16 = convert_fp16(fp32, fp16, block)
    print(f"[{stem}] int8 ..."); quantize_int8(fp32, int8)

    # ── parity on cached test rows ────────────────────────────────────────────
    df = load_task_table(args.task, cfg.dataset_dir, cfg.splits_path, args.split, None, allow_test=True)
    df, dropped = filter_cached(df, cfg.cache_dir, args.task)
    if len(df) > args.parity_rows:
        df = df.sample(n=args.parity_rows, random_state=args.seed).reset_index(drop=True)
    print(f"[{stem}] parity on {len(df)} cached {args.split} rows (dropped {dropped} uncached)")
    loader = make_loader(df, args.task, cfg.cache_dir, False, args.batch_size, 0, None)
    sessions = {"fp32": ort_session(fp32), "int8": ort_session(int8)}
    if has16:
        try: sessions["fp16"] = ort_session(fp16)
        except Exception as e: print(f"fp16 session skipped ({e})")
    scores, target, mask, timing = collect(model, loader, sessions)
    kinds, names = ckpt["kinds"], ckpt["target_names"]
    parity = {
        "rows": int(len(df)), "split": args.split,
        "max_abs_diff_vs_torch": {k: float(np.abs(scores[k] - scores["torch"]).max()) for k in sessions},
        "mean_abs_diff_vs_torch": {k: float(np.abs(scores[k] - scores["torch"]).mean()) for k in sessions},
        "metrics": {k: metric_table(scores[k], target, mask, kinds, names) for k in ["torch", *sessions]},
        "ort_cpu_seconds_per_crop": timing,
    }
    for k, v in parity["max_abs_diff_vs_torch"].items():
        print(f"  {k:5s} max|diff| vs torch = {v:.4f}   mean|diff| = {parity['mean_abs_diff_vs_torch'][k]:.5f}   {timing[k]*1000:.0f} ms/crop (CPU)")
    for k, mt in parity["metrics"].items():
        print(f"  {k:5s} " + "  ".join(f"{n}={v:.4f}" for n, v in mt.items() if isinstance(v, float)))
    (out_dir / f"{stem}.parity.json").write_text(json.dumps(parity, indent=2))

    # ── contract sidecar for the app ──────────────────────────────────────────
    w, h = spec["input_size"]
    contract = {
        "task": args.task, "run": args.run_name, "backbone": ckpt["backbone"],
        "source_checkpoint": str(args.checkpoint), "epoch": ckpt.get("epoch"), "val_loss": ckpt.get("val_loss"),
        "inputs": {
            "images": {"dtype": "float32", "shape": ["N", 3, h, w], "layout": "NCHW",
                        "preprocess": {"resize_to_wh": [w, h], "long_side_horizontal": spec["long_side_horizontal"],
                                       "scale": "x/255", "mean": MEAN.flatten().tolist(), "std": STD.flatten().tolist()}},
            "sides": {"dtype": "float32", "shape": ["N", 1], "values": {"front": 0.0, "back": 1.0}},
        },
        "outputs": {"logits": {"shape": ["N", ckpt["n_out"]], "postprocess": "sigmoid",
                                "channels": [{"name": n, "kind": k, "scale": (SCALE if k == "regress" else 1.0)}
                                             for n, k in zip(names, kinds)]}},
        "files": {p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in [fp32, fp16, int8] if p.exists()},
        "opset": 17,
        "fp16_fp32_ops": block,
    }
    (out_dir / f"{stem}.json").write_text(json.dumps(contract, indent=2))
    print(f"[{stem}] sizes: " + ", ".join(f"{n} {v['bytes']/1048576:.1f} MB" for n, v in contract["files"].items()))


if __name__ == "__main__":
    main()
